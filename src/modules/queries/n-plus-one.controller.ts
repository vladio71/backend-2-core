// Що це: демо N+1. ?fixed=false: цикл, один запит на автора. ?fixed=true: один запит зі зв'язком (JOIN).
// Відповідь містить queryCount, порахований TypeORM-логером (query-counter.ts).
// Хто викликає: GET /demo/n-plus-one?fixed=true|false
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../posts/post.entity';
import { User } from '../users/user.entity';
import { countQueries } from '../database/query-counter';

export interface PostWithAuthorName {
  id: string;
  title: string;
  authorName: string;
}

export interface NPlusOneResponse {
  fixed: boolean;
  postsReturned: number;
  queryCount: number;
  queries: string[];
  items: PostWithAuthorName[];
}

@ApiTags('demo')
@Controller('demo')
export class NPlusOneController {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Get('n-plus-one')
  async run(@Query('fixed') fixedRaw?: string): Promise<NPlusOneResponse> {
    const fixed = fixedRaw === 'true';
    const counted = await countQueries(async (): Promise<PostWithAuthorName[]> => {
      if (!fixed) {
        // Наївно: 1 запит за постами + N запитів за авторами. При 30 постах це 31 запит.
        const posts = await this.posts.find({ take: 30, order: { createdAt: 'DESC' } });
        const result: PostWithAuthorName[] = [];
        for (const post of posts) {
          const author = await this.users.findOne({ where: { id: post.authorId } });
          result.push({ id: post.id, title: post.title, authorName: author?.displayName ?? '?' });
        }
        return result;
      }
      // Виправлено: relations робить LEFT JOIN. Один запит.
      const posts = await this.posts.find({ take: 30, order: { createdAt: 'DESC' }, relations: { author: true } });
      return posts.map((p) => ({ id: p.id, title: p.title, authorName: p.author?.displayName ?? '?' }));
    });
    return {
      fixed,
      postsReturned: counted.result.length,
      queryCount: counted.queryCount,
      queries: counted.queries,
      items: counted.result,
    };
  }
}
