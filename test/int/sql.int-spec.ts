// Інтеграційний тест: SQL-рівень проти справжнього Postgres: сід, EXPLAIN, звіт posts-per-day, UTC-сесія.
import { DataSource } from 'typeorm';
import { resetDatabase } from '../helpers/app';
import { runSeed } from '../../scripts/seed';

describe('sql (int)', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = await resetDatabase();
    await runSeed(ds, { events: 20_000, log: () => undefined });
  });
  afterAll(async () => {
    await ds.destroy();
  });

  it('сесія в UTC', async () => {
    const rows = await ds.query(`SHOW TimeZone`);
    expect(rows[0].TimeZone).toBe('UTC');
  });

  it('посторінковий звіт posts-per-day: running_total накопичується по автору', async () => {
    const rows: Array<{ author_name: string; running_total: string; posts: string }> = await ds.query(`
      SELECT u.display_name AS author_name, count(*) AS posts,
             sum(count(*)) OVER (PARTITION BY u.id ORDER BY date_trunc('day', p.created_at)) AS running_total
      FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.deleted_at IS NULL
      GROUP BY date_trunc('day', p.created_at), u.id, u.display_name
      ORDER BY u.display_name, date_trunc('day', p.created_at)`);
    let prevAuthor = '';
    let running = 0;
    for (const r of rows) {
      if (r.author_name !== prevAuthor) {
        running = 0;
        prevAuthor = r.author_name;
      }
      running += Number(r.posts);
      expect(Number(r.running_total)).toBe(running);
    }
  });

  it('EXPLAIN: з індексом планувальник бере events_user_id_created_at_idx, без нього Seq Scan', async () => {
    const sample = await ds.query(`SELECT user_id FROM events LIMIT 1`);
    const sql = `EXPLAIN (FORMAT JSON) SELECT count(*) FROM events WHERE user_id = $1 AND created_at >= now() - interval '30 days'`;
    const withIndex = JSON.stringify(await ds.query(sql, [sample[0].user_id]));
    expect(withIndex).toContain('events_user_id_created_at_idx');

    await ds.query(`DROP INDEX events_user_id_created_at_idx`);
    const without = JSON.stringify(await ds.query(sql, [sample[0].user_id]));
    expect(without).toContain('Seq Scan');
    await ds.query(`CREATE INDEX events_user_id_created_at_idx ON events(user_id, created_at)`);
  });

  it('citext: email порівнюється без урахування регістру', async () => {
    const rows = await ds.query(`SELECT 1 FROM users WHERE email = 'ADMIN@DEVHUB.LOCAL'`);
    expect(rows).toHaveLength(1);
  });
});
