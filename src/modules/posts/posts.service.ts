// Що це: бізнес-логіка постів: CRUD, список з фільтрами і двома пагінаціями, м'яке видалення, publish у транзакції.
// Чому: контролер не знає про SQL, репозиторій не знає про права. Усе "кому можна" живе тут.
// Хто викликає: PostsController, AiController (moderate), seed.
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Post, PostStatus } from './post.entity';
import { Activity } from './activity.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ListPostsDto, PostSortField } from './dto/list-posts.dto';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/domain-errors';
import { AccessTokenPayload } from '../auth/jwt.service';
import { PostStatsCache } from './post-stats-cache.service';
import { POST_INDEXER, PostIndexer } from './post-indexer';

export interface OffsetPage {
  items: Post[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CursorPage {
  items: Post[];
  nextCursor: string | null;
}

interface CursorPayload {
  v: string | number;
  id: string;
}

const SORT_COLUMNS: Record<PostSortField, string> = {
  createdAt: 'p.created_at',
  title: 'p.title',
  likes: 'p.likes',
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
    if (typeof parsed.id !== 'string') throw new Error('bad');
    return parsed;
  } catch {
    throw new ConflictError('BAD_CURSOR', 'Курсор пошкоджений');
  }
}

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    private readonly dataSource: DataSource,
    private readonly statsCache: PostStatsCache,
    @Inject(POST_INDEXER) private readonly embeddings: PostIndexer,
  ) {}

  async create(author: AccessTokenPayload, dto: CreatePostDto): Promise<Post> {
    const post = this.posts.create({
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      status: dto.status ?? 'draft',
      likes: dto.likes ?? 0,
      meta: dto.meta ?? {},
      authorId: author.sub,
      publishedAt: dto.status === 'published' ? new Date() : null,
    });
    const saved = await this.posts.save(post);
    // Вектор для similar-пошуку (модуль ai). Без pgvector метод нічого не робить.
    await this.embeddings.indexPost(saved.id, saved.title, saved.body);
    return saved;
  }

  async getById(id: string, includeDeleted = false): Promise<Post> {
    const post = await this.posts.findOne({ where: { id }, withDeleted: includeDeleted });
    if (!post) throw new NotFoundError('Post', id);
    return post;
  }

  async update(actor: AccessTokenPayload, id: string, dto: UpdatePostDto): Promise<Post> {
    const post = await this.getById(id);
    this.assertOwnerOrAdmin(actor, post);
    Object.assign(post, dto);
    const saved = await this.posts.save(post);
    // Будь-який запис у пост інвалідує його кеш статистики (див. docs/modules/queries.md).
    await this.statsCache.invalidate(id);
    if (dto.title !== undefined || dto.body !== undefined) {
      await this.embeddings.indexPost(saved.id, saved.title, saved.body);
    }
    return saved;
  }

  async softDelete(actor: AccessTokenPayload, id: string): Promise<void> {
    const post = await this.getById(id);
    this.assertOwnerOrAdmin(actor, post);
    // softDelete ставить deleted_at = now(), рядок лишається в таблиці.
    await this.posts.softDelete({ id });
    await this.statsCache.invalidate(id);
  }

  async restore(actor: AccessTokenPayload, id: string): Promise<Post> {
    const post = await this.getById(id, true);
    this.assertOwnerOrAdmin(actor, post);
    if (!post.deletedAt) throw new ConflictError('NOT_DELETED', 'Пост не видалений');
    await this.posts.restore({ id });
    return this.getById(id);
  }

  // Транзакція: статус поста + рядок у activity. Або обидва, або жоден.
  // Параметр failActivity існує лише для тесту: імітує падіння другого запису.
  async publish(actor: AccessTokenPayload, id: string, failActivity = false): Promise<Post> {
    const post = await this.getById(id);
    this.assertOwnerOrAdmin(actor, post);
    if (post.status === 'published') throw new ConflictError('ALREADY_PUBLISHED', 'Пост уже опублікований');

    await this.dataSource.transaction(async (manager) => {
      // 1-й запис: сам пост. Використовуємо manager, а не this.posts: тільки так запит потрапляє в транзакцію.
      await manager.update(Post, { id }, { status: 'published' as PostStatus, publishedAt: new Date() });
      // 2-й запис: журнал. Якщо він упаде, Postgres відкотить і перший.
      if (failActivity) {
        throw new Error('Імітація падіння другого запису');
      }
      await manager.insert(Activity, { postId: id, actorId: actor.sub, action: 'publish' });
    });
    await this.statsCache.invalidate(id);
    return this.getById(id);
  }

  async list(query: ListPostsDto): Promise<OffsetPage | CursorPage> {
    const qb = this.posts.createQueryBuilder('p');
    this.applyFilters(qb, query);
    if (query.mode === 'cursor' || query.cursor) {
      return this.listByCursor(qb, query);
    }
    return this.listByOffset(qb, query);
  }

  private applyFilters(qb: SelectQueryBuilder<Post>, q: ListPostsDto): void {
    if (q.q) {
      qb.andWhere('(p.title ILIKE :q OR p.body ILIKE :q)', { q: `%${q.q}%` });
    }
    if (q.tags && q.tags.length > 0) {
      // && = перетин масивів (хоч один тег), @> = містить усі.
      qb.andWhere(q.tagsMode === 'all' ? 'p.tags @> :tags' : 'p.tags && :tags', { tags: q.tags });
    }
    if (q.authorId) qb.andWhere('p.author_id = :authorId', { authorId: q.authorId });
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.dateFrom) qb.andWhere('p.created_at >= :dateFrom', { dateFrom: q.dateFrom });
    if (q.dateTo) qb.andWhere('p.created_at < :dateTo', { dateTo: q.dateTo });
  }

  // Offset: просто і дає total, але OFFSET 100000 читає і викидає 100000 рядків.
  private async listByOffset(qb: SelectQueryBuilder<Post>, q: ListPostsDto): Promise<OffsetPage> {
    const dir = q.dir.toUpperCase() as 'ASC' | 'DESC';
    qb.orderBy(SORT_COLUMNS[q.sort], dir).addOrderBy('p.id', dir);
    qb.skip((q.page - 1) * q.pageSize).take(q.pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  // Cursor: "дай наступні після (значення сортування, id)". Стабільний при вставках, O(pageSize) на будь-якій сторінці.
  private async listByCursor(qb: SelectQueryBuilder<Post>, q: ListPostsDto): Promise<CursorPage> {
    const dir = q.dir.toUpperCase() as 'ASC' | 'DESC';
    const column = SORT_COLUMNS[q.sort];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      // Порівняння кортежів: (created_at, id) < (:v, :id). id робить порядок повним навіть при однакових значеннях.
      qb.andWhere(`(${column}, p.id) ${dir === 'DESC' ? '<' : '>'} (:cv, :cid)`, { cv: c.v, cid: c.id });
    }
    qb.orderBy(column, dir).addOrderBy('p.id', dir);
    qb.take(q.pageSize + 1); // +1, щоб знати, чи є наступна сторінка
    const rows = await qb.getMany();
    const hasMore = rows.length > q.pageSize;
    const items = hasMore ? rows.slice(0, q.pageSize) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ v: this.sortValue(last, q.sort), id: last.id }) : null;
    return { items, nextCursor };
  }

  private sortValue(post: Post, sort: PostSortField): string | number {
    if (sort === 'createdAt') return post.createdAt.toISOString();
    if (sort === 'likes') return post.likes;
    return post.title;
  }

  private assertOwnerOrAdmin(actor: AccessTokenPayload, post: Post): void {
    if (actor.role !== 'admin' && post.authorId !== actor.sub) {
      throw new ForbiddenError('Це не твій пост');
    }
  }
}
