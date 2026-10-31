// e2e: імпорт з GitHub через локальний mock-сервер, який на перший запит відповідає 429 + Retry-After, далі 200.
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { TestApp, TestUser, createTestApp, registerUser, bearer } from '../helpers/app';

describe('github (e2e, mock api)', () => {
  let t: TestApp;
  let user: TestUser;
  let server: http.Server;
  let hits = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits += 1;
      if (req.url?.startsWith('/users/slowdown/')) {
        res.writeHead(429, { 'Retry-After': '120', 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'rate limited' }));
        return;
      }
      if (hits === 1) {
        res.writeHead(429, { 'Retry-After': '1', 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'rate limited' }));
        return;
      }
      if (req.url?.startsWith('/users/vladio71/repos')) {
        const page = Number(new URL(req.url, 'http://x').searchParams.get('page') ?? '1');
        const body = page === 1 ? [
          { id: 1, name: 'scrapper', description: 'job watcher', stargazers_count: 3, language: 'TypeScript', owner: { login: 'vladio71' } },
          { id: 2, name: 'win-automation', description: null, stargazers_count: 1, language: 'Python', owner: { login: 'vladio71' } },
        ] : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.GITHUB_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    t = await createTestApp();
    user = await registerUser(t, 'gh@test.local');
  });
  afterAll(async () => {
    await t.close();
    server.close();
  });

  it('429 один раз -> чекає Retry-After і повторює; репозиторії в таблиці; повторний імпорт не дублює', async () => {
    const res = await t.http().post('/github/import').set(bearer(user)).send({ username: 'vladio71' }).expect(201);
    expect(res.body.imported).toBe(2);
    expect(res.body.client.retries).toBe(1);
    expect(hits).toBe(2);

    const again = await t.http().post('/github/import').set(bearer(user)).send({ username: 'vladio71' }).expect(201);
    expect(again.body.imported).toBe(2);
    const rows = await t.dataSource.query(`SELECT count(*) FROM github_repos`);
    expect(Number(rows[0].count)).toBe(2);
    const list = await t.http().get('/github/repos/vladio71').expect(200);
    expect(list.body[0].name).toBe('scrapper');
  });

  it('невідомий користувач -> 502 GITHUB_NOT_FOUND; невалідний username -> 400', async () => {
    const res = await t.http().post('/github/import').set(bearer(user)).send({ username: 'nobody-here' }).expect(502);
    expect(res.body.code).toBe('GITHUB_NOT_FOUND');
    await t.http().post('/github/import').set(bearer(user)).send({ username: 'bad name!' }).expect(400);
  });

  it('Retry-After більше 30 с: не чекаємо, віддаємо 429 з тим самим Retry-After', async () => {
    const started = Date.now();
    const res = await t.http().post('/github/import').set(bearer(user)).send({ username: 'slowdown' }).expect(429);
    expect(res.body.code).toBe('GITHUB_RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('120');
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
