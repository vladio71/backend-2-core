// Що це: перетворює REDIS_URL у опції з'єднання для BullMQ (він хоче host/port, а не url).
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export function redisConnectionFromUrl(url: string): RedisConnectionOptions {
  const parsed = new URL(url);
  const options: RedisConnectionOptions = { host: parsed.hostname, port: Number(parsed.port || 6379) };
  if (parsed.password) options.password = decodeURIComponent(parsed.password);
  const db = parsed.pathname.replace('/', '');
  if (db) options.db = Number(db);
  return options;
}
