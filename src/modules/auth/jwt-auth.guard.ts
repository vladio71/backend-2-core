// Що це: guard, який читає Authorization: Bearer <jwt>, перевіряє підпис і кладе користувача в request.user.
// Чому: контролери не парсять заголовки самі. @UseGuards(JwtAuthGuard) і далі @CurrentUser().
// Хто викликає: Nest перед обробником маршруту.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { JwtService, AccessTokenPayload } from './jwt.service';
import { UnauthorizedError } from '../errors/domain-errors';

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError('Потрібен заголовок Authorization: Bearer <token>');
    }
    request.user = this.jwt.verify(token);
    return true;
  }
}
