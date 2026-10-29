// Що це: middleware, яке бере X-Request-Id із запиту або генерує новий, кладе його
// в AsyncLocalStorage і повертає у відповіді тим самим заголовком.
// Чому: по одному id можна знайти всі логи одного запиту в API і у воркері.
// Хто викликає: AppModule.configure() застосовує його на всі маршрути.
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithRequestId } from './request-context';
import { AppLogger } from './app-logger';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new AppLogger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && incoming.length > 0 && incoming.length < 128 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const started = Date.now();
    runWithRequestId(requestId, () => {
      res.on('finish', () => {
        this.logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
      });
      next();
    });
  }
}
