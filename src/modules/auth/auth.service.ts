// Що це: реєстрація, логін, refresh з ротацією, logout.
// Чому: refresh-токен непрозорий (випадкові байти), у БД лише його sha256. Кожен refresh видає новий токен
// і "спалює" старий (usedAt). Якщо хтось приносить уже спалений токен, значить він був вкрадений:
// відкликаємо всю сім'ю (familyId) і обом сторонам доведеться логінитись знову.
// Хто викликає: AuthController.
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { RefreshToken } from './refresh-token.entity';
import { JwtService } from './jwt.service';
import { ConflictError, UnauthorizedError } from '../errors/domain-errors';
import { AppLogger } from '../logging/app-logger';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new AppLogger('AuthService');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    @InjectRepository(RefreshToken) private readonly refreshRepo: Repository<RefreshToken>,
  ) {}

  async register(email: string, password: string, displayName: string): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictError('EMAIL_TAKEN', 'Користувач з таким email уже існує');
    }
    // bcrypt cost 10: близько 50-100 мс на хеш. Достатньо, щоб перебір був дорогим, і не надто повільно для логіну.
    const passwordHash = await bcrypt.hash(password, this.config.BCRYPT_COST);
    const user = await this.users.create({ email, passwordHash, displayName });
    const tokens = await this.issueTokens(user, randomUUID());
    return { user: toPublicUser(user), tokens };
  }

  async login(email: string, password: string): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const user = await this.users.findByEmail(email);
    // Одна і та сама помилка для "немає користувача" і "не той пароль": не підказуємо, які email існують.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedError('Невірний email або пароль');
    }
    const tokens = await this.issueTokens(user, randomUUID());
    return { user: toPublicUser(user), tokens };
  }

  async refresh(rawToken: string): Promise<TokenPair> {
    const stored = await this.refreshRepo.findOne({ where: { tokenHash: sha256(rawToken) } });
    if (!stored) {
      throw new UnauthorizedError('Refresh-токен невідомий');
    }
    if (stored.revokedAt) {
      throw new UnauthorizedError('Refresh-токен відкликано');
    }
    if (stored.usedAt) {
      // Повторне використання спаленого токена: хтось має копію. Відкликаємо всю сім'ю.
      this.logger.warn(`Повторне використання refresh-токена, сім'я ${stored.familyId} відкликана`);
      await this.refreshRepo.update({ familyId: stored.familyId }, { revokedAt: new Date() });
      throw new UnauthorizedError('Refresh-токен уже використано. Увійди знову');
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('Refresh-токен протермінований');
    }
    const user = await this.users.findById(stored.userId);
    if (!user) {
      throw new UnauthorizedError('Користувача не існує');
    }
    // Ротація: старий позначаємо використаним, видаємо новий у тій самій сім'ї.
    await this.refreshRepo.update({ id: stored.id }, { usedAt: new Date() });
    return this.issueTokens(user, stored.familyId);
  }

  async logout(rawToken: string): Promise<void> {
    const stored = await this.refreshRepo.findOne({ where: { tokenHash: sha256(rawToken) } });
    if (stored) {
      await this.refreshRepo.update({ familyId: stored.familyId }, { revokedAt: new Date() });
    }
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedError('Користувача не існує');
    return toPublicUser(user);
  }

  private async issueTokens(user: User, familyId: string): Promise<TokenPair> {
    const accessToken = this.jwt.sign({ sub: user.id, role: user.role, email: user.email });
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    await this.refreshRepo.insert({ userId: user.id, familyId, tokenHash: sha256(refreshToken), expiresAt });
    return { accessToken, refreshToken, expiresIn: this.config.JWT_ACCESS_TTL_SECONDS };
  }
}
