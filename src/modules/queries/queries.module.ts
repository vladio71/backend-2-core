// Що це: модуль SQL-рівня: сирий звіт, N+1, EXPLAIN. Кеш статистики поста живе у posts (див. docs/modules/queries.md).
// Чому один модуль: усе це про те, "що саме піде в Postgres", а не про бізнес-правила.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/post.entity';
import { User } from '../users/user.entity';
import { Event } from './event.entity';
import { PostsPerDayController } from './posts-per-day.controller';
import { NPlusOneController } from './n-plus-one.controller';
import { ExplainController } from './explain.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Post, User, Event])],
  controllers: [PostsPerDayController, NPlusOneController, ExplainController],
})
export class QueriesModule {}
