// e2e: кредити. 20 паралельних reserve(10) на балансі 50: рівно 5 успішних, баланс ніколи не від'ємний.
import { TestApp, TestUser, createTestApp, registerUser, bearer } from '../helpers/app';
import { CreditsService } from '../../src/modules/credits/credits.service';

describe('credits (e2e)', () => {
  let t: TestApp;
  let admin: TestUser;
  let user: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await registerUser(t, 'admin@test.local', 'admin');
    user = await registerUser(t, 'buyer@test.local');
    await t.http().post('/credits/topup').set(bearer(admin)).send({ userId: user.id, amount: 50 }).expect(201);
  });
  afterAll(async () => {
    await t.close();
  });

  it('20 паралельних reserve(10) на 50 -> рівно 5 успішних (201), 15 відмов (422), баланс 0', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => t.http().post('/credits/reserve').set(bearer(user)).send({ amount: 10 })));
    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);
    expect(ok).toHaveLength(5);
    expect(rejected).toHaveLength(15);
    expect(rejected[0].body.code).toBe('INSUFFICIENT_CREDITS');
    const me = await t.http().get('/credits/me').set(bearer(user)).expect(200);
    expect(me.body.balance).toBe(0);
    expect(me.body.reserved).toBe(50);
    const rows = await t.dataSource.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [user.id]);
    expect(rows[0].balance).toBeGreaterThanOrEqual(0);
  });

  it('release повертає кредити, confirm списує остаточно, повторні дії -> 409', async () => {
    const reservations = await t.dataSource.query(`SELECT id FROM credit_reservations WHERE user_id = $1 AND status = 'reserved' ORDER BY created_at`, [user.id]);
    const [a, b] = reservations as Array<{ id: string }>;
    await t.http().post(`/credits/reservations/${a.id}/release`).set(bearer(user)).expect(201);
    await t.http().post(`/credits/reservations/${a.id}/release`).set(bearer(user)).expect(409);
    await t.http().post(`/credits/reservations/${b.id}/confirm`).set(bearer(user)).expect(201);
    await t.http().post(`/credits/reservations/${b.id}/release`).set(bearer(user)).expect(409);
    const me = await t.http().get('/credits/me').set(bearer(user)).expect(200);
    expect(me.body.balance).toBe(10);
    expect(me.body.reserved).toBe(30);
  });

  it('чужу резервацію не видно: 404', async () => {
    const stranger = await registerUser(t, 'stranger@test.local');
    const rows = await t.dataSource.query(`SELECT id FROM credit_reservations WHERE user_id = $1 AND status = 'reserved' LIMIT 1`, [user.id]);
    await t.http().post(`/credits/reservations/${rows[0].id}/confirm`).set(bearer(stranger)).expect(404);
  });

  it('expireStale (те, що викликає крон) повертає протерміновані резервації', async () => {
    await t.dataSource.query(`UPDATE credit_reservations SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND status = 'reserved'`, [user.id]);
    const expired = await t.app.get(CreditsService).expireStale();
    expect(expired).toBe(3);
    const me = await t.http().get('/credits/me').set(bearer(user)).expect(200);
    expect(me.body.balance).toBe(40);
    expect(me.body.reserved).toBe(0);
  });

  it('CHECK (balance >= 0) у БД не дає піти в мінус навіть прямим UPDATE', async () => {
    await expect(t.dataSource.query(`UPDATE credit_balances SET balance = -1 WHERE user_id = $1`, [user.id])).rejects.toThrow(/credit_balances_balance_non_negative/);
  });

  it('демо: reset повертає баланс 100 і закриває активні резервації; unsafe-шлях списує без локу', async () => {
    const reset = await t.http().post('/credits/demo/reset').set(bearer(user)).expect(201);
    expect(reset.body).toMatchObject({ balance: 100, reserved: 0 });
    await t.http().post('/credits/reserve').query({ unsafe: 'true' }).set(bearer(user)).send({ amount: 10 }).expect(201);
    const me = await t.http().get('/credits/me').set(bearer(user)).expect(200);
    expect(me.body).toMatchObject({ balance: 90, reserved: 10 });
  });
});
