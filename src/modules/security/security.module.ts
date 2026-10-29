// Що це: модуль безпеки. helmet і CORS підключені у main.ts; тут лише демо-контролер, який існує тільки в development.
// Чому так: DynamicModule з умовою: у production контролера немає взагалі, а не "є, але вимкнений".
import { DynamicModule, Module } from '@nestjs/common';
import { SqlInjectionController } from './sql-injection.controller';

@Module({})
export class SecurityModule {
  static forEnv(nodeEnv: string): DynamicModule {
    return {
      module: SecurityModule,
      controllers: nodeEnv === 'development' ? [SqlInjectionController] : [],
    };
  }
}
