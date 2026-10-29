import { TokenBucketService } from './token-bucket.service';
import { loadConfig } from '../config/config.module';
import Redis from 'ioredis';

// Фейковий Redis: виконує "Lua" у JS. Перевіряємо арифметику відра без справжнього Redis.
class FakeRedis {
  private store = new Map<string, { tokens: number; ts: number }>();
  async eval(_script: string, _n: number, key: string, capacity: number, refill: number, now: number, cost: number): Promise<[number, number]> {
    const cur = this.store.get(key) ?? { tokens: capacity, ts: now };
    let tokens = Math.min(capacity, cur.tokens + (Math.max(0, now - cur.ts) / 1000) * refill);
    let allowed = 0;
    if (tokens >= cost) {
      tokens -= cost;
      allowed = 1;
    }
    this.store.set(key, { tokens, ts: now });
    return [allowed, tokens];
  }
}

describe('TokenBucketService', () => {
  it('пускає 10 запитів і блокує 11-й з Retry-After', async () => {
    const cfg = loadConfig({ DATABASE_URL: 'x', JWT_SECRET: '0123456789abcdef0123', RATE_LIMIT_CAPACITY: '10', RATE_LIMIT_WINDOW_SECONDS: '10' });
    const svc = new TokenBucketService(new FakeRedis() as unknown as Redis, cfg);
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    for (let i = 0; i < 10; i++) {
      const d = await svc.take('user:1');
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(9 - i);
    }
    const blocked = await svc.take('user:1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    // через 3 секунди долилося 3 токени
    jest.spyOn(Date, 'now').mockReturnValue(1_003_000);
    const later = await svc.take('user:1');
    expect(later.allowed).toBe(true);
    expect(later.remaining).toBe(2);
  });
});
