// Що це: воркер-сторона черг: тільки процесори. Підключається у src/worker.ts (і в e2e-тестах, щоб воркер працював in-process).
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Report } from './report.entity';
import { EVENTS_QUEUE, REPORTS_QUEUE } from './queues';
import { ReportsProcessor } from './reports.processor';
import { EventsProcessor } from './events.processor';
import { ReportEventsService } from './report-events.service';

@Module({
  imports: [TypeOrmModule.forFeature([Report]), BullModule.registerQueue({ name: REPORTS_QUEUE }, { name: EVENTS_QUEUE })],
  providers: [ReportsProcessor, EventsProcessor, ReportEventsService],
  exports: [EventsProcessor],
})
export class JobsWorkerModule {}
