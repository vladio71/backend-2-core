// Завдання для читача (див. docs/testing.md). Скелет e2e-тесту: заповни його сам.
import { TestApp, createTestApp } from '../helpers/app';

describe('your turn (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('застосунок піднімається', async () => {
    await t.http().get('/health').expect(200);
  });

  // Завдання: зареєструй двох користувачів, перший створює пост, другий робить PATCH і має отримати 403.
  // Потім адмін (UPDATE users SET role='admin' + повторний логін) робить той самий PATCH і отримує 200.
  test.todo('чужий пост не редагується (403), адмін може (200)');

  // Завдання: створи пост, зроби DELETE, перевір, що GET /posts?authorId=... його не повертає,
  // а SELECT з withDeleted (або сирий SQL) його бачить з deleted_at.
  test.todo('soft delete ховає пост зі списку, але рядок лишається');
});
