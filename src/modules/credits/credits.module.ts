// Що це: модуль credits: баланс, резервації, крон протермінування.
// Хто викликає: AppModule.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditBalance } from './credit-balance.entity';
import { CreditReservation } from './credit-reservation.entity';
import { CreditsService } from './credits.service';
import { CreditsController } from './credits.controller';
import { CreditsCron } from './credits.cron';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([CreditBalance, CreditReservation]), AuthModule],
  controllers: [CreditsController],
  providers: [CreditsService, CreditsCron],
  exports: [CreditsService],
})
export class CreditsModule {}
