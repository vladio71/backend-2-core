// Що це: сутність поста. Таблиця posts.
// Чому: deletedAt замість DELETE, бо видалене можна відновити і воно лишається у звітах.
// Колонка embedding (pgvector) тут описана як простий string, бо TypeORM не знає тип vector.
// Хто викликає: PostsService, QueriesModule (звіти, кеш), AiModule (модерація, similar).
import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, ManyToOne, JoinColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

export type PostStatus = 'draft' | 'published';
export type ModerationAction = 'approve' | 'reject';

export interface PostMeta {
  seo?: { title?: string; description?: string };
}

@Entity({ name: 'posts' })
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'text', array: true, default: '{}' })
  tags!: string[];

  @Index()
  @Column({ type: 'text', default: 'draft' })
  status!: PostStatus;

  @Column({ type: 'int', default: 0 })
  likes!: number;

  @Column({ type: 'jsonb', default: '{}' })
  meta!: PostMeta;

  @Index()
  @Column({ name: 'author_id', type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author?: User;

  @Column({ name: 'moderation_action', type: 'text', nullable: true })
  moderationAction!: ModerationAction | null;

  @Column({ name: 'moderation_reason', type: 'text', nullable: true })
  moderationReason!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // TypeORM сам додає WHERE deleted_at IS NULL до звичайних find(). Для видалених: withDeleted().
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
