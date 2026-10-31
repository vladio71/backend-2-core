// Що це: модуль posts: CRUD, кеш статистики (GET /posts/:id/stats), RatelimitModule (guard на POST).
// Індексацію для AI отримує через токен POST_INDEXER (post-indexer.ts), який надає глобальний AiModule:
// так posts не імпортує ai і між модулями немає циклу.
// Хто викликає: AppModule.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './post.entity';
import { Activity } from './activity.entity';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { AuthModule } from '../auth/auth.module';
import { RatelimitModule } from '../ratelimit/ratelimit.module';
import { PostStatsCache } from './post-stats-cache.service';
import { StatsController } from './stats.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Post, Activity]), AuthModule, RatelimitModule],
  controllers: [PostsController, StatsController],
  providers: [PostsService, PostStatsCache],
  exports: [PostsService, TypeOrmModule],
})
export class PostsModule {}
