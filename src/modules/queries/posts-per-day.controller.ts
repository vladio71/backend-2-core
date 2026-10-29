// Що це: звіт "постів за день" сирим SQL: JOIN, GROUP BY date_trunc, віконна функція (running total).
// Чому сирий SQL: query builder тут тільки заважає, а SQL читається рядок за рядком.
// Хто викликає: GET /reports/posts-per-day?days=30
import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { DefaultValuePipe } from '@nestjs/common';

export interface PostsPerDayRow {
  day: string;
  authorName: string;
  posts: number;
  likes: number;
  runningTotal: number;
}

interface RawRow {
  day: string;
  author_name: string;
  posts: string;
  likes: string;
  running_total: string;
}

@ApiTags('reports')
@Controller('reports')
export class PostsPerDayController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('posts-per-day')
  async postsPerDay(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number): Promise<PostsPerDayRow[]> {
    const rows: RawRow[] = await this.dataSource.query(
      `
      SELECT
        -- date_trunc обрізає timestamptz до початку дня (в UTC, бо сесія в UTC)
        date_trunc('day', p.created_at)                   AS day,
        u.display_name                                    AS author_name,
        -- скільки постів автор створив цього дня
        count(*)                                          AS posts,
        -- і скільки лайків вони зібрали
        sum(p.likes)                                      AS likes,
        -- віконна функція: сума постів цього автора від початку до поточного дня включно.
        -- PARTITION BY = окремий лічильник на автора, ORDER BY = порядок накопичення.
        sum(count(*)) OVER (PARTITION BY u.id ORDER BY date_trunc('day', p.created_at)) AS running_total
      FROM posts p
      -- JOIN, щоб показати ім'я автора, а не uuid
      JOIN users u ON u.id = p.author_id
      WHERE p.deleted_at IS NULL
        AND p.created_at >= now() - ($1 || ' days')::interval
      -- усе, що не в агрегаті, має бути в GROUP BY
      GROUP BY day, u.id, u.display_name
      ORDER BY day, author_name
      `,
      [String(days)],
    );
    return rows.map((r) => ({
      day: r.day,
      authorName: r.author_name,
      posts: Number(r.posts),
      likes: Number(r.likes),
      runningTotal: Number(r.running_total),
    }));
  }
}
