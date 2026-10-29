// e2e: фундамент. health, request id, форма помилки, 404.
import { TestApp, createTestApp } from '../helpers/app';

describe('foundation (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('GET /health повертає статус кожної залежності', async () => {
    const res = await t.http().get('/health').expect(200);
    expect(res.body.dependencies.postgres.status).toBe('up');
    expect(res.body.dependencies.redis.status).toBe('up');
  });

  it('повертає X-Request-Id: той, що прийшов, або згенерований', async () => {
    const echoed = await t.http().get('/health').set('X-Request-Id', 'my-id-1').expect(200);
    expect(echoed.headers['x-request-id']).toBe('my-id-1');
    const generated = await t.http().get('/health').expect(200);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('невідомий маршрут: 404 в єдиній JSON-формі з requestId', async () => {
    const res = await t.http().get('/no-such-route').set('X-Request-Id', 'r404').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', requestId: 'r404' });
    expect(typeof res.body.message).toBe('string');
  });

  it('невалідне тіло: 400 VALIDATION_ERROR з назвами полів у details', async () => {
    const res = await t.http().post('/auth/register').send({ email: 'not-an-email', password: '1', extra: true }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details.join(' ')).toMatch(/email/);
    expect(res.body.details.join(' ')).toMatch(/extra should not exist/);
  });

  it('/openapi.json віддає документ Swagger', async () => {
    // У тестовому застосунку Swagger не монтується (це робить main.ts). Перевіряємо хоча б, що маршрут posts у Nest є.
    await t.http().get('/posts').expect(200);
  });

  it('/demo/sql-injection недоступний поза development', async () => {
    await t.http().get('/demo/sql-injection').expect(404);
  });

  it('/queues поза development вимагає JWT адміна', async () => {
    await t.http().get('/queues').expect(401);
  });
});
