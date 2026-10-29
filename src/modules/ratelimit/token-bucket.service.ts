// Що це: власний token bucket у Redis. Атомарно через Lua-скрипт.
// Чому Lua: "прочитати токени, порахувати, записати" з Node це три команди; між ними може влізти інший
// запит і обидва пройдуть. Lua виконується в Redis як одна операція.
// Хто викликає: TokenBucketGuard.
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';

export interface BucketDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  // Unix-секунди, коли відро знову буде повним.
  resetAt: number;
  retryAfterSeconds: number;
}

// KEYS[1] = ключ відра; ARGV = capacity, refillPerSecond, nowMs, cost
// Відро зберігає два поля: tokens (скільки лишилось) і ts (коли востаннє рахували).
const LUA_TAKE = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now
end

-- долити токени за час, що минув
local elapsed = math.max(0, now - ts) / 1000.0
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
-- ключ зникає сам, коли відро давно повне
redis.call('PEXPIRE', key, math.ceil(capacity / refill * 1000) + 1000)

return { allowed, tokens }
`;

@Injectable()
export class TokenBucketService {
  private readonly capacity: number;
  private readonly refillPerSecond: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.capacity = config.RATE_LIMIT_CAPACITY;
    // 10 запитів за 10 с = 1 токен/с. Відро повне = 10, кожен запит бере 1.
    this.refillPerSecond = config.RATE_LIMIT_CAPACITY / config.RATE_LIMIT_WINDOW_SECONDS;
  }

  async take(subject: string, cost = 1): Promise<BucketDecision> {
    const now = Date.now();
    const raw = (await this.redis.eval(LUA_TAKE, 1, `ratelimit:${subject}`, this.capacity, this.refillPerSecond, now, cost)) as [number, string];
    const allowed = Number(raw[0]) === 1;
    const tokens = Number(raw[1]);
    const missing = Math.max(0, cost - tokens);
    const retryAfterSeconds = allowed ? 0 : Math.ceil(missing / this.refillPerSecond);
    const secondsToFull = (this.capacity - tokens) / this.refillPerSecond;
    return {
      allowed,
      limit: this.capacity,
      remaining: Math.floor(tokens),
      resetAt: Math.ceil(now / 1000 + secondsToFull),
      retryAfterSeconds,
    };
  }
}
