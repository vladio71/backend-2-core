// Що це: таблиця events: багато дрібних рядків (кліки, перегляди). 200 000 рядків із сіду.
// Чому: на ній показуємо індекси (EXPLAIN) і батчинг вставок у воркері.
// Хто викликає: ExplainController (читання), EventsProcessor (batch INSERT), seed.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'events' })
export class Event {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  // Індекс (user_id, created_at) додає ОКРЕМА міграція 1700000000004, щоб її можна було відкотити і порівняти плани.
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'jsonb', default: '{}' })
  payload!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
