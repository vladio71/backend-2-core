// Що це: кеш дорогої статистики поста в Redis. TTL 60 с + інвалідація при записі.
// Чому обидва: TTL рятує, якщо хтось забув інвалідувати; інвалідація дає свіжі дані одразу після зміни.
// Хто викликає: StatsController (читає), PostsService (інвалідує після update/delete/publish).
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS } from '../redis/redis.module';

export interface PostStats {
  postId: string;
  likes: number;
  activityCount: number;
  authorPosts: number;
  authorTotalLikes: number;
  computedAt: string;
}

export interface CachedStats {
  stats: PostStats;
  cache: 'HIT' | 'MISS';
}

const TTL_SECONDS = 60;

@Injectable()
export class PostStatsCache {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly dataSource: DataSource,
  ) {}

  private key(postId: string): string {
    return `post:stats:${postId}`;
  }

  async get(postId: string): Promise<CachedStats | null> {
    const cached = await this.redis.get(this.key(postId));
    if (cached) {
      return { stats: JSON.parse(cached) as PostStats, cache: 'HIT' };
    }
    const stats = await this.compute(postId);
    if (!stats) return null;
    // SET з EX: ключ сам зникне через 60 с.
    await this.redis.set(this.key(postId), JSON.stringify(stats), 'EX', TTL_SECONDS);
    return { stats, cache: 'MISS' };
  }

  async invalidate(postId: string): Promise<void> {
    await this.redis.del(this.key(postId));
  }

  // "Дорогий" агрегат: кілька підзапитів по кількох таблицях. pg_sleep(0.2) імітує, що він справді дорогий.
  private async compute(postId: string): Promise<PostStats | null> {
    const rows: Array<{ likes: number; activity_count: string; author_posts: string; author_total_likes: string }> =
      await this.dataSource.query(
        `SELECT p.likes,
                (SELECT count(*) FROM activity a WHERE a.post_id = p.id) AS activity_count,
                (SELECT count(*) FROM posts p2 WHERE p2.author_id = p.author_id AND p2.deleted_at IS NULL) AS author_posts,
                (SELECT coalesce(sum(p3.likes), 0) FROM posts p3 WHERE p3.author_id = p.author_id AND p3.deleted_at IS NULL) AS author_total_likes,
                pg_sleep(0.2)
         FROM posts p
         WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [postId],
      );
    const row = rows[0];
    if (!row) return null;
    return {
      postId,
      likes: Number(row.likes),
      activityCount: Number(row.activity_count),
      authorPosts: Number(row.author_posts),
      authorTotalLikes: Number(row.author_total_likes),
      computedAt: new Date().toISOString(),
    };
  }
}
