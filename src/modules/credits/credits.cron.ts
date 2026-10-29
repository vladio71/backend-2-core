// Що це: cron @nestjs/schedule: щохвилини повертає кредити з протермінованих резервацій.
// Чому: клієнт міг зарезервувати і зникнути (закрив вкладку, впав). Без крона кредити зависли б назавжди.
// Хто викликає: ScheduleModule за розкладом. Живе лише у процесі API (у воркері модуль не підключено).
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreditsService } from './credits.service';
import { AppLogger } from '../logging/app-logger';

@Injectable()
export class CreditsCron {
  private readonly logger = new AppLogger('CreditsCron');

  constructor(private readonly credits: CreditsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async releaseExpired(): Promise<void> {
    try {
      await this.credits.expireStale();
    } catch (err) {
      this.logger.error('Крон протермінування резервацій упав', err);
    }
  }
}
