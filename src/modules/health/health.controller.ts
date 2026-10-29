// Що це: GET /health. Пінгує Postgres (SELECT 1) і Redis (PING), віддає статус по кожній залежності.
// Чому: балансувальник і docker healthcheck дивляться сюди; 503 = не слати трафік на цей інстанс.
// Хто викликає: nginx/docker/людина.
import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS } from '../redis/redis.module';

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  instance: string;
  uptimeSeconds: number;
  dependencies: { postgres: DependencyStatus; redis: DependencyStatus };
}

async function probe(fn: () => Promise<unknown>): Promise<DependencyStatus> {
  const started = Date.now();
  try {
    await fn();
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const [postgres, redis] = await Promise.all([probe(() => this.dataSource.query('SELECT 1')), probe(() => this.redis.ping())]);
    const ok = postgres.status === 'up' && redis.status === 'up';
    res.status(ok ? 200 : 503);
    return {
      status: ok ? 'ok' : 'degraded',
      instance: process.env.INSTANCE_NAME ?? 'api',
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: { postgres, redis },
    };
  }
}
