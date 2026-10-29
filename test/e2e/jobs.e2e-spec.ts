// e2e: черги. Воркер працює in-process (JobsWorkerModule). Звіт, polling, SSE, retry, backpressure, батчинг подій.
import http from 'node:http';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { TestApp, TestUser, createTestApp, registerUser, bearer, waitFor, sleep } from '../helpers/app';
import { EVENTS_QUEUE, REPORTS_QUEUE } from '../../src/modules/jobs/queues';
import { EventsProcessor } from '../../src/modules/jobs/events.processor';

describe('jobs (e2e, воркер in-process)', () => {
  let t: TestApp;
  let user: TestUser;

  beforeAll(async () => {
    t = await createTestApp({ withWorker: true });
    user = await registerUser(t, 'jobs@test.local');
  });
  afterAll(async () => {
    await t.close();
  });

  it('POST /reports -> 202, рядок у БД, воркер доводить до completed з прогресом', async () => {
    const accepted = await t.http().post('/reports').set(bearer(user)).send({}).expect(202);
    expect(accepted.body).toMatchObject({ status: 'queued', statusUrl: `/reports/${accepted.body.id}` });
    const row = await t.dataSource.query(`SELECT status FROM reports WHERE id = $1`, [accepted.body.id]);
    expect(row).toHaveLength(1);

    const done = await waitFor(async () => {
      const res = await t.http().get(`/reports/${accepted.body.id}`).set(bearer(user)).expect(200);
      return res.body.status === 'completed' ? res.body : null;
    });
    expect(done.progress).toBe(100);
    expect(done.result.rows).toBe(1234);
  });

  it('SSE: стрім подій до completed, потім з\'єднання закривається', async () => {
    const accepted = await t.http().post('/reports').set(bearer(user)).send({}).expect(202);
    const events = await new Promise<string[]>((resolve, reject) => {
      const chunks: string[] = [];
      const req = http.get(`${t.baseUrl}/reports/${accepted.body.id}/events`, { headers: bearer(user) }, (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream');
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => chunks.push(chunk));
        res.on('end', () => resolve(chunks.join('').split('\n\n').filter((l) => l.startsWith('data: '))));
      });
      req.on('error', reject);
    });
    const parsed = events.map((e) => JSON.parse(e.slice(6)));
    expect(parsed[parsed.length - 1].status).toBe('completed');
    expect(parsed.some((e) => e.status === 'active' && e.progress === 40)).toBe(true);
  });

  it('failRate=1: 3 спроби, потім failed з текстом помилки', async () => {
    const accepted = await t.http().post('/reports').set(bearer(user)).send({ failRate: 1 }).expect(202);
    const failed = await waitFor(async () => {
      const res = await t.http().get(`/reports/${accepted.body.id}`).set(bearer(user)).expect(200);
      return res.body.status === 'failed' ? res.body : null;
    }, 30000);
    expect(failed.attempts).toBe(3);
    expect(failed.error).toMatch(/Імітація збою/);
  });

  it('backpressure: при QUEUE_MAX_WAITING=3 четвертий POST /reports -> 429 QUEUE_FULL', async () => {
    const queue = t.app.get<Queue>(getQueueToken(REPORTS_QUEUE));
    await queue.pause(); // воркер не бере job-и, черга росте
    try {
      for (let i = 0; i < 3; i++) await t.http().post('/reports').set(bearer(user)).send({}).expect(202);
      const full = await t.http().post('/reports').set(bearer(user)).send({}).expect(429);
      expect(full.body.code).toBe('QUEUE_FULL');
      expect(full.headers['retry-after']).toBe('5');
    } finally {
      await queue.resume();
    }
  });

  it('POST /events -> 202, рядок потрапляє в events через воркер', async () => {
    await t.http().post('/events').set(bearer(user)).send({ type: 'view', payload: { page: '/' } }).expect(202);
    await t.http().post('/events').set(bearer(user)).send({ type: 'view', extra: 1 }).expect(400);
    await waitFor(async () => {
      const rows = await t.dataSource.query(`SELECT type FROM events WHERE user_id = $1`, [user.id]);
      return rows.length === 1 ? true : null;
    });
  });

  it('батчинг: 250 job-ів у черзі -> 250 рядків за кілька INSERT-ів (пачки до 100), а не 250', async () => {
    const processor = t.app.get(EventsProcessor);
    const queue = t.app.get<Queue>(getQueueToken(EVENTS_QUEUE));
    const before = processor.flushes;
    // Кладемо job-и одразу всі (addBulk), як це робить навантаження, а не по одному через HTTP.
    await queue.addBulk(Array.from({ length: 250 }, (_, i) => ({ name: 'track', data: { userId: user.id, type: 'click', payload: { i }, requestId: 'bulk' } })));
    await waitFor(async () => {
      const rows = await t.dataSource.query(`SELECT count(*) FROM events WHERE type = 'click'`);
      return Number(rows[0].count) === 250 ? true : null;
    });
    await sleep(100);
    const flushes = processor.flushes - before;
    expect(flushes).toBeGreaterThanOrEqual(3);
    expect(flushes).toBeLessThanOrEqual(8);
    expect(await queue.getFailedCount()).toBe(0);
  });
});
