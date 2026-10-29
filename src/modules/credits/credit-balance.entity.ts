// Що це: баланс кредитів користувача. Один рядок на користувача.
// Чому: саме цей рядок блокуємо SELECT ... FOR UPDATE під час резервування.
// CHECK (balance >= 0) у міграції: остання лінія оборони, якщо код десь помилиться.
// Хто викликає: CreditsService.
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'credit_balances' })
export class CreditBalance {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'int', default: 0 })
  balance!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
