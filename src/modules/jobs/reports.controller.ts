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

  // Демо: прибрати мої job-и, що чекають у черзі (після flood). Не для production.
  @Post('demo/drain')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  drain(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.drainMine(user.sub);
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
    // Порядок важливий: СПОЧАТКУ підписка, ПОТІМ читання звіту з БД. Якщо читати першим, подія, що прилетіла між
    // SELECT і subscribe(), губиться назавжди (особливо "completed": стрім тоді висить до розриву з'єднання).
    // Поки знімок з БД ще не відправлений, події складаємо в буфер, щоб не писати їх раніше за знімок.
    const buffered: ReportEvent[] = [];
    let live = false;
    let finished = false;
    let unsubscribe: () => void = () => undefined;
    let keepAlive: NodeJS.Timeout | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (keepAlive) clearInterval(keepAlive);
      unsubscribe();
      res.end();
    };
    const send = (event: ReportEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.status === 'completed' || event.status === 'failed') finish();
    };
    unsubscribe = this.events.subscribe((event) => {
      if (event.reportId !== id || finished) return;
      if (live) send(event);
      else buffered.push(event);
    });
    req.on('close', () => {
      finished = true;
      if (keepAlive) clearInterval(keepAlive);
      unsubscribe();
    });

    let report;
    try {
      report = await this.reports.get(user.sub, id); // 404 для чужого звіту: підписку прибираємо, лишати її не можна
    } catch (err) {
      unsubscribe();
      throw err;
    }
    if (finished) return; // клієнт пішов, поки читали БД

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Поточний стан одразу, щоб клієнт не чекав наступної події. Завершений звіт: відправили і закрили.
    send({ reportId: report.id, userId: report.userId, status: report.status, progress: report.progress, attempt: report.attempts, result: report.result ?? undefined, error: report.error ?? undefined, at: new Date().toISOString() });
    if (finished) return;
    live = true;
    for (const event of buffered) {
      send(event);
      if (finished) return;
    }
    keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  }
}
