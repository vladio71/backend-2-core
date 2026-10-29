// Що це: модуль pool: демо пулу з'єднань.
import { Module } from '@nestjs/common';
import { PoolController } from './pool.controller';

@Module({ controllers: [PoolController] })
export class PoolModule {}
