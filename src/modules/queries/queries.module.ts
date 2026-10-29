// Що це: модуль SQL-рівня: сирий звіт, N+1, EXPLAIN, кеш статистики.
// Чому один модуль: усе це про те, "що саме піде в Postgres", а не про бізнес-правила.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/post.entity';
import { User } from '../users/user.entity';
import { Event } from './event.entity';
import { PostStatsCache } from './post-stats-cache.service';
import { StatsController } from './stats.controller';
import { PostsPerDayController } from './posts-per-day.controller';
import { NPlusOneController } from './n-plus-one.controller';
import { ExplainController } from './explain.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Post, User, Event])],
  controllers: [PostsPerDayController, StatsController, NPlusOneController, ExplainController],
  providers: [PostStatsCache],
  exports: [PostStatsCache],
})
export class QueriesModule {}
