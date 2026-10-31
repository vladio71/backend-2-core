// Що це: HTTP для кредитів. topup тільки для admin (@Roles).
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CreditsService } from './credits.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, Roles, RolesGuard } from '../auth/roles';
import { AccessTokenPayload } from '../auth/jwt.service';

export class TopupDto {
  @IsUUID()
  userId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount!: number;
}

export class ReserveDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount!: number;
}

@ApiTags('credits')
@ApiBearerAuth()
@Controller('credits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get('me')
  me(@CurrentUser() user: AccessTokenPayload) {
    return this.credits.getBalance(user.sub);
  }

  @Post('topup')
  @Roles('admin')
  topup(@Body() dto: TopupDto) {
    return this.credits.topup(dto.userId, dto.amount);
  }

  @Post('reserve')
  reserve(@CurrentUser() user: AccessTokenPayload, @Body() dto: ReserveDto, @Query('unsafe') unsafe?: string) {
    // ?unsafe=true: демо гонки без локу, вимкнено у production (див. reserveUnsafe).
    if (unsafe === 'true') return this.credits.reserveUnsafe(user.sub, dto.amount);
    return this.credits.reserve(user.sub, dto.amount);
  }

  // Демо: баланс 100 і без активних резервацій, щоб кожна кнопка на сторінці починалась з чистого стану. Не для production.
  @Post('demo/reset')
  demoReset(@CurrentUser() user: AccessTokenPayload) {
    return this.credits.demoReset(user.sub);
  }

  @Post('reservations/:id/confirm')
  confirm(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.credits.confirm(user.sub, id);
  }

  @Post('reservations/:id/release')
  release(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.credits.release(user.sub, id);
  }
}
