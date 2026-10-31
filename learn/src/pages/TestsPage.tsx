// Тести і CI: статична сторінка за docs/testing.md і .github/workflows/ci.yml. Три рівні тестів з прикладом на кожен,
// кроки CI і завдання "напиши сам" з test/e2e/your-turn.e2e-spec.ts.
import { PanelFooter, Topic } from '../components/TopicParts';
import { Card, PageTitle } from '../components/common';

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

const E2E_SNIPPET = `// test/e2e/credits.e2e-spec.ts: createTestApp() піднімає AppModule на випадковому порту, запити через supertest
it('20 паралельних reserve(10) на 50 -> рівно 5 успішних (201), 15 відмов (422), баланс 0', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => t.http().post('/credits/reserve').set(bearer(user)).send({ amount: 10 })));
  expect(results.filter((r) => r.status === 201)).toHaveLength(5);
  expect(results.filter((r) => r.status === 422)).toHaveLength(15);
  const me = await t.http().get('/credits/me').set(bearer(user)).expect(200);
  expect(me.body.balance).toBe(0);
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

      <Topic
        what={
          <>
            Unit-тест перевіряє рішення одного класу. Усе, до чого клас звертається (репозиторій, Redis, LLM), підмінене фейком, тому тест іде мілісекунди і не
            потребує нічого запущеного.
          </>
        }
        when={
          <>
            Пиши, коли в класі є правила: хто кому що може, арифметика, retry. Не пиши, щоб перевірити SQL чи конфігурацію: фейк тільки підтвердить, що ти
            правильно його налаштував. Якщо unit-тесту потрібен Postgres, це вже не unit.
          </>
        }
        how={
          <>
            Сервіс отримує фейковий репозиторій у конструктор. Тест перевіряє, що чужий користувач отримає FORBIDDEN, а адмін ні. Команда npm test, файли
            src/**/*.spec.ts поруч із кодом.
          </>
        }
      />
      <Card title="Unit: фейки замість репозиторію">
        <pre className="code">{UNIT_SNIPPET}</pre>
        <PanelFooter
          paths={['src/modules/posts/posts.service.spec.ts', 'src/modules/ratelimit/token-bucket.service.spec.ts (відро з FakeRedis замість Redis)']}
          tries={[<>Прибери перевірку власника в PostsService.update і запусти npm test: який саме тест упав і чому тільки він?</>]}
        />
      </Card>

      <Topic
        what={
          <>
            Інтеграційний тест ходить у справжній Postgres без Nest і HTTP. Перевіряє те, що знає тільки база: міграції, типи колонок, індекси, сирий SQL.
          </>
        }
        when={
          <>
            Пиши для міграцій, складних запитів, обмежень (CHECK, UNIQUE) і всього, що залежить від поведінки Postgres. Не пиши для бізнес-правил: вони швидше і
            чесніше перевіряються unit-ом.
          </>
        }
        how={
          <>
            Тестова база окрема (devhub_test у .env.test) і перестворюється: DROP SCHEMA, далі міграції. Команда npm run test:int, файли test/int/*.int-spec.ts.
          </>
        }
      />
      <Card title="Integration: справжній Postgres, без Nest">
        <pre className="code">{INT_SNIPPET}</pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          З docker compose тестову базу створює команда <code>docker compose exec postgres createdb -U devhub devhub_test</code>.
        </div>
        <PanelFooter
          paths={['test/int/migrations.int-spec.ts', 'test/int/sql.int-spec.ts (план запиту і індекси)']}
          tries={[<>Додай міграцію з колонкою типу timestamp без зони і запусти npm run test:int: який тест її зловить?</>]}
        />
      </Card>

      <Topic
        what={
          <>
            e2e піднімає весь застосунок з тими самими пайпами, guard-ами і фільтром помилок, що в production, і ходить у нього як клієнт: HTTP, WebSocket. Воркер
            працює в тому самому процесі.
          </>
        }
        when={
          <>
            Пиши на ключові сценарії: логін і refresh, права, гонки, ліміти, черга. Не пиши e2e на кожну гілку if: вони повільні, і десяток таких тестів дає більше,
            ніж сотня. Деталі правил лишай unit-ам.
          </>
        }
        how={
          <>
            createTestApp() у test/helpers піднімає AppModule на випадковому порту, supertest шле запити. Зовнішні API підмінені (GitHub mock, Fake LLM). Команда npm
            run test:e2e, файли test/e2e/*.e2e-spec.ts. Саме цей тест гарантує, що лок на сторінці «Кредити» справді тримає.
          </>
        }
      />
      <Card title="e2e: увесь застосунок через HTTP">
        <pre className="code">{E2E_SNIPPET}</pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          Ще в e2e: ротація refresh і виявлення повторного використання, 400 з назвою поля, offset і cursor, кеш HIT/MISS, 11-й запит 429, звіт до completed, SSE,
          3 спроби і failed, QUEUE_FULL, батчинг 250 подій, presence і дошка по WebSocket, GitHub 429 і retry.
        </div>
        <PanelFooter
          paths={['test/e2e/credits.e2e-spec.ts', 'test/helpers/app.ts (той самий setupApp, що у main.ts)']}
          tries={[<>Прибери lock у CreditsService.reserve і запусти npm run test:e2e -- credits кілька разів: чи падає щоразу?</>]}
        />
      </Card>

      <div className="card-grid">
        <Card title="CI: кроки (.github/workflows/ci.yml)">
          <div className="prose">
            <p>На кожен push і pull request CI піднімає справжні Postgres і Redis і проганяє все по порядку. Падіння будь-якого кроку зупиняє решту. Деплой стартує лише після зеленого CI.</p>
          </div>
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
          </div>
          <PanelFooter
            paths={['.github/workflows/ci.yml', '.github/workflows/deploy.yml']}
            tries={[<>Додай у тест навмисне expect(1).toBe(2), запуш у гілку і подивись, який крок почервонів.</>]}
          />
        </Card>

        <Card title="Напиши сам: два test.todo">
          <pre className="code">{TODO_SNIPPET}</pre>
          <div className="muted small" style={{ marginTop: 8 }}>
            Підказки: <code>t.http()</code>, <code>bearer(user)</code>, <code>t.dataSource.query(...)</code>. Скелет і хелпери вже є у файлі, подивись сусідні
            e2e-файли.
          </div>
          <PanelFooter
            paths={['test/e2e/your-turn.e2e-spec.ts']}
            tries={[<>Запусти npm run test:e2e -- your-turn, заміни перший test.todo на справжній тест і додивись, що він зелений.</>]}
          />
        </Card>
      </div>
    </>
  );
}
