// Що це: демо пулу з'єднань. /stats показує total/idle/waiting з pg.Pool; /slow запускає n паралельних pg_sleep.
// Чому: при DB_POOL_MAX=10 і n=20 запити 11-20 чекають у черзі пулу, і це видно в таймінгах.
// Хто викликає: GET /demo/pool/stats, GET /demo/pool/slow?seconds=3&n=20
import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { Pool } from 'pg';

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

  @Get('slow')
  async slow(
    @Query('seconds', new DefaultValuePipe(1), ParseIntPipe) seconds: number,
    @Query('n', new DefaultValuePipe(20), ParseIntPipe) n: number,
  ): Promise<SlowResponse> {
    const safeSeconds = Math.min(Math.max(seconds, 1), 10);
    const safeN = Math.min(Math.max(n, 1), 50);
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
