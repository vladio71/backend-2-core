// Що це: модуль posts. Імпортує QueriesModule (кеш статистики), RatelimitModule (guard на POST), AiModule (ембединги).
// Хто викликає: AppModule.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './post.entity';
import { Activity } from './activity.entity';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { AuthModule } from '../auth/auth.module';
import { RatelimitModule } from '../ratelimit/ratelimit.module';
import { QueriesModule } from '../queries/queries.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([Post, Activity]), AuthModule, RatelimitModule, QueriesModule, AiModule],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService, TypeOrmModule],
})
export class PostsModule {}
