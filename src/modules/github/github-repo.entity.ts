// Що це: репозиторій, імпортований з GitHub API. Таблиця github_repos.
// Чому: унікальний ключ (owner, name): повторний імпорт оновлює, а не дублює (UPSERT).
// Хто викликає: GithubService.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'github_repos' })
@Index(['owner', 'name'], { unique: true })
export class GithubRepo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'github_id', type: 'bigint' })
  githubId!: string;

  @Column({ type: 'text' })
  owner!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'int', default: 0 })
  stars!: number;

  @Column({ type: 'text', nullable: true })
  language!: string | null;

  @Column({ name: 'imported_by', type: 'uuid' })
  importedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
