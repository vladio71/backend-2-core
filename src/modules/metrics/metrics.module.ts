// Що це: два модулі метрик, по одному на тип процесу. Обидва @Global, щоб ReportsProcessor міг інжектити
// MetricsService без імпорту.
//   MetricsModule (API):       MetricsService + GET /metrics (контролер) + middleware на всі маршрути.
//   MetricsWorkerModule (воркер): MetricsService + окремий node:http сервер на METRICS_PORT.
// Чому не один модуль: у воркері немає Nest HTTP, у API не потрібен другий сервер. Спільне тут лише сервіс.
// Хто викликає: AppModule імпортує MetricsModule, WorkerModule імпортує MetricsWorkerModule.
// e2e-тести піднімають AppModule + JobsWorkerModule, тому там працює варіант для API (сервер воркера не стартує).
import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EVENTS_QUEUE, REPORTS_QUEUE } from '../../common/queues';
import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';
import { MetricsService } from './metrics.service';
import { MetricsHttpServer } from './metrics-http-server';

// MetricsService читає лічильники черг через Queue, тому реєструємо ті самі черги, що й JobsModule
// (повторна реєстрація тієї самої черги у @nestjs/bullmq допустима: Queue-об'єкт один на ім'я).
const queues = BullModule.registerQueue({ name: REPORTS_QUEUE }, { name: EVENTS_QUEUE });

@Global()
@Module({
  imports: [queues],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Після RequestIdMiddleware з AppModule порядок не важливий: обидва лише вішають res.on('finish').
    consumer.apply(MetricsMiddleware).forRoutes('*path');
  }
}

@Global()
@Module({
  imports: [queues],
  providers: [MetricsService, MetricsHttpServer],
  exports: [MetricsService],
})
export class MetricsWorkerModule {}
