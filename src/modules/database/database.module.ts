// Що це: підключення TypeORM до PostgreSQL. Один DataSource, один пул з'єднань.
// Чому: synchronize=false, бо схему міняють ТІЛЬКИ міграції. Пул малий навмисно (див. docs/modules/pool.md).
// Сутності модуль не знає: їх передає корінь через forRoot(entities), тому database не залежить від feature-модулів.
// Хто викликає: AppModule і WorkerModule.
import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { buildDataSourceOptions, EntityList } from './data-source-options';

@Module({})
export class DatabaseModule {
  static forRoot(entities: EntityList): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => buildDataSourceOptions(config, entities),
        }),
      ],
    };
  }
}
