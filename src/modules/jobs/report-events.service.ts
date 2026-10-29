// Що це: міст Redis pub/sub -> процес API. Воркер публікує ReportEvent у канал, тут ми підписуємося
// і роздаємо підписникам у процесі (SSE-обробник, LiveGateway).
// Чому pub/sub, а не прямий виклик: воркер це ІНШИЙ процес. Спільного пам'яті немає, є тільки Redis.
// Хто викликає: JobsModule (API). publish() викликає ReportsProcessor (воркер).
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { REPORT_EVENTS_CHANNEL, ReportEvent } from './queues';
import { AppLogger } from '../logging/app-logger';

export type ReportEventListener = (event: ReportEvent) => void;

@Injectable()
export class ReportEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger('ReportEvents');
  private readonly emitter = new EventEmitter();
  private subscriber: Redis | null = null;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    this.emitter.setMaxListeners(1000);
  }

  async onModuleInit(): Promise<void> {
    // Підписаний клієнт не може виконувати інші команди, тому duplicate().
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(REPORT_EVENTS_CHANNEL);
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as ReportEvent;
        this.emitter.emit('event', event);
      } catch (err) {
        this.logger.error('Невалідне повідомлення у каналі звітів', err);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  // Воркер викликає це після кожної зміни статусу.
  async publish(event: ReportEvent): Promise<void> {
    await this.redis.publish(REPORT_EVENTS_CHANNEL, JSON.stringify(event));
  }

  subscribe(listener: ReportEventListener): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
