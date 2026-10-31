// Що це: демо пулу з'єднань. /stats показує total/idle/waiting з pg.Pool; /slow запускає n паралельних pg_sleep.
// Чому: при DB_POOL_MAX=10 і n=20 запити 11-20 чекають у черзі пулу, і це видно в таймінгах.
// Хто викликає: GET /demo/pool/stats, GET /demo/pool/slow?seconds=3&n=20 (потрібен Bearer-токен)
import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { Pool } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

export interface PoolStats {
  max: number;
  total: number;
  idle: number;
  waiting: number;
}

export interface SlowRequestTiming {
  index: number;
  waitedForConnectionMs: number;
  totalMs: number;
}

export interface SlowResponse {
  poolMax: number;
  requested: number;
  sleepSeconds: number;
  wallClockMs: number;
  timings: SlowRequestTiming[];
  poolAfter: PoolStats;
}

// Межі для /slow. Пул малий (DB_POOL_MAX, типово 10), а /slow навмисно тримає з'єднання: n запитів по `seconds` секунд.
export const SLOW_MAX_N = 30;
export const SLOW_MAX_SECONDS = 5;

export function clampSlowParams(seconds: number, n: number): { seconds: number; n: number } {
  return { seconds: Math.min(Math.max(seconds, 1), SLOW_MAX_SECONDS), n: Math.min(Math.max(n, 1), SLOW_MAX_N) };
}

@ApiTags('demo')
@Controller('demo/pool')
export class PoolController {
  constructor(private readonly dataSource: DataSource) {}

  private pool(): Pool {
    // TypeORM ховає pg.Pool у драйвері як master. Нам потрібні його лічильники.
    const driver = this.dataSource.driver as PostgresDriver;
    return driver.master as Pool;
  }

  private stats(): PoolStats {
    const pool = this.pool();
    return {
      max: pool.options.max ?? 10,
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
  }

  @Get('stats')
  getStats(): PoolStats {
    return this.stats();
  }

  // Тільки для залогінених і з жорсткими межами (n <= 30, seconds <= 5). Чому: цей маршрут займає з'єднання пулу на секунди.
  // Анонімний користувач міг би кількома запитами з n=50, seconds=10 вичерпати весь пул (10 з'єднань), і тоді
  // навіть /health (він теж ходить у БД) перестав би відповідати: оркестратор вважає API мертвим і перезапускає його.
  @Get('slow')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async slow(
    @Query('seconds', new DefaultValuePipe(1), ParseIntPipe) seconds: number,
    @Query('n', new DefaultValuePipe(20), ParseIntPipe) n: number,
  ): Promise<SlowResponse> {
    const { seconds: safeSeconds, n: safeN } = clampSlowParams(seconds, n);
    const started = Date.now();
    const timings = await Promise.all(
      Array.from({ length: safeN }, async (_, index): Promise<SlowRequestTiming> => {
        const t0 = Date.now();
        // Беремо з'єднання вручну, щоб виміряти окремо очікування у черзі пулу.
        const runner = this.dataSource.createQueryRunner();
        await runner.connect();
        const waitedForConnectionMs = Date.now() - t0;
        try {
          await runner.query('SELECT pg_sleep($1)', [safeSeconds]);
        } finally {
          await runner.release();
        }
        return { index: index + 1, waitedForConnectionMs, totalMs: Date.now() - t0 };
      }),
    );
    return {
      poolMax: this.stats().max,
      requested: safeN,
      sleepSeconds: safeSeconds,
      wallClockMs: Date.now() - started,
      timings,
      poolAfter: this.stats(),
    };
  }
}
