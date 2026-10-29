// Що це: zod-схема всіх змінних оточення. Читаємо process.env ОДИН раз, тут.
// Чому: далі код працює з типізованим об'єктом, а не з рядками "undefined".
// Хто викликає: loadConfig() з config.module.ts під час старту API і воркера.
import { z } from 'zod';

const booleanFromString = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  INSTANCE_NAME: z.string().default('api'),
  // Порт сервера /metrics у воркері (у API метрики на тому самому PORT). Prometheus ходить на worker:9464.
  METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),

  // Обов'язкові. Без них застосунок не стартує (див. loadConfig).
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  // Пул з'єднань до Postgres. Малий max навмисно, щоб побачити чергу в /demo/pool/slow.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_ACQUIRE_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
  DB_LOG_QUERIES: booleanFromString,

  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(15 * 60),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  RATE_LIMIT_CAPACITY: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(10),

  QUEUE_MAX_WAITING: z.coerce.number().int().min(1).default(100),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  REPORT_STEP_MS: z.coerce.number().int().min(1).default(1000),

  GITHUB_TOKEN: z.string().optional(),
  GITHUB_API_URL: z.string().default('https://api.github.com'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  PGVECTOR: booleanFromString,
  BULL_BOARD_OPEN: booleanFromString,
});

export type AppConfig = z.infer<typeof configSchema>;
