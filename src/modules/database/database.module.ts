// Що це: підключення TypeORM до PostgreSQL. Один DataSource, один пул з'єднань.
// Чому: synchronize=false, бо схему міняють ТІЛЬКИ міграції. Пул малий навмисно (див. docs/modules/pool.md).
// Хто викликає: AppModule і WorkerModule.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { buildDataSourceOptions } from './data-source-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildDataSourceOptions(config),
    }),
  ],
})
export class DatabaseModule {}
