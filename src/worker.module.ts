// Що це: кореневий модуль ВОРКЕРА. Без HTTP, без контролерів, без крону. Тільки БД, Redis, процесори.
// Хто викликає: worker.ts і e2e-тести (щоб job-и виконувались in-process).
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, APP_CONFIG } from './modules/config/config.module';
import { AppConfig } from './modules/config/config.schema';
import { DatabaseModule } from './modules/database/database.module';
import { RedisModule } from './modules/redis/redis.module';
import { JobsWorkerModule } from './modules/jobs/jobs-worker.module';
import { redisConnectionFromUrl } from './modules/redis/redis-connection';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ connection: redisConnectionFromUrl(config.REDIS_URL), prefix: 'devhub' }),
    }),
    JobsWorkerModule,
  ],
})
export class WorkerModule {}
