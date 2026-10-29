// Що це: middleware, яке рахує кожен HTTP-запит: +1 до http_requests_total, тривалість у http_request_duration_seconds,
// і тримає http_requests_in_flight (скільки запитів усередині просто зараз).
// Чому label route = шаблон (/posts/:id), а не сирий URL (/posts/7f3a...): інакше кожен id дав би окрему серію,
// Prometheus роздувся б, а графік "p95 по /posts/:id" не склався б з тисячі одиночних точок.
// Хто викликає: MetricsModule.configure() застосовує на всі маршрути API. У воркері HTTP немає.
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

// Ці шляхи не рахуємо: /metrics смикає Prometheus кожні 5 с, /health смикає docker healthcheck.
// Вони б домінували у "запитах за секунду" і ховали справжній трафік.
const EXCLUDED_PATHS = new Set(['/metrics', '/health']);

// Express кладе збіглий маршрут у req.route після роутингу, тобто на момент відповіді він уже є.
// Для 404 (маршрут не знайдено) req.route порожній: такі запити йдуть у route="unmatched",
// щоб /nope, /admin.php і інший сміттєвий трафік не створювали нових серій.
export function routeLabel(req: Request): string {
  const route = (req as Request & { route?: { path?: string } }).route;
  const path = typeof route?.path === 'string' ? route.path : '';
  if (!path) return 'unmatched';
  // Маршрут усередині змонтованого роутера (Bull Board під /queues): додаємо префікс, де він змонтований.
  return `${req.baseUrl ?? ''}${path}`;
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // originalUrl, а не req.path: Nest монтує middleware під '*path', і req.path усередині це вже не повний шлях.
    if (EXCLUDED_PATHS.has(req.originalUrl.split('?')[0])) {
      next();
      return;
    }
    const started = process.hrtime.bigint();
    this.metrics.httpRequestsInFlight.inc();
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      this.metrics.httpRequestsInFlight.dec();
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.observeHttp(req.method, routeLabel(req), res.statusCode, seconds);
    };
    // finish: відповідь відправлена повністю. close: клієнт відвалився раніше (SSE, обірваний запит).
    res.on('finish', finish);
    res.on('close', finish);
    next();
  }
}
