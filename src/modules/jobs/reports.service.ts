// Що це: API-сторона звітів: створити рядок у БД, поставити job у чергу, віддати статус.
// Чому рядок у БД ПЕРЕД enqueue: див. report.entity.ts. Чому 429 QUEUE_FULL: backpressure.
// Якщо черга вже має QUEUE_MAX_WAITING job-ів, приймати нові означає обіцяти те, що не виконаємо швидко.
// Хто викликає: ReportsController.
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { context, propagation } from '@opentelemetry/api';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';
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
    // Рахуємо лише 'waiting'. Job-и в 'delayed' (чекають backoff після невдалої спроби) сюди не входять, тож під час
    // шторму збоїв реальна черга трохи більша за ліміт. Для суворішого backpressure: getJobCounts('waiting', 'delayed').
    const waiting = await this.queue.getWaitingCount();
    if (waiting >= this.config.QUEUE_MAX_WAITING) {
      throw new TooManyRequestsError('QUEUE_FULL', `Черга переповнена: ${waiting} job-ів чекають`, 5);
    }
    // 1. Рядок у БД.
    const report = await this.reports.save(this.reports.create({ userId, failRate, status: 'queued' }));
    // 2. Job у чергу. jobId = id звіту, щоб повторний enqueue того самого звіту був неможливий.
    // У data кладемо traceparent поточного HTTP-запиту: воркер в іншому процесі продовжить цей трейс.
    // Без OTEL_EXPORTER_OTLP_ENDPOINT propagation.inject нічого не пише і carrier лишається порожнім.
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    await this.queue.add(
      'generate',
      { reportId: report.id, userId, failRate, requestId: getRequestId() ?? 'no-request-id', traceparent: carrier.traceparent, tracestate: carrier.tracestate },
      { jobId: report.id, attempts: 3, backoff: { type: 'exponential', delay: 500 }, removeOnComplete: 100, removeOnFail: 100 },
    );
    return { id: report.id, status: 'queued', statusUrl: `/reports/${report.id}`, eventsUrl: `/reports/${report.id}/events` };
  }

  async get(userId: string, id: string): Promise<Report> {
    const report = await this.reports.findOne({ where: { id, userId } });
    if (!report) throw new NotFoundError('Report', id);
    return report;
  }

  // ТІЛЬКИ ДЛЯ ДЕМО (сторінка "Черга і воркер"): прибрати з черги job-и цього користувача, які ще чекають воркера.
  // Після flood на 120 звітів черга розсмоктувалась би хвилин 5; так сторінку можна повторювати.
  // Активні job-и не чіпаємо, вони добіжать за 5 с. Рядки звітів у БД позначаємо failed, щоб не висіли в "queued".
  async drainMine(userId: string): Promise<{ removed: number }> {
    if (this.config.NODE_ENV === 'production') throw new NotFoundError('Route', 'demo');
    const jobs = await this.queue.getJobs(['waiting', 'delayed'], 0, -1);
    const mine = jobs.filter((job) => job.data.userId === userId);
    for (const job of mine) await job.remove();
    if (mine.length > 0) {
      await this.reports.update({ id: In(mine.map((job) => job.data.reportId)), status: 'queued' }, { status: 'failed', error: 'Прибрано з черги демо-кнопкою' });
    }
    return { removed: mine.length };
  }

  async queueStats(): Promise<{ waiting: number; active: number; completed: number; failed: number; maxWaiting: number }> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    return { waiting: counts.waiting, active: counts.active, completed: counts.completed, failed: counts.failed, maxWaiting: this.config.QUEUE_MAX_WAITING };
  }
}
