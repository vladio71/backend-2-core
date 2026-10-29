// Що це: модуль auth. Експортує JwtService і guard-и, щоб інші модулі захищали свої маршрути.
// Хто викликає: AppModule; PostsModule, CreditsModule, JobsModule, GithubModule, AiModule, LiveModule імпортують.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { RefreshToken } from './refresh-token.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtService } from './jwt.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles';

@Module({
  imports: [UsersModule, TypeOrmModule.forFeature([RefreshToken])],
  controllers: [AuthController],
  providers: [AuthService, JwtService, JwtAuthGuard, RolesGuard],
  exports: [JwtService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
