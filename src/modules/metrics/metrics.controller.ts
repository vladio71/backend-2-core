// Що це: GET /metrics на API. Віддає всі метрики процесу текстом у форматі Prometheus.
// Чому без auth: Prometheus ходить сюди по внутрішній мережі compose; назовні через nginx цей шлях не варто відкривати.
// Хто викликає: Prometheus кожні 5 с (observability/prometheus.yml), людина через curl localhost:3000/metrics.
import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

@ApiExcludeController() // не для фронтенду, тому не засмічуємо /reference
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  text(): Promise<string> {
    return this.metrics.metricsText();
  }
}
