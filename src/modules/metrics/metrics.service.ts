// Що це: усі метрики процесу (API або воркера) в одному реєстрі prom-client, плюс текст для GET /metrics.
// Чому один сервіс на процес: Prometheus раз на 5 с забирає ВСІ числа одним запитом, тому їх зручно тримати разом.
// Лічильники тут нічого не "шлють": вони просто лежать у пам'яті, а Prometheus сам приходить і читає (pull-модель).
// Хто викликає: MetricsMiddleware (HTTP), ReportsProcessor (звіти), MetricsController і MetricsHttpServer (віддають текст).
// Документація: docs/observability.md.
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { DataSource } from 'typeorm';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { EVENTS_QUEUE, REPORTS_QUEUE } from '../../common/queues';
import { AppLogger } from '../logging/app-logger';

// Стани job-у у BullMQ, які показуємо як окремі серії bullmq_queue_jobs{state=...}.
export const QUEUE_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed'] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

// Як часто перечитувати лічильники черг з Redis. Частіше немає сенсу: Prometheus і так приходить раз на 5 с.
export const QUEUE_REFRESH_MS = 5000;

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger('Metrics');
  // Власний Registry, а не глобальний default: у e2e-тестах кілька Nest-застосунків живуть в одному процесі,
  // і з глобальним реєстром друга реєстрація http_requests_total впала б з "metric already registered".
  readonly registry = new Registry();

  // ---------- HTTP (тільки API) ----------
  // Counter: тільки росте. Скільки запитів прийшло, з розбивкою на метод, маршрут і статус.
  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Кількість HTTP-запитів за методом, маршрутом (шаблон /posts/:id, не сирий URL) і статусом',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });
  // Histogram: скільки запитів вклалося у 5 мс, 10 мс, ... 10 с. З нього Grafana рахує p50 і p95.
  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Тривалість HTTP-запиту в секундах (від приходу до відправки відповіді)',
    labelNames: ['method', 'route'] as const,
    // Межі кошиків: від 5 мс (кеш у Redis) до 10 с (/demo/pool/slow). Запит у кошик "le=0.1" це "вклався у 100 мс".
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  // Gauge: може рости і падати. Скільки запитів ПРОСТО ЗАРАЗ усередині API (прийшли, відповідь ще не пішла).
  readonly httpRequestsInFlight = new Gauge({
    name: 'http_requests_in_flight',
    help: 'Скільки HTTP-запитів обробляється просто зараз',
    registers: [this.registry],
  });

  // ---------- Пул з'єднань до Postgres ----------
  // Ті самі числа, що й у GET /demo/pool/stats, але Prometheus запам'ятовує їх у часі.
  // collect() викликається у момент, коли Prometheus читає /metrics, тому жодного таймера не треба.
  readonly pgPoolTotal: Gauge = this.poolGauge('pg_pool_total', "Скільки з'єднань з Postgres відкрито зараз (зайнятих + вільних)", (p) => p.totalCount);
  readonly pgPoolIdle: Gauge = this.poolGauge('pg_pool_idle', "Скільки з'єднань з Postgres вільні (відкриті, але ніхто не використовує)", (p) => p.idleCount);
  readonly pgPoolWaiting: Gauge = this.poolGauge('pg_pool_waiting', "Скільки запитів чекають на вільне з'єднання (пул вичерпано). Має бути 0", (p) => p.waitingCount);

  // ---------- Черги BullMQ ----------
  // Лічильники лежать у Redis, читати їх на кожен scrape дорого (5 команд на чергу), тому оновлюємо раз на 5 с таймером.
  readonly queueJobs = new Gauge({
    name: 'bullmq_queue_jobs',
    help: 'Скільки job-ів у черзі в кожному стані (waiting, active, completed, failed, delayed)',
    labelNames: ['queue', 'state'] as const,
    registers: [this.registry],
  });

  // ---------- Звіти (тільки воркер) ----------
  readonly reportsProcessed = new Counter({
    name: 'reports_processed_total',
    help: 'Скільки звітів воркер довів до кінця: status=completed або failed (після всіх retry)',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(REPORTS_QUEUE) private readonly reportsQueue: Queue,
    @InjectQueue(EVENTS_QUEUE) private readonly eventsQueue: Queue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    // Стандартні метрики Node: пам'ять процесу, купа V8, затримка event loop, CPU, активні handle-и.
    // Префікс нема навмисно: process_* і nodejs_* це загальноприйняті імена, під них є готові дашборди.
    // Хто який процес (api-1, api-2, worker), Prometheus підписує сам label-ом service з observability/prometheus.yml.
    collectDefaultMetrics({ register: this.registry });
    this.logger.debug(`Реєстр метрик створено для ${config.INSTANCE_NAME}`);
    // Серії з нульовим значенням мають існувати ще до першого звіту, інакше у Grafana "No data" замість 0.
    this.reportsProcessed.inc({ status: 'completed' }, 0);
    this.reportsProcessed.inc({ status: 'failed' }, 0);
  }

  onModuleInit(): void {
    void this.refreshQueues();
    this.refreshTimer = setInterval(() => void this.refreshQueues(), QUEUE_REFRESH_MS);
    // unref: таймер не тримає процес живим (інакше jest і graceful shutdown чекали б на нього).
    this.refreshTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  // Текст у форматі Prometheus: рядки виду `http_requests_total{method="GET",route="/posts",status="200"} 42`.
  metricsText(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  // Викликається з MetricsMiddleware після відправки відповіді.
  observeHttp(method: string, route: string, status: number, durationSeconds: number): void {
    this.httpRequestsTotal.inc({ method, route, status: String(status) });
    this.httpRequestDuration.observe({ method, route }, durationSeconds);
  }

  private poolGauge(name: string, help: string, read: (pool: Pool) => number): Gauge {
    const readPool = (): Pool | undefined => this.pool();
    return new Gauge({
      name,
      help,
      registers: [this.registry],
      // Звичайна function, а не стрілка: prom-client викликає collect з this = сам Gauge.
      collect() {
        const pool = readPool();
        this.set(pool ? read(pool) : 0);
      },
    });
  }

  private pool(): Pool | undefined {
    // TypeORM ховає pg.Pool у драйвері як master (так само робить PoolController).
    if (!this.dataSource.isInitialized) return undefined;
    const driver = this.dataSource.driver as PostgresDriver;
    return driver.master as Pool | undefined;
  }

  private async refreshQueues(): Promise<void> {
    for (const [name, queue] of [
      [REPORTS_QUEUE, this.reportsQueue],
      [EVENTS_QUEUE, this.eventsQueue],
    ] as const) {
      try {
        const counts = await queue.getJobCounts(...QUEUE_STATES);
        for (const state of QUEUE_STATES) this.queueJobs.set({ queue: name, state }, counts[state] ?? 0);
      } catch (error) {
        // Redis лежить або з'єднання вже закривається на shutdown: метрика лишається старою, API працює далі.
        this.logger.debug(`Не вдалося прочитати лічильники черги ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
