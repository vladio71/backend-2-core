// Що це: модуль pool: демо пулу з'єднань. AuthModule потрібен для JwtAuthGuard на /demo/pool/slow.
import { Module } from '@nestjs/common';
import { PoolController } from './pool.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [PoolController] })
export class PoolModule {}
