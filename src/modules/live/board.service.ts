// Що це: історія малювання. Redis list 'board:strokes', обрізаний до останніх 5000 штрихів (LTRIM).
// Чому список з обрізанням: пам'ять обмежена, новий користувач має побачити останнє, а не все від початку часів.
// Хто викликає: LiveGateway.
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  userId: string;
  color: string;
  points: Point[];
}

const KEY = 'board:strokes';
const MAX_STROKES = 5000;

@Injectable()
export class BoardService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async append(stroke: Stroke): Promise<void> {
    // RPUSH + LTRIM атомарно в MULTI: список ніколи не перевищить MAX_STROKES.
    await this.redis.multi().rpush(KEY, JSON.stringify(stroke)).ltrim(KEY, -MAX_STROKES, -1).exec();
  }

  async history(): Promise<Stroke[]> {
    const raw = await this.redis.lrange(KEY, 0, -1);
    return raw.map((s) => JSON.parse(s) as Stroke);
  }

  async clear(): Promise<void> {
    await this.redis.del(KEY);
  }
}
