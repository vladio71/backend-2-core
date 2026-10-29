// Що це: API-сторона звітів: створити рядок у БД, поставити job у чергу, віддати статус.
// Чому рядок у БД ПЕРЕД enqueue: див. report.entity.ts. Чому 429 QUEUE_FULL: backpressure.
// Якщо черга вже має QUEUE_MAX_WAITING job-ів, приймати нові означає обіцяти те, що не виконаємо швидко.
// Хто викликає: ReportsController.
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Report } from './report.entity';
import { REPORTS_QUEUE, ReportJobData } from './queues';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { NotFoundError, TooManyRequestsError } from '../errors/domain-errors';
import { getRequestId } from '../logging/request-context';

export interface ReportAccepted {
  id: string;
  status: 'queued';
  statusUrl: string;
  eventsUrl: string;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectQueue(REPORTS_QUEUE) private readonly queue: Queue<ReportJobData>,
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, failRate: number): Promise<ReportAccepted> {
    const waiting = await this.queue.getWaitingCount();
    if (waiting >= this.config.QUEUE_MAX_WAITING) {
      throw new TooManyRequestsError('QUEUE_FULL', `Черга переповнена: ${waiting} job-ів чекають`, 5);
    }
    // 1. Рядок у БД.
    const report = await this.reports.save(this.reports.create({ userId, failRate, status: 'queued' }));
    // 2. Job у чергу. jobId = id звіту, щоб повторний enqueue того самого звіту був неможливий.
    await this.queue.add(
      'generate',
      { reportId: report.id, userId, failRate, requestId: getRequestId() ?? 'no-request-id' },
      { jobId: report.id, attempts: 3, backoff: { type: 'exponential', delay: 500 }, removeOnComplete: 100, removeOnFail: 100 },
    );
    return { id: report.id, status: 'queued', statusUrl: `/reports/${report.id}`, eventsUrl: `/reports/${report.id}/events` };
  }

  async get(userId: string, id: string): Promise<Report> {
    const report = await this.reports.findOne({ where: { id, userId } });
    if (!report) throw new NotFoundError('Report', id);
    return report;
  }

  async queueStats(): Promise<{ waiting: number; active: number; completed: number; failed: number; maxWaiting: number }> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    return { waiting: counts.waiting, active: counts.active, completed: counts.completed, failed: counts.failed, maxWaiting: this.config.QUEUE_MAX_WAITING };
  }
}
