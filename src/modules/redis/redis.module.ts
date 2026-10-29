// Що це: один клієнт ioredis на весь процес, доступний через токен REDIS.
// Чому: Redis-клієнт тримає TCP-з'єднання; створювати його в кожному сервісі марно.
// Для pub/sub і socket.io адаптера роблять client.duplicate(), бо підписаний клієнт не може виконувати команди.
// Хто викликає: AppModule, WorkerModule; сервіси інжектять @Inject(REDIS).
import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { AppLogger } from '../logging/app-logger';

export const REDIS = 'REDIS';

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false, enableReadyCheck: true });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Redis => createRedis(config.REDIS_URL),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new AppLogger('Redis');

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  // Крок graceful shutdown: закриваємо Redis після того, як HTTP-сервер уже не приймає запити.
  async onApplicationShutdown(): Promise<void> {
    this.logger.info('Закриваю з\'єднання з Redis');
    await this.redis.quit().catch(() => undefined);
  }
}
