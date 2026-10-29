// Що це: модуль github: клієнт з лімітами, імпорт у таблицю github_repos.
// Хто викликає: AppModule.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubRepo } from './github-repo.entity';
import { GithubClient } from './github.client';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([GithubRepo]), AuthModule],
  controllers: [GithubController],
  providers: [GithubClient, GithubService],
})
export class GithubModule {}
