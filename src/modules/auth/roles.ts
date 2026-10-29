// Що це: декоратор @Roles('admin') і RolesGuard, що його читає.
// Чому: 401 = "хто ти?", 403 = "знаю, хто ти, але не можна". Це різні коди.
// Хто викликає: контролери: @UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin').
import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../users/user.entity';
import { AuthenticatedRequest } from './jwt-auth.guard';
import { ForbiddenError, UnauthorizedError } from '../errors/domain-errors';
import { AccessTokenPayload } from './jwt.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new UnauthorizedError();
    if (!required.includes(request.user.role)) {
      throw new ForbiddenError(`Потрібна роль: ${required.join(' або ')}`);
    }
    return true;
  }
}

// @CurrentUser() у параметрах обробника: віддає payload з JWT.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) throw new UnauthorizedError();
  return request.user;
});
