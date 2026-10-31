// Що це: воркер черги reports. 5 кроків по REPORT_STEP_MS, прогрес через job.updateProgress,
// випадкове падіння з імовірністю failRate (для демо retry), публікація статусу в Redis.
// Чому окремий процес: довга робота не має ділити CPU і пул з'єднань із HTTP-запитами.
// Хто викликає: BullMQ Worker (створює @nestjs/bullmq за декоратором @Processor) у процесі src/worker.ts.
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { context, propagation, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Report, ReportStatus } from './report.entity';
import { REPORTS_QUEUE, ReportJobData } from './queues';
import { ReportEventsPublisher } from './report-events.publisher';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { AppLogger } from '../logging/app-logger';
import { runWithRequestId } from '../logging/request-context';
import { MetricsService } from '../metrics/metrics.service';

const STEPS = 5;

@Processor(REPORTS_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) })
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new AppLogger('ReportsProcessor');
  private readonly tracer = trace.getTracer('devhub-worker');

  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    private readonly events: ReportEventsPublisher,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    // Глобальний модуль метрик (MetricsWorkerModule у воркері, MetricsModule у e2e-тестах).
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<ReportJobData>): Promise<Record<string, unknown>> {
    // requestId з job-у: логи воркера зв'язані з HTTP-запитом, який цей job створив.
    // traceparent з job-у: span воркера стає дочірнім до span-у POST /reports, і в Jaeger це один трейс
    // (HTTP-запит -> enqueue -> робота воркера -> SQL і Redis усередині). Без трейсингу все це no-op.
    const parent = propagation.extract(context.active(), { traceparent: job.data.traceparent, tracestate: job.data.tracestate });
    return this.tracer.startActiveSpan(
      'reports.generate',
      { kind: SpanKind.CONSUMER, attributes: { 'job.id': job.id ?? '', 'report.id': job.data.reportId, 'job.attempt': job.attemptsMade + 1 } },
      parent,
      async (span) => {
        try {
          return await runWithRequestId(job.data.requestId, () => this.run(job));
        } catch (error) {
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private async run(job: Job<ReportJobData>): Promise<Record<string, unknown>> {
    const { reportId, userId, failRate } = job.data;
    const attempt = job.attemptsMade + 1;
    this.logger.info(`Звіт ${reportId}: спроба ${attempt}, старт`);
    await this.setStatus(reportId, userId, 'active', 0, attempt);

    for (let step = 1; step <= STEPS; step++) {
      // Окремий span на кожен крок: у Jaeger видно, який саме крок звіту був довгим.
      await this.tracer.startActiveSpan(`report.step ${step}`, async (stepSpan) => {
        try {
          await sleep(this.config.REPORT_STEP_MS);
        } finally {
          stepSpan.end();
        }
      });
      if (failRate > 0 && Math.random() < failRate) {
        throw new Error(`Імітація збою на кроці ${step}`);
      }
      const progress = Math.round((step / STEPS) * 100);
      await job.updateProgress(progress);
      await this.setStatus(reportId, userId, 'active', progress, attempt);
    }
    const result = { rows: 1234, generatedAt: new Date().toISOString(), attempt };
    await this.reports.update({ id: reportId }, { status: 'completed', progress: 100, result, error: null, attempts: attempt });
    await this.events.publish({ reportId, userId, status: 'completed', progress: 100, attempt, result, at: new Date().toISOString() });
    this.logger.info(`Звіт ${reportId}: готово`);
    // reports_processed_total{status="completed"}: Grafana показує "звітів за хвилину" з цього лічильника.
    this.metrics.reportsProcessed.inc({ status: 'completed' });
    return result;
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ReportJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const { reportId, userId } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= maxAttempts;
    // Не остання спроба: BullMQ сам поставить job у чергу з backoff. Остання: фіксуємо failed з текстом помилки.
    const status: ReportStatus = exhausted ? 'failed' : 'queued';
    // Рахуємо лише остаточний failed: невдала спроба з retry попереду це ще не втрачений звіт.
    if (exhausted) this.metrics.reportsProcessed.inc({ status: 'failed' });
    this.logger.warn(`Звіт ${reportId}: спроба ${job.attemptsMade}/${maxAttempts} упала: ${error.message}`);
    await this.reports.update({ id: reportId }, { status, error: error.message, attempts: job.attemptsMade });
    await this.events.publish({ reportId, userId, status, progress: 0, attempt: job.attemptsMade, error: error.message, at: new Date().toISOString() });
  }

  private async setStatus(reportId: string, userId: string, status: ReportStatus, progress: number, attempt: number): Promise<void> {
    await this.reports.update({ id: reportId }, { status, progress, attempts: attempt });
    await this.events.publish({ reportId, userId, status, progress, attempt, at: new Date().toISOString() });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
