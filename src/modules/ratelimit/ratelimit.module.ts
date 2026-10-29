// Що це: модуль ratelimit: власний token bucket + @nestjs/throttler для порівняння.
// Хто викликає: AppModule; PostsModule бере TokenBucketGuard.
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TokenBucketService } from './token-bucket.service';
import { TokenBucketGuard } from './token-bucket.guard';
import { ThrottlerDemoController } from './throttler-demo.controller';

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 10_000, limit: 10 }])],
  controllers: [ThrottlerDemoController],
  providers: [TokenBucketService, TokenBucketGuard],
  exports: [TokenBucketService, TokenBucketGuard],
})
export class RatelimitModule {}
