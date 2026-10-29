// Що це: воркер черги events. Висока concurrency (100): багато job-ів "у польоті" одночасно,
// BatchCollector збирає їх і пише ОДНИМ multi-row INSERT до 100 рядків.
// Хто викликає: BullMQ Worker у процесі воркера.
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { OnModuleDestroy } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { EVENTS_QUEUE, EventJobData } from './queues';
import { BatchCollector } from './batch-collector';
import { AppLogger } from '../logging/app-logger';

export const EVENTS_BATCH_SIZE = 100;
export const EVENTS_BATCH_WAIT_MS = 50;

@Processor(EVENTS_QUEUE, { concurrency: 100 })
export class EventsProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new AppLogger('EventsProcessor');
  private readonly collector: BatchCollector<EventJobData>;

  constructor(private readonly dataSource: DataSource) {
    super();
    this.collector = new BatchCollector<EventJobData>((items) => this.insertBatch(items), EVENTS_BATCH_SIZE, EVENTS_BATCH_WAIT_MS);
  }

  async process(job: Job<EventJobData>): Promise<void> {
    await this.collector.add(job.data);
  }

  get flushes(): number {
    return this.collector.flushes;
  }

  async onModuleDestroy(): Promise<void> {
    await this.collector.drain();
  }

  // Один INSERT з N кортежами: INSERT INTO events (...) VALUES ($1,$2,$3),($4,$5,$6),...
  private async insertBatch(items: EventJobData[]): Promise<void> {
    const values: string[] = [];
    const params: unknown[] = [];
    items.forEach((item, i) => {
      const base = i * 3;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      params.push(item.userId, item.type, JSON.stringify(item.payload));
    });
    await this.dataSource.query(`INSERT INTO events (user_id, type, payload) VALUES ${values.join(', ')}`, params);
    this.logger.info(`Записано пачку подій: ${items.length}`);
  }
}
