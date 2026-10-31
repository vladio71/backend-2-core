import { PostsService, decodeCursor, encodeCursor } from './posts.service';
import { Repository, DataSource } from 'typeorm';
import { Post } from './post.entity';
import { PostStatsCache } from './post-stats-cache.service';
import { AccessTokenPayload } from '../auth/jwt.service';
import { PostIndexer } from './post-indexer';

// Unit-тест: репозиторій і кеш замінені фейками. Перевіряємо правила, а не SQL.
const ID = '0b0c8e5a-1d7f-4a53-9a55-3f6f3c2d9e11';

describe('PostsService (unit)', () => {
  const owner: AccessTokenPayload = { sub: 'u1', role: 'user', email: 'a@b.c' };
  const stranger: AccessTokenPayload = { sub: 'u2', role: 'user', email: 'x@b.c' };
  const admin: AccessTokenPayload = { sub: 'u3', role: 'admin', email: 'adm@b.c' };

  function build(post: Partial<Post>) {
    const repo = {
      findOne: jest.fn().mockResolvedValue(post),
      save: jest.fn(async (p: Post) => p),
      softDelete: jest.fn(),
    } as unknown as Repository<Post>;
    const cache = { invalidate: jest.fn() } as unknown as PostStatsCache;
    const ds = {} as DataSource;
    const embeddings: PostIndexer = { indexPost: jest.fn() };
    return { svc: new PostsService(repo, ds, cache, embeddings), repo, cache };
  }

  it('чужий користувач не може редагувати пост, адмін може', async () => {
    const { svc } = build({ id: 'p1', authorId: 'u1', title: 'old' } as Post);
    await expect(svc.update(stranger, 'p1', { title: 'hack' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const updated = await svc.update(admin, 'p1', { title: 'fixed' });
    expect(updated.title).toBe('fixed');
  });

  it('після update інвалідує кеш статистики', async () => {
    const { svc, cache } = build({ id: 'p1', authorId: 'u1' } as Post);
    await svc.update(owner, 'p1', { title: 'new title' });
    expect(cache.invalidate).toHaveBeenCalledWith('p1');
  });

  it('повторний publish дає 409 ALREADY_PUBLISHED', async () => {
    const { svc } = build({ id: 'p1', authorId: 'u1', status: 'published' } as Post);
    await expect(svc.publish(owner, 'p1')).rejects.toMatchObject({ code: 'ALREADY_PUBLISHED' });
  });

  it('курсор кодується і декодується без втрат', () => {
    const cursor = encodeCursor({ v: '2026-01-01T00:00:00.000Z', id: ID });
    expect(decodeCursor(cursor, 'createdAt')).toEqual({ v: '2026-01-01T00:00:00.000Z', id: ID });
    expect(() => decodeCursor('!!!', 'createdAt')).toThrow();
  });

  it('decodeCursor: v має відповідати полю сортування, інакше BAD_CURSOR', () => {
    const bad = (v: unknown, sort: 'createdAt' | 'likes' | 'title') => () => decodeCursor(encodeCursor({ v: v as string, id: ID }), sort);
    expect(bad('garbage', 'createdAt')).toThrow(expect.objectContaining({ code: 'BAD_CURSOR' }));
    expect(bad('2026-13-45T00:00:00.000Z', 'createdAt')).toThrow(expect.objectContaining({ code: 'BAD_CURSOR' }));
    expect(bad('abc', 'likes')).toThrow(expect.objectContaining({ code: 'BAD_CURSOR' }));
    expect(bad(1.5, 'likes')).toThrow(expect.objectContaining({ code: 'BAD_CURSOR' }));
    expect(bad(5, 'title')).toThrow(expect.objectContaining({ code: 'BAD_CURSOR' }));
    expect(() => decodeCursor(encodeCursor({ v: 1, id: 'not-a-uuid' }), 'likes')).toThrow(expect.objectContaining({ code: 'BAD_CURSOR' }));
    expect(bad('2026-01-01T00:00:00.123456Z', 'createdAt')).not.toThrow();
    expect(bad(7, 'likes')).not.toThrow();
    expect(bad('Привіт', 'title')).not.toThrow();
  });
});
