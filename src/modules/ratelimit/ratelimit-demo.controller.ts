// Що це: POST /demo/ratelimit/reset. Очищає відро токенів поточного користувача, щоб демо на сторінці Rate limit завжди починалось з 10 з 10.
// Чому окремо від TokenBucketGuard: guard лише рахує, а скидання існує тільки для навчання і вимкнене у production.
// Хто викликає: сторінка learn/ "Rate limit" перед кожним сплеском.
import { Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TokenBucketService } from './token-bucket.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/roles';
import { AccessTokenPayload } from '../auth/jwt.service';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { NotFoundError } from '../errors/domain-errors';

@ApiTags('demo')
@ApiBearerAuth()
@Controller('demo/ratelimit')
@UseGuards(JwtAuthGuard)
export class RatelimitDemoController {
  constructor(
    private readonly bucket: TokenBucketService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('reset')
  @HttpCode(200)
  async reset(@CurrentUser() user: AccessTokenPayload): Promise<{ reset: true }> {
    if (this.config.NODE_ENV === 'production') throw new NotFoundError('Route', 'demo/ratelimit/reset');
    await this.bucket.reset(`user:${user.sub}`);
    return { reset: true };
  }
}
