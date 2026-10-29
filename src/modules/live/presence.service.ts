// Що це: хто онлайн. Ключ presence:<userId> із TTL 30 с, оновлюється heartbeat-ом.
// Чому TTL: якщо процес API впав, disconnect не прийде. Ключ сам зникне через 30 с.
// Чому Redis, а не Map у пам'яті: два інстанси API мають бачити один список.
// Хто викликає: LiveGateway.
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export interface OnlineUser {
  userId: string;
  displayName: string;
}

const TTL_SECONDS = 30;

@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async markOnline(user: OnlineUser): Promise<void> {
    await this.redis.set(`presence:${user.userId}`, JSON.stringify(user), 'EX', TTL_SECONDS);
    await this.redis.incr(`presence:conn:${user.userId}`);
    await this.redis.expire(`presence:conn:${user.userId}`, TTL_SECONDS);
  }

  async heartbeat(user: OnlineUser): Promise<void> {
    await this.redis.set(`presence:${user.userId}`, JSON.stringify(user), 'EX', TTL_SECONDS);
    await this.redis.expire(`presence:conn:${user.userId}`, TTL_SECONDS);
  }

  // Користувач може мати 3 вкладки. Офлайн тільки коли закрилася остання.
  async markOffline(userId: string): Promise<void> {
    const left = await this.redis.decr(`presence:conn:${userId}`);
    if (left <= 0) {
      await this.redis.del(`presence:${userId}`, `presence:conn:${userId}`);
    }
  }

  async list(): Promise<OnlineUser[]> {
    // SCAN замість KEYS: KEYS блокує Redis на великих базах.
    const users: OnlineUser[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', 'presence:*', 'COUNT', 100);
      cursor = next;
      const userKeys = keys.filter((k) => !k.startsWith('presence:conn:'));
      if (userKeys.length > 0) {
        const values = await this.redis.mget(...userKeys);
        for (const v of values) if (v) users.push(JSON.parse(v) as OnlineUser);
      }
    } while (cursor !== '0');
    return users.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}
