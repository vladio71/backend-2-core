// Що це: точка входу API. Створює Nest-застосунок, вмикає helmet, CORS, валідацію, фільтр помилок,
// Swagger (/openapi.json) і Scalar (/reference), Redis-адаптер socket.io, graceful shutdown.
// Хто викликає: npm start (node dist/main.js).
// Перший import: трейсинг має запатчити http/express/pg/ioredis до того, як їх завантажить Nest (див. src/tracing.ts).
import './tracing';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AppLogger } from './modules/logging/app-logger';
import { APP_CONFIG } from './modules/config/config.module';
import { AppConfig } from './modules/config/config.schema';
import { setupApp, setupOpenApi } from './app-setup';

async function bootstrap(): Promise<void> {
  const logger = new AppLogger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger, bufferLogs: false });
  const config = app.get<AppConfig>(APP_CONFIG);

  // За nginx (і api-1/api-2 за ним) TCP-з'єднання приходить з IP проксі, а справжній клієнт лежить у X-Forwarded-For.
  // trust proxy = 1 каже Express довіряти рівно одному проксі-хопу (nginx): тоді req.ip це IP клієнта,
  // і rate limit для анонімів (ключ ip:<req.ip>) не склеює всіх в один кошик. Більше 1 не ставимо: інакше клієнт
  // зміг би підробити X-Forwarded-For і обійти ліміт.
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false })); // CSP вимкнено, бо Scalar і демо-сторінка вантажать скрипти з CDN
  app.enableCors({
    origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    // Без exposedHeaders браузер не дає JS читати нестандартні заголовки з іншого origin (learn/ на :5173).
    exposedHeaders: ['X-Request-Id', 'X-Cache', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
  });
  setupApp(app, config.REDIS_URL);
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/demo' });

  setupOpenApi(app);
  app.use('/reference', apiReference({ url: '/openapi.json', theme: 'kepler' }));

  await app.listen(config.PORT);
  logger.info(`API ${config.INSTANCE_NAME} слухає на :${config.PORT}, env=${config.NODE_ENV}`);
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
