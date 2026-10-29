// Інтеграційний тест: міграції проти справжнього Postgres. Накат, відкат індексу, повторний накат.
import { DataSource } from 'typeorm';
import { resetDatabase } from '../helpers/app';

describe('migrations (int)', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = await resetDatabase();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  async function indexExists(): Promise<boolean> {
    const rows = await ds.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'events_user_id_created_at_idx'`);
    return rows.length === 1;
  }

  it('усі міграції накочені, таблиці і CHECK на місці', async () => {
    const tables = await ds.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
    const names = tables.map((r: { table_name: string }) => r.table_name);
    expect(names).toEqual(expect.arrayContaining(['users', 'posts', 'activity', 'credit_balances', 'credit_reservations', 'events', 'reports', 'refresh_tokens', 'github_repos']));
    const check = await ds.query(`SELECT conname FROM pg_constraint WHERE conname = 'credit_balances_balance_non_negative'`);
    expect(check).toHaveLength(1);
    expect(await indexExists()).toBe(true);
  });

  it('timestamptz: усі колонки *_at мають тип timestamp with time zone', async () => {
    const cols = await ds.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND column_name LIKE '%\\_at'`);
    for (const c of cols) expect(c.data_type).toBe('timestamp with time zone');
    expect(cols.length).toBeGreaterThan(10);
  });

  it('revert останньої міграції прибирає індекс, повторний run повертає', async () => {
    await ds.undoLastMigration();
    expect(await indexExists()).toBe(false);
    await ds.runMigrations();
    expect(await indexExists()).toBe(true);
  });
});
