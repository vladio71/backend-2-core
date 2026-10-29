// Що це: одна функція, яка будує опції TypeORM і для застосунку, і для CLI міграцій (src/data-source.ts).
// Чому: щоб застосунок і CLI не розійшлися у списку сутностей чи міграцій.
import { DataSourceOptions } from 'typeorm';
import { AppConfig } from '../config/config.schema';
import { QueryCountingLogger } from './query-counter';
import { User } from '../users/user.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { Post } from '../posts/post.entity';
import { Activity } from '../posts/activity.entity';
import { Event } from '../queries/event.entity';
import { CreditBalance } from '../credits/credit-balance.entity';
import { CreditReservation } from '../credits/credit-reservation.entity';
import { GithubRepo } from '../github/github-repo.entity';
import { Report } from '../jobs/report.entity';
import { migrations } from '../../migrations';

export const entities = [User, RefreshToken, Post, Activity, Event, CreditBalance, CreditReservation, GithubRepo, Report];

export function buildDataSourceOptions(config: AppConfig): DataSourceOptions {
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
