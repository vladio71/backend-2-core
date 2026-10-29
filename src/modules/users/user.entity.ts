// Що це: сутність користувача. Таблиця users.
// Чому: пароль зберігаємо тільки як bcrypt-хеш (passwordHash), ніколи відкритим текстом.
// Хто викликає: auth (реєстрація, логін), posts (автор), credits (баланс).
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type UserRole = 'user' | 'admin';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'citext', unique: true })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text', default: 'user' })
  role!: UserRole;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  // timestamptz: зберігає момент часу (UTC), а не "настінний годинник" без зони.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
