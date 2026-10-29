// e2e: auth. Реєстрація, логін, me, ротація refresh, виявлення повторного використання, logout, ролі.
import { TestApp, createTestApp, registerUser, bearer } from '../helpers/app';

describe('auth (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('register -> me; повторний register з тим самим email -> 409', async () => {
    const user = await registerUser(t, 'vlad@test.local');
    const me = await t.http().get('/auth/me').set(bearer(user)).expect(200);
    expect(me.body.email).toBe('vlad@test.local');
    const dup = await t.http().post('/auth/register').send({ email: 'VLAD@test.local', password: 'password123', displayName: 'x' }).expect(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
  });

  it('login з неправильним паролем -> 401, без токена -> 401', async () => {
    await t.http().post('/auth/login').send({ email: 'vlad@test.local', password: 'wrong-pass' }).expect(401);
    await t.http().get('/auth/me').expect(401);
    await t.http().get('/auth/me').set('Authorization', 'Bearer garbage').expect(401);
  });

  it('refresh ротує токен; повторне використання старого відкликає всю сім\'ю', async () => {
    const user = await registerUser(t, 'rotate@test.local');
    const first = await t.http().post('/auth/refresh').send({ refreshToken: user.refreshToken }).expect(200);
    expect(first.body.refreshToken).not.toBe(user.refreshToken);

    // Старий токен спалений: 401, і новий теж відкликається (сім'я).
    await t.http().post('/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
    const reuse = await t.http().post('/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
    expect(reuse.body.message).toMatch(/відкликано/);
  });

  it('logout відкликає refresh-токен', async () => {
    const user = await registerUser(t, 'logout@test.local');
    await t.http().post('/auth/logout').send({ refreshToken: user.refreshToken }).expect(204);
    await t.http().post('/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
  });

  it('ролі: topup кредитів доступний лише admin (403 для user)', async () => {
    const user = await registerUser(t, 'plain@test.local');
    const admin = await registerUser(t, 'root@test.local', 'admin');
    const forbidden = await t.http().post('/credits/topup').set(bearer(user)).send({ userId: user.id, amount: 10 }).expect(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
    const ok = await t.http().post('/credits/topup').set(bearer(admin)).send({ userId: user.id, amount: 10 }).expect(201);
    expect(ok.body.balance).toBe(10);
  });
});
