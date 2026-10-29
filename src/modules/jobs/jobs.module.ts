// Що це: API-сторона черг: реєстрація черг, контролери, SSE, Bull Board. Процесорів тут НЕМАЄ.
// Чому: процесори живуть у JobsWorkerModule, який підключає тільки src/worker.ts. Так API ніколи
// не виконує job-и сам, навіть випадково.
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Report } from './report.entity';
import { EVENTS_QUEUE, REPORTS_QUEUE } from './queues';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { EventsController } from './events.controller';
import { ReportEventsService } from './report-events.service';
import { AuthModule } from '../auth/auth.module';
import { JwtService } from '../auth/jwt.service';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { createBullBoardAuth } from './bull-board.middleware';

@Module({
  imports: [
    TypeOrmModule.forFeature([Report]),
    AuthModule,
    BullModule.registerQueue({ name: REPORTS_QUEUE }, { name: EVENTS_QUEUE }),
    BullBoardModule.forRootAsync({
      imports: [AuthModule],
      inject: [JwtService, APP_CONFIG],
      useFactory: (jwt: JwtService, config: AppConfig) => ({
        route: '/queues',
        adapter: ExpressAdapter,
        middleware: createBullBoardAuth(jwt, config.NODE_ENV === 'development' || config.BULL_BOARD_OPEN),
      }),
    }),
    BullBoardModule.forFeature({ name: REPORTS_QUEUE, adapter: BullMQAdapter }, { name: EVENTS_QUEUE, adapter: BullMQAdapter }),
  ],
  controllers: [ReportsController, EventsController],
  providers: [ReportsService, ReportEventsService],
  exports: [ReportEventsService, BullModule],
})
export class JobsModule {}
