// Що це: публікація ReportEvent у Redis pub/sub. Це єдине, що потрібно воркеру від каналу звітів.
// Чому окремий клас: підписка (ReportEventsService) потрібна лише API, який роздає події в SSE і WebSocket.
// Воркер нічого не слухає, тож зайвого subscriber-з'єднання до Redis у нього бути не повинно.
// Хто викликає: ReportsProcessor (воркер).
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { REPORT_EVENTS_CHANNEL, ReportEvent } from './queues';

@Injectable()
export class ReportEventsPublisher {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(event: ReportEvent): Promise<void> {
    await this.redis.publish(REPORT_EVENTS_CHANNEL, JSON.stringify(event));
  }
}
