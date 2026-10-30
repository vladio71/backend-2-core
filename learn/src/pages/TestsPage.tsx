// Тести і CI: статична сторінка за docs/testing.md і .github/workflows/ci.yml. Три рівні тестів з прикладом на кожен,
// кроки CI і завдання "напиши сам" з test/e2e/your-turn.e2e-spec.ts.
import { Card, Explain, PageTitle } from '../components/common';

const LEVELS: Array<[string, string, string, string, string]> = [
  ['Unit (src/**/*.spec.ts)', 'логіку одного класу', 'репозиторії, Redis, LLM фейками', 'мс', 'npm test'],
  ['Integration (test/int/*.int-spec.ts)', 'SQL, міграції, репозиторії', 'нічого: справжній Postgres', 'секунди', 'npm run test:int'],
  ['e2e (test/e2e/*.e2e-spec.ts)', 'весь застосунок через HTTP/WS', 'тільки зовнішні API (GitHub mock, Fake LLM)', 'десятки секунд', 'npm run test:e2e'],
];

const UNIT_SNIPPET = `// src/modules/posts/posts.service.spec.ts: репозиторій і кеш замінені фейками, перевіряємо правила, а не SQL
const repo = { findOne: jest.fn().mockResolvedValue(post), save: jest.fn(async (p) => p), softDelete: jest.fn() };
const svc = new PostsService(repo, {} as DataSource, { invalidate: jest.fn() }, { indexPost: jest.fn() });

it('чужий користувач не може редагувати пост, адмін може', async () => {
  await expect(svc.update(stranger, 'p1', { title: 'hack' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const updated = await svc.update(admin, 'p1', { title: 'fixed' });
  expect(updated.title).toBe('fixed');
});`;

const INT_SNIPPET = `// test/int/migrations.int-spec.ts: resetDatabase() робить DROP SCHEMA і накочує міграції, далі сирий SQL проти справжньої бази
it('revert останньої міграції прибирає індекс, повторний run повертає', async () => {
  await ds.undoLastMigration();
  expect(await indexExists()).toBe(false);
  await ds.runMigrations();
  expect(await indexExists()).toBe(true);
});

it('timestamptz: усі колонки *_at мають тип timestamp with time zone', async () => {
  const cols = await ds.query(\`SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name LIKE '%\\\\_at'\`);
  for (const c of cols) expect(c.data_type).toBe('timestamp with time zone');
});`;

const E2E_SNIPPET = `// test/e2e/posts.e2e-spec.ts: createTestApp() піднімає AppModule на випадковому порту, запити через supertest
it('після DELETE пост зникає зі списку і GET, але повертається після restore', async () => {
  const id = await createPost(author, { title: 'Видалити мене', body: 'x' });
  await t.http().delete(\`/posts/\${id}\`).set(bearer(other)).expect(403);
  await t.http().delete(\`/posts/\${id}\`).set(bearer(author)).expect(204);
  await t.http().get(\`/posts/\${id}\`).expect(404);
  const rows = await t.dataSource.query(\`SELECT deleted_at FROM posts WHERE id = $1\`, [id]);
  expect(rows[0].deleted_at).not.toBeNull();
  await t.http().post(\`/posts/\${id}/restore\`).set(bearer(author)).expect(201);
  await t.http().get(\`/posts/\${id}\`).expect(200);
});`;

const TODO_SNIPPET = `// test/e2e/your-turn.e2e-spec.ts
// Завдання: зареєструй двох користувачів, перший створює пост, другий робить PATCH і має отримати 403.
// Потім адмін (UPDATE users SET role='admin' + повторний логін) робить той самий PATCH і отримує 200.
test.todo('чужий пост не редагується (403), адмін може (200)');

// Завдання: створи пост, зроби DELETE, перевір, що GET /posts?authorId=... його не повертає,
// а SELECT з withDeleted (або сирий SQL) його бачить з deleted_at.
test.todo('soft delete ховає пост зі списку, але рядок лишається');`;

const CI_STEPS: Array<[string, string]> = [
  ['actions/checkout@v4, setup-node 22 з кешем npm', 'код і Node'],
  ['сервіси: pgvector/pgvector:pg16 і redis:7 з health-check', 'справжні Postgres і Redis у job-і, не моки'],
  ['npm ci', 'залежності точно за package-lock'],
  ['npm run lint', 'eslint src test scripts'],
  ['npm run build', 'tsc, помилки типів падають тут'],
  ['npm test', 'unit, без БД (jest)'],
  ['npm run test:int', 'міграції і SQL проти справжнього Postgres'],
  ['npm run test:e2e', 'увесь застосунок через HTTP і WebSocket, воркер in-process; PGVECTOR=1 вмикає тест similar'],
];

export function TestsPage() {
  return (
    <>
      <PageTitle title="Тести і CI" sub="Unit без бази, int проти справжнього Postgres, e2e через HTTP і WebSocket; усе це на кожен push" />
      <Explain>
        <p>
          <b>Три рівні.</b> Що вище рівень, то більше він ловить і то повільніший. Unit-тести тримають логіку класу (права, арифметика відра, retry LLM) без
          мережі і без бази: якщо unit-тест вимагає Postgres, це вже не unit. Інтеграційні перевіряють те, що фейком не перевіриш: SQL, план запиту, міграції,
          тип колонки. e2e піднімають увесь застосунок з тими самими пайпами і фільтром, що у <code>main.ts</code>, і ходять у нього як клієнт.
        </p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Рівень</th>
              <th>Що перевіряє</th>
              <th>Що підміняємо</th>
              <th>Швидкість</th>
              <th>Команда</th>
            </tr>
          </thead>
          <tbody>
            {LEVELS.map(([level, what, fake, speed, cmd]) => (
              <tr key={level}>
                <td className="mono">{level}</td>
                <td>{what}</td>
                <td>{fake}</td>
                <td>{speed}</td>
                <td className="mono">{cmd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Explain>

      <Card title="Unit: фейки замість репозиторію">
        <pre className="mono" style={{ background: 'var(--bg-code)', padding: 10, borderRadius: 6 }}>
          {UNIT_SNIPPET}
        </pre>
      </Card>
      <Card title="Integration: справжній Postgres, без Nest">
        <pre className="mono" style={{ background: 'var(--bg-code)', padding: 10, borderRadius: 6 }}>
          {INT_SNIPPET}
        </pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          Тестова база окрема (<code>devhub_test</code> у <code>.env.test</code>) і щоразу перестворюється. З docker compose:{' '}
          <code>docker compose exec postgres createdb -U devhub devhub_test</code>.
        </div>
      </Card>
      <Card title="e2e: увесь застосунок через HTTP">
        <pre className="mono" style={{ background: 'var(--bg-code)', padding: 10, borderRadius: 6 }}>
          {E2E_SNIPPET}
        </pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          Що ще є в e2e: ротація refresh і виявлення повторного використання, 400 з назвою поля, offset і cursor, транзакція publish з імітацією падіння, кеш
          HIT/MISS, 11-й запит 429, 20 паралельних резервацій, звіт до completed, SSE, 3 спроби і failed, QUEUE_FULL, батчинг 250 подій, presence і дошка по
          WebSocket, GitHub 429 і retry.
        </div>
      </Card>

      <div className="card-grid">
        <Card title="CI: кроки (.github/workflows/ci.yml)">
          <ul className="checklist">
            {CI_STEPS.map(([step, why]) => (
              <li key={step}>
                <span>
                  <span className="mono">{step}</span>
                  <br />
                  <span className="muted small">{why}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="muted small" style={{ marginTop: 8 }}>
            Env у CI: NODE_ENV=test, DATABASE_URL на devhub_test, REDIS_URL db 1, QUEUE_MAX_WAITING=3, REPORT_STEP_MS=50 (щоб звіт тривав 250 мс, а не 5 с).
            Деплой стартує лише після зеленого CI: сторінка "Деплой".
          </div>
        </Card>

        <Card title="Напиши сам: два test.todo">
          <pre className="mono" style={{ background: 'var(--bg-code)', padding: 10, borderRadius: 6 }}>
            {TODO_SNIPPET}
          </pre>
          <div className="muted small" style={{ marginTop: 8 }}>
            Підказки: <code>t.http()</code>, <code>bearer(user)</code>, <code>t.dataSource.query(...)</code>. Скелет і хелпери вже є у файлі, подивись сусідні
            e2e-файли. Запуск одного файлу: <code>npm run test:e2e -- your-turn</code>.
          </div>
        </Card>
      </div>
    </>
  );
}
