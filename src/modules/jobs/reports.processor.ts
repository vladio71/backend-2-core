// Що це: воркер черги reports. 5 кроків по REPORT_STEP_MS, прогрес через job.updateProgress,
// випадкове падіння з імовірністю failRate (для демо retry), публікація статусу в Redis.
// Чому окремий процес: довга робота не має ділити CPU і пул з'єднань із HTTP-запитами.
// Хто викликає: BullMQ Worker (створює @nestjs/bullmq за декоратором @Processor) у процесі src/worker.ts.
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Report, ReportStatus } from './report.entity';
import { REPORTS_QUEUE, ReportJobData } from './queues';
import { ReportEventsService } from './report-events.service';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { AppLogger } from '../logging/app-logger';
import { runWithRequestId } from '../logging/request-context';

const STEPS = 5;

@Processor(REPORTS_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) })
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new AppLogger('ReportsProcessor');

  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    private readonly events: ReportEventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  async process(job: Job<ReportJobData>): Promise<Record<string, unknown>> {
    // requestId з job-у: логи воркера зв'язані з HTTP-запитом, який цей job створив.
    return runWithRequestId(job.data.requestId, () => this.run(job));
  }

  private async run(job: Job<ReportJobData>): Promise<Record<string, unknown>> {
    const { reportId, userId, failRate } = job.data;
    const attempt = job.attemptsMade + 1;
    this.logger.info(`Звіт ${reportId}: спроба ${attempt}, старт`);
    await this.setStatus(reportId, userId, 'active', 0, attempt);

    for (let step = 1; step <= STEPS; step++) {
      await sleep(this.config.REPORT_STEP_MS);
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
