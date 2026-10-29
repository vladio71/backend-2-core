// Що це: лічильник SQL-запитів для поточного контексту (запиту). Плюс TypeORM-логер, що його інкрементує.
// Чому: демо N+1 має показати ЧИСЛО запитів, а не слова "багато" чи "мало".
// Хто викликає: database.module.ts підключає QueryCountingLogger; n-plus-one.controller.ts викликає countQueries().
import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';
import { AppLogger } from '../logging/app-logger';

interface Counter {
  count: number;
  queries: string[];
}

const counterStorage = new AsyncLocalStorage<Counter>();

export interface CountedResult<T> {
  result: T;
  queryCount: number;
  queries: string[];
}

export async function countQueries<T>(fn: () => Promise<T>): Promise<CountedResult<T>> {
  const counter: Counter = { count: 0, queries: [] };
  const result = await counterStorage.run(counter, fn);
  return { result, queryCount: counter.count, queries: counter.queries };
}

export class QueryCountingLogger implements TypeOrmLogger {
  private readonly logger = new AppLogger('SQL');

  constructor(private readonly logAllQueries: boolean) {}

  logQuery(query: string, parameters?: unknown[], _queryRunner?: QueryRunner): void {
    const counter = counterStorage.getStore();
    if (counter) {
      counter.count += 1;
      counter.queries.push(query);
    }
    if (this.logAllQueries) {
      this.logger.debug({ query, parameters });
    }
  }
  logQueryError(error: string | Error, query: string): void {
    this.logger.error(`SQL error: ${query}`, error instanceof Error ? error : new Error(error));
  }
  logQuerySlow(time: number, query: string): void {
    this.logger.warn(`Повільний запит ${time}ms: ${query}`);
  }
  logSchemaBuild(message: string): void {
    this.logger.info(message);
  }
  logMigration(message: string): void {
    this.logger.info(message);
  }
  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') this.logger.warn(message);
    else this.logger.info(message);
  }
}
