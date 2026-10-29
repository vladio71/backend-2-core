// Що це: вимірювання: 500 одиничних INSERT проти 5 пачок по 100 (один multi-row INSERT кожна).
// Запуск: npm run bench:batch. Числа з цього скрипта у docs/modules/jobs.md.
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadConfig } from '../src/modules/config/config.module';
import { buildDataSourceOptions } from '../src/modules/database/data-source-options';

const TOTAL = 500;
const BATCH = 100;
const USER = '00000000-0000-4000-8000-00000000beac';

async function single(ds: DataSource): Promise<number> {
  const started = Date.now();
  for (let i = 0; i < TOTAL; i++) {
    await ds.query(`INSERT INTO events (user_id, type, payload) VALUES ($1, $2, $3)`, [USER, 'bench', JSON.stringify({ i })]);
  }
  return Date.now() - started;
}

async function batched(ds: DataSource): Promise<number> {
  const started = Date.now();
  for (let b = 0; b < TOTAL / BATCH; b++) {
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < BATCH; i++) {
      values.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`);
      params.push(USER, 'bench', JSON.stringify({ i: b * BATCH + i }));
    }
    await ds.query(`INSERT INTO events (user_id, type, payload) VALUES ${values.join(', ')}`, params);
  }
  return Date.now() - started;
}

async function main(): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions(loadConfig()));
  await ds.initialize();
  await ds.query(`DELETE FROM events WHERE user_id = $1`, [USER]);
  const runs = 3;
  let singleTotal = 0;
  let batchTotal = 0;
  for (let r = 0; r < runs; r++) {
    singleTotal += await single(ds);
    batchTotal += await batched(ds);
  }
  await ds.query(`DELETE FROM events WHERE user_id = $1`, [USER]);
  process.stdout.write(`500 одиничних INSERT: ${Math.round(singleTotal / runs)} мс (середнє з ${runs})\n`);
  process.stdout.write(`5 пачок по 100:       ${Math.round(batchTotal / runs)} мс (середнє з ${runs})\n`);
  process.stdout.write(`Прискорення: x${(singleTotal / batchTotal).toFixed(1)}\n`);
  await ds.destroy();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
