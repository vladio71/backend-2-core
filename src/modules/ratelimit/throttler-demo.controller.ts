// Що це: той самий ліміт, але готовою бібліотекою @nestjs/throttler (fixed window), для порівняння.
// Чому: щоб побачити різницю у поведінці на межі вікна (docs/modules/ratelimit.md).
// Хто викликає: GET /demo/throttled.
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UseGuards } from '@nestjs/common';

@ApiTags('demo')
@Controller('demo')
export class ThrottlerDemoController {
  @Get('throttled')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 10_000 } })
  throttled(): { ok: boolean; limiter: string } {
    return { ok: true, limiter: '@nestjs/throttler fixed window 10/10s' };
  }
}
