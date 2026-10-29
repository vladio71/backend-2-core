// Що це: довгий звіт (job). Рядок у БД створюється ДО того, як job потрапляє в чергу.
// Чому: якщо Redis впаде між INSERT і enqueue, у нас лишиться рядок "queued" без job-у, і це видно.
// Навпаки (спочатку чергу) гірше: воркер візьме job, а рядка в БД ще немає.
// Хто викликає: ReportsService (API), ReportsProcessor (воркер).
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ReportStatus = 'queued' | 'active' | 'completed' | 'failed';

@Entity({ name: 'reports' })
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'text', default: 'queued' })
  status!: ReportStatus;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ name: 'fail_rate', type: 'real', default: 0 })
  failRate!: number;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'jsonb', nullable: true })
  result!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
