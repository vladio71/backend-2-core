// Що це: модуль, що експортує RequestIdMiddleware. Сам логер не потребує DI: new AppLogger('Ctx').
// Хто викликає: AppModule.
import { Module } from '@nestjs/common';
import { RequestIdMiddleware } from './request-id.middleware';

@Module({ providers: [RequestIdMiddleware], exports: [RequestIdMiddleware] })
export class LoggingModule {}
