// Що це: модуль ratelimit: власний token bucket + @nestjs/throttler для порівняння.
// Хто викликає: AppModule; PostsModule бере TokenBucketGuard.
//
// Чому throttler зберігає лічильники в Redis, а не в пам'яті: за nginx працюють два процеси API (api-1, api-2).
// З лічильником у пам'яті кожен процес рахує окремо: 12 запитів розкидає 6 + 6, і жоден не перевищить 10.
// Спільне сховище в Redis робить ліміт одним на всі інстанси. Те саме правило, що й для власного token bucket.
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type Redis from 'ioredis';
import { REDIS, RedisModule } from '../redis/redis.module';
import { TokenBucketService } from './token-bucket.service';
import { TokenBucketGuard } from './token-bucket.guard';
import { ThrottlerDemoController } from './throttler-demo.controller';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 10_000, limit: 10 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
  ],
  controllers: [ThrottlerDemoController],
  providers: [TokenBucketService, TokenBucketGuard],
  exports: [TokenBucketService, TokenBucketGuard],
})
export class RatelimitModule {}
