// Що це: POST /reports (202), GET /reports/:id (polling), GET /reports/:id/events (SSE).
// Чому три способи дізнатися статус: polling (простий, зайві запити), SSE (сервер пушить, один напрямок),
// WebSocket у модулі live (два напрямки). Усі три на одному job-і, щоб порівняти на /demo/live.
// Хто викликає: клієнт.
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Request, Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportEventsService } from './report-events.service';
import { JwtAuthGuard, extractBearer } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/roles';
import { AccessTokenPayload, JwtService } from '../auth/jwt.service';
import { ReportEvent } from './queues';

export class CreateReportDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  failRate?: number;
}

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly events: ReportEventsService,
    private readonly jwt: JwtService,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateReportDto) {
    return this.reports.create(user.sub, dto.failRate ?? 0);
  }

  @Get('queue-stats')
  queueStats() {
    return this.reports.queueStats();
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(user.sub, id);
  }

  // SSE: звичайний HTTP-запит, який не закривається. Сервер пише "data: {...}\n\n" на кожну подію.
  // Токен приймаємо і в заголовку, і в ?token=, бо браузерний EventSource не вміє ставити заголовки.
  @Get(':id/events')
  async stream(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const token = extractBearer(req.headers.authorization) ?? (typeof req.query.token === 'string' ? req.query.token : null);
    const user = this.jwt.verify(token ?? '');
    const report = await this.reports.get(user.sub, id);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: ReportEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Поточний стан одразу, щоб клієнт не чекав наступної події.
    send({ reportId: report.id, userId: report.userId, status: report.status, progress: report.progress, attempt: report.attempts, result: report.result ?? undefined, error: report.error ?? undefined, at: new Date().toISOString() });
    if (report.status === 'completed' || report.status === 'failed') {
      res.end();
      return;
    }
    const unsubscribe = this.events.subscribe((event) => {
      if (event.reportId !== id) return;
      send(event);
      if (event.status === 'completed' || event.status === 'failed') {
        unsubscribe();
        res.end();
      }
    });
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  }
}
