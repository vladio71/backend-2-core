// Що це: guard, що застосовує TokenBucketService до маршруту. Ключ: user id, або IP для анонімних.
// Чому guard, а не middleware: guard виконується після JwtAuthGuard, тому знає користувача.
// Хто викликає: @UseGuards(JwtAuthGuard, TokenBucketGuard) на POST /posts.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Response } from 'express';
import { TokenBucketService } from './token-bucket.service';
import { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { TooManyRequestsError } from '../errors/domain-errors';

@Injectable()
export class TokenBucketGuard implements CanActivate {
  constructor(private readonly bucket: TokenBucketService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const subject = request.user ? `user:${request.user.sub}` : `ip:${request.ip}`;
    const decision = await this.bucket.take(subject);
    response.setHeader('X-RateLimit-Limit', String(decision.limit));
    response.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    response.setHeader('X-RateLimit-Reset', String(decision.resetAt));
    if (!decision.allowed) {
      throw new TooManyRequestsError('RATE_LIMITED', 'Забагато запитів, спробуй пізніше', decision.retryAfterSeconds);
    }
    return true;
  }
}
