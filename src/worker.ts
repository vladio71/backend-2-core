// Що це: точка входу воркера. Окремий процес: npm run start:worker.
// Чому: job-и (звіти по 5 с, пачки подій) не мають ділити event loop з HTTP.
// Graceful shutdown: SIGTERM -> Nest закриває Worker-и BullMQ (чекають поточний job) -> БД -> Redis -> exit.
// Перший import: трейсинг має запатчити pg/ioredis до того, як їх завантажить Nest (див. src/tracing.ts).
import './tracing';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { AppLogger } from './modules/logging/app-logger';

async function bootstrap(): Promise<void> {
  const logger = new AppLogger('Worker');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger });
  app.enableShutdownHooks();
  await app.init();
  logger.info(`Воркер запущений (concurrency=${process.env.WORKER_CONCURRENCY ?? 2})`);
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
