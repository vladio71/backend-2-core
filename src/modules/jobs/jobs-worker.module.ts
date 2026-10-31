// Що це: воркер-сторона черг: тільки процесори. Підключається у src/worker.ts (і в e2e-тестах, щоб воркер працював in-process).
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Report } from './report.entity';
import { EVENTS_QUEUE, REPORTS_QUEUE } from './queues';
import { ReportsProcessor } from './reports.processor';
import { EventsProcessor } from './events.processor';
import { ReportEventsPublisher } from './report-events.publisher';

@Module({
  imports: [TypeOrmModule.forFeature([Report]), BullModule.registerQueue({ name: REPORTS_QUEUE }, { name: EVENTS_QUEUE })],
  // Тільки publisher: підписка на канал звітів потрібна лише API (ReportEventsService у JobsModule).
  providers: [ReportsProcessor, EventsProcessor, ReportEventsPublisher],
  exports: [EventsProcessor],
})
export class JobsWorkerModule {}
