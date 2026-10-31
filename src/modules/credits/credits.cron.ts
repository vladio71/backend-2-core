// Що це: cron @nestjs/schedule: щохвилини повертає кредити з протермінованих резервацій.
// Чому: клієнт міг зарезервувати і зникнути (закрив вкладку, впав). Без крона кредити зависли б назавжди.
// Хто викликає: ScheduleModule за розкладом. Живе лише у процесі API (у воркері модуль не підключено).
// Увага: у docker-compose два API (api-1 і api-2), тож крон біжить двічі за хвилину. Це безпечно:
// expireStale() бере лок на рядок резервації (SELECT ... FOR UPDATE) і перевіряє статус у транзакції,
// тому другий запуск чекає перший, бачить "expired" і нічого не робить (no-op). Зайвий лише один SELECT.
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
