// Що це: одна функція, яка будує опції TypeORM і для застосунку, і для CLI міграцій (src/data-source.ts).
// Чому: щоб застосунок і CLI не розійшлися у списку сутностей чи міграцій.
// Список сутностей сюди ПЕРЕДАЮТЬ (src/entities.ts): database нижній шар і не імпортує нічого з feature-модулів.
import { DataSourceOptions, EntitySchema } from 'typeorm';
import { AppConfig } from '../config/config.schema';
import { QueryCountingLogger } from './query-counter';
import { migrations } from '../../migrations';

// Клас сутності (User, Post, ...) або EntitySchema: те, що TypeORM приймає в опції entities.
export type EntityClass = new (...args: never[]) => object;
export type EntityList = Array<EntityClass | EntitySchema>;

export function buildDataSourceOptions(config: AppConfig, entities: EntityList): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.DATABASE_URL,
    entities,
    migrations,
    // Ніколи не synchronize у production: TypeORM може DROP-нути колонку з даними.
    synchronize: false,
    migrationsRun: false,
    logger: new QueryCountingLogger(config.DB_LOG_QUERIES),
    maxQueryExecutionTime: 1000,
    extra: {
      // Пул node-postgres. max = скільки з'єднань тримаємо; далі запити чекають у черзі.
      max: config.DB_POOL_MAX,
      connectionTimeoutMillis: config.DB_ACQUIRE_TIMEOUT_MS,
      idleTimeoutMillis: 30000,
      // Усі сесії в UTC. Колонки timestamptz, тому значення зберігаються правильно
      // незалежно від часового поясу сервера, а з UTC-сесією ще й читаються однаково всюди.
      options: '-c TimeZone=UTC',
      application_name: config.INSTANCE_NAME,
    },
  };
}
