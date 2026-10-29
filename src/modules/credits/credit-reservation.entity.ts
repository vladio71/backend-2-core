// Що це: резервація кредитів. Списали з балансу, але ще можемо повернути (release) або підтвердити (confirm).
// Чому: двофазна схема потрібна, коли між "хочу" і "зробив" є довга операція (напр. запит до LLM).
// Хто викликає: CreditsService, CreditsCron (протермінування через 10 хв).
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ReservationStatus = 'reserved' | 'confirmed' | 'released' | 'expired';

@Entity({ name: 'credit_reservations' })
export class CreditReservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'int' })
  amount!: number;

  @Index()
  @Column({ type: 'text', default: 'reserved' })
  status!: ReservationStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
