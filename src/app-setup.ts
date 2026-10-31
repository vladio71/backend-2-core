// Що це: спільне налаштування Nest-застосунку для main.ts і для тестів: ValidationPipe, фільтр помилок,
// Redis-адаптер socket.io. Винесено окремо, щоб тести не імпортували main.ts (там Scalar, helmet, listen).
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './modules/errors/http-exception.filter';
import { RedisIoAdapter } from './modules/live/redis-io.adapter';

export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    // whitelist: невідомі поля відкидаються; forbidNonWhitelisted: і це помилка 400 з назвою поля.
    whitelist: true,
    forbidNonWhitelisted: true,
    // transform: тіло стає екземпляром DTO; @Type(() => Number) перетворює "42" -> 42.
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });
}

export function setupApp(app: INestApplication, redisUrl: string): void {
  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useWebSocketAdapter(new RedisIoAdapter(app, redisUrl));
  // SIGTERM/SIGINT -> onModuleDestroy/onApplicationShutdown у всіх модулях (черги, БД, Redis).
  app.enableShutdownHooks();
}

// GET /openapi.json: документ Swagger. Окремо від setupApp, бо Scalar (/reference) монтує лише main.ts,
// а сам JSON потрібен і тестам. Викликати до app.init(), інакше 404-обробник Nest стане раніше за маршрут.
export function setupOpenApi(app: INestApplication): OpenAPIObject {
  const openapi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('devhub').setDescription('Навчальний backend: усі ендпоінти').setVersion('1.0').addBearerAuth().build(),
  );
  const http = app.getHttpAdapter().getInstance();
  http.get('/openapi.json', (_req: unknown, res: { json: (body: unknown) => void }) => res.json(openapi));
  return openapi;
}
