// Що це: запис ембедингу поста і пошук схожих через pgvector (оператор <-> = евклідова відстань).
// Чому окремий сервіс: колонка embedding не описана в TypeORM-сутності (TypeORM не знає тип vector),
// тому працюємо сирим SQL. На старті перевіряємо, чи є розширення; без нього методи чесно кажуть "недоступно".
// Хто викликає: PostsService через токен POST_INDEXER (indexPost після створення/оновлення), AiController (GET /posts/similar).
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding.provider';
import { UnprocessableError } from '../errors/domain-errors';
import { AppLogger } from '../logging/app-logger';

export interface SimilarPost {
  id: string;
  title: string;
  distance: number;
}

@Injectable()
export class PostEmbeddingsService implements OnModuleInit {
  private readonly logger = new AppLogger('PostEmbeddings');
  private supported = false;

  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    const rows: Array<{ exists: boolean }> = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'embedding') AS exists`,
    );
    this.supported = rows[0]?.exists === true;
    if (!this.supported) this.logger.warn('pgvector недоступний: колонки posts.embedding немає, similar-пошук вимкнено');
  }

  isSupported(): boolean {
    return this.supported;
  }

  async indexPost(postId: string, title: string, body: string): Promise<void> {
    if (!this.supported) return;
    const vector = await this.embeddings.embed(`${title}\n${body}`);
    // pgvector приймає літерал '[0.1,0.2,...]'::vector
    await this.dataSource.query(`UPDATE posts SET embedding = $1::vector WHERE id = $2`, [toVectorLiteral(vector), postId]);
  }

  async similar(query: string, limit = 5): Promise<SimilarPost[]> {
    if (!this.supported) {
      throw new UnprocessableError('PGVECTOR_UNAVAILABLE', 'pgvector не встановлений у цій базі. Використай образ pgvector/pgvector:pg16');
    }
    const vector = await this.embeddings.embed(query);
    // <-> = L2 відстань. Менше = схожіше. Для великих таблиць додають індекс HNSW: CREATE INDEX ... USING hnsw (embedding vector_l2_ops).
    const rows: Array<{ id: string; title: string; distance: string }> = await this.dataSource.query(
      `SELECT id, title, embedding <-> $1::vector AS distance
       FROM posts
       WHERE deleted_at IS NULL AND embedding IS NOT NULL
       ORDER BY embedding <-> $1::vector
       LIMIT $2`,
      [toVectorLiteral(vector), limit],
    );
    return rows.map((r) => ({ id: r.id, title: r.title, distance: Number(r.distance) }));
  }
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => v.toFixed(6)).join(',')}]`;
}
