// Що це: модуль live: WebSocket gateway, presence, дошка, демо-сторінка. Імпортує JobsModule заради ReportEventsService.
// Хто викликає: AppModule.
import { Module } from '@nestjs/common';
import { LiveGateway } from './live.gateway';
import { PresenceService } from './presence.service';
import { BoardService } from './board.service';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { DemoPageController } from './demo-page.controller';

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [DemoPageController],
  providers: [LiveGateway, PresenceService, BoardService],
})
export class LiveModule {}
