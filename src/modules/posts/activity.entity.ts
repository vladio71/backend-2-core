// Що це: журнал дій над постами (publish, restore). Таблиця activity.
// Чому: показати транзакцію: зміна статусу поста і запис сюди або відбуваються разом, або не відбуваються взагалі.
// Хто викликає: PostsService.publish().
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'activity' })
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'post_id', type: 'uuid' })
  postId!: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId!: string;

  @Column({ type: 'text' })
  action!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
