// Що це: точка входу API. Створює Nest-застосунок, вмикає helmet, CORS, валідацію, фільтр помилок,
// Swagger (/openapi.json) і Scalar (/reference), Redis-адаптер socket.io, graceful shutdown.
// Хто викликає: npm start (node dist/main.js).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AppLogger } from './modules/logging/app-logger';
import { APP_CONFIG } from './modules/config/config.module';
import { AppConfig } from './modules/config/config.schema';
import { setupApp } from './app-setup';

async function bootstrap(): Promise<void> {
  const logger = new AppLogger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger, bufferLogs: false });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.use(helmet({ contentSecurityPolicy: false })); // CSP вимкнено, бо Scalar і демо-сторінка вантажать скрипти з CDN
  app.enableCors({ origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()), credentials: true });
  setupApp(app, config.REDIS_URL);
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/demo' });

  const openapi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('devhub').setDescription('Навчальний backend: усі ендпоінти').setVersion('1.0').addBearerAuth().build(),
  );
  const http = app.getHttpAdapter().getInstance();
  http.get('/openapi.json', (_req: unknown, res: { json: (body: unknown) => void }) => res.json(openapi));
  app.use('/reference', apiReference({ url: '/openapi.json', theme: 'kepler' }));

  await app.listen(config.PORT);
  logger.info(`API ${config.INSTANCE_NAME} слухає на :${config.PORT}, env=${config.NODE_ENV}`);
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
