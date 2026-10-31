// Що це: POST /events: одна подія -> один job у чергу events. Воркер збирає їх пачками.
// Хто викликає: клієнт (часто і багато).
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { EVENTS_QUEUE, EventJobData } from './queues';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/roles';
import { AccessTokenPayload } from '../auth/jwt.service';
import { getRequestId } from '../logging/request-context';

export class CreateEventDto {
  @IsString()
  @MaxLength(50)
  type!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(@InjectQueue(EVENTS_QUEUE) private readonly queue: Queue<EventJobData>) {}

  @Post()
  @HttpCode(202)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateEventDto): Promise<{ queued: true }> {
    await this.queue.add(
      'track',
      { userId: user.sub, type: dto.type, payload: dto.payload ?? {}, requestId: getRequestId() ?? '' },
      // Без attempts (тобто 1 спроба), на відміну від звітів (attempts: 3, див. reports.service.ts). Чому: подія це
      // телеметрія, втратити одну дешевше, ніж ускладнити. До того ж повтор небезпечний: воркер пише події пачкою
      // (BatchCollector), а job-и без ключа ідемпотентності, тож повтор пачки, що могла частково пройти, дав би дублі.
      // Звіт навпаки ідемпотентний (jobId = id звіту, статус перезаписується) і користувач чекає на результат.
      { removeOnComplete: true, removeOnFail: 1000 },
    );
    return { queued: true };
  }
}
