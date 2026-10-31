// Що це: кореневий модуль ВОРКЕРА. Без Nest HTTP, без контролерів, без крону. Тільки БД, Redis, процесори
// і маленький сервер метрик для Prometheus.
// Хто викликає: worker.ts і e2e-тести (щоб job-и виконувались in-process).
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, APP_CONFIG } from './modules/config/config.module';
import { AppConfig } from './modules/config/config.schema';
import { DatabaseModule } from './modules/database/database.module';
import { entities } from './entities';
import { RedisModule } from './modules/redis/redis.module';
import { JobsWorkerModule } from './modules/jobs/jobs-worker.module';
import { MetricsWorkerModule } from './modules/metrics/metrics.module';
import { redisConnectionFromUrl } from './modules/redis/redis-connection';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule.forRoot(entities),
    RedisModule,
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ connection: redisConnectionFromUrl(config.REDIS_URL), prefix: 'devhub' }),
    }),
    MetricsWorkerModule, // /metrics на METRICS_PORT (9464): у воркера немає Nest HTTP, тому окремий маленький сервер
    JobsWorkerModule,
  ],
})
export class WorkerModule {}
