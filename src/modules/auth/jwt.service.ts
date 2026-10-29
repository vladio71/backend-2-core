// Що це: підпис і перевірка access-токенів (JWT). Тільки це, без БД.
// Чому: access-токен короткий (15 хв) і перевіряється без запиту до бази: підпису достатньо.
// Хто викликає: AuthService (видає), JwtAuthGuard (перевіряє), LiveGateway (handshake).
import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { UserRole } from '../users/user.entity';
import { UnauthorizedError } from '../errors/domain-errors';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  email: string;
}

@Injectable()
export class JwtService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  sign(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.config.JWT_SECRET, { expiresIn: this.config.JWT_ACCESS_TTL_SECONDS, algorithm: 'HS256' });
  }

  verify(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, this.config.JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof decoded !== 'object' || decoded === null || typeof decoded.sub !== 'string') {
        throw new UnauthorizedError('Невалідний токен');
      }
      return { sub: decoded.sub, role: decoded.role as UserRole, email: String(decoded.email) };
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Токен невалідний або протермінований');
    }
  }
}
