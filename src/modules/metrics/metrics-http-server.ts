// Що це: крихітний HTTP-сервер у ВОРКЕРІ тільки для GET /metrics (порт METRICS_PORT, типово 9464).
// Чому: воркер це Nest application context без HTTP (див. worker.ts), а Prometheus уміє лише "прийти і прочитати".
// Тому піднімаємо голий node:http без express і контролерів: один маршрут, кілька рядків.
// Хто викликає: MetricsWorkerModule; Prometheus ходить на worker:9464/metrics.
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { AppLogger } from '../logging/app-logger';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsHttpServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger('Metrics');
  private server?: Server;

  constructor(
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): Promise<void> {
    this.server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url?.split('?')[0] !== '/metrics') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('only GET /metrics\n');
        return;
      }
      this.metrics
        .metricsText()
        .then((text) => res.writeHead(200, { 'content-type': this.metrics.contentType, 'cache-control': 'no-store' }).end(text))
        .catch((error: unknown) => res.writeHead(500).end(error instanceof Error ? error.message : String(error)));
    });
    return new Promise((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.config.METRICS_PORT, () => {
        this.logger.info(`Метрики воркера на :${this.config.METRICS_PORT}/metrics`);
        resolve();
      });
    });
  }

  onModuleDestroy(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
}
