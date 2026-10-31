// Конфіг і помилки: як застосунок падає на старті з ясним текстом (config), кнопки на кожен код і таблиця "коли який код" (errors).
// Усі відповіді з помилкою мають однакову форму з requestId.
import { useState } from 'react';
import { apiCall, ApiExchange } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, StatusBadge } from '../components/Panel';
import { Card, NeedAuth, PageTitle } from '../components/common';
import { Concept, PanelNotes } from '../components/topic';

interface PostBrief {
  id: string;
  likes: number;
  authorId: string;
}

interface ErrorButton {
  code: number;
  label: string;
  needsAuth: boolean;
  run: () => Promise<ApiExchange>;
  testId: string;
}

interface CodeRow {
  code: string;
  when: string;
  mistake: string;
  example: string;
}

const CODE_ROWS: CodeRow[] = [
  {
    code: '200',
    when: 'Усе вдалося. 201 для створення, 204 коли відповідати нічим (DELETE).',
    mistake: 'Віддати 200 з тілом { "error": true }. Моніторинг, ретраї і кеш бачать успіх, а помилку помічає тільки хтось, хто читає тіло.',
    example: 'DELETE /posts/:id повертає 204',
  },
  {
    code: '400',
    when: 'Сервер не зміг розібрати запит: зламаний JSON, зайве поле, не той тип, не uuid у шляху.',
    mistake: 'Віддати 500 на невалідне тіло, бо «щось пішло не так». Це помилка клієнта, і алерт про 500 прокинеться даремно.',
    example: 'POST /auth/register з полем role',
  },
  {
    code: '401',
    when: 'Сервер не знає, хто ти: токена немає, він протермінований або підпис не зійшовся.',
    mistake: 'Віддавати 403 для «не залогінений». 401 каже клієнту «увійди або онови токен», 403 каже «входити марно».',
    example: 'GET /auth/me без Bearer',
  },
  {
    code: '403',
    when: 'Сервер знає, хто ти, але тобі не можна.',
    mistake:
      'Для чужого ресурсу, про який не можна навіть казати, віддати 403 замість 404: цим ти підтвердив, що він існує. У нас пости публічні, тому PATCH чужого поста чесно 403. Для чужого приватного листа було б 404.',
    example: 'PATCH чужого поста, POST /credits/topup як user',
  },
  {
    code: '404',
    when: "Об'єкта немає, або він м'яко видалений, або його не можна показувати цьому користувачу.",
    mistake: 'Віддати 200 з порожнім тілом або { "found": false }. І навпаки, 404 на порожній список: список без елементів це 200 і [].',
    example: 'GET /posts/:id після DELETE',
  },
  {
    code: '409',
    when: 'Запит правильний, але суперечить поточному стану: email зайнятий, пост уже опублікований, restore не видаленого.',
    mistake: 'Віддати 400 або 500 на порушення унікального індексу. Клієнт не зрозуміє, що слід змінити дані й спробувати інакше.',
    example: 'POST /auth/register на зайнятий email',
  },
  {
    code: '422',
    when: 'Запит розібрано, форма правильна, але бізнес-правило відмовляє.',
    mistake: '400 і 422 плутають постійно. Просте правило: 400 це «не можу прочитати», 422 «прочитав, але не можу виконати». Головне триматись одного вибору в усьому API.',
    example: 'INSUFFICIENT_CREDITS у POST /credits/reserve',
  },
  {
    code: '429',
    when: 'Запитів забагато або черга повна. Завжди додавай Retry-After.',
    mistake: 'Відповісти 500 чи 503 без Retry-After: клієнт повторює одразу і добиває сервер.',
    example: '/demo/throttled, QUEUE_FULL',
  },
  {
    code: '500',
    when: 'Наш баг. Клієнт нічого не може виправити.',
    mistake: 'Віддавати разом з відповіддю текст винятку чи stack: це підказка атакуючому. Текст іде в лог, назовні лише requestId.',
    example: 'будь-який необроблений виняток',
  },
  {
    code: '502',
    when: 'Зовнішній сервіс (GitHub, LLM) не відповів або віддав сміття.',
    mistake: 'Віддати 500: здається, що баг у нашому коді, і алерт летить не тій команді.',
    example: 'POST /github/import при недоступному GitHub',
  },
];

export function ErrorsPage() {
  const auth = useAuth();
  const latency = useLatency();
  const [burst, setBurst] = useState<ApiExchange[]>([]);
  const isAdmin = auth.user?.role === 'admin';

  const buttons: ErrorButton[] = [
    {
      code: 400,
      label: '400: POST /auth/register з полем role',
      needsAuth: false,
      testId: 'err-400',
      run: () => apiCall('POST', '/auth/register', { body: { email: 'x@example.com', password: 'password123', displayName: 'X', role: 'admin' }, auth: false }),
    },
    {
      code: 401,
      label: '401: GET /auth/me без токена',
      needsAuth: false,
      testId: 'err-401',
      run: () => apiCall('GET', '/auth/me', { auth: false }),
    },
    {
      code: 403,
      label: '403: PATCH чужого поста',
      needsAuth: true,
      testId: 'err-403',
      run: async () => {
        // Шукаємо пост, автор якого не ми. Якщо не знайшли, панель покаже сам список.
        const list = await apiCall('GET', '/posts', { query: { pageSize: 50 }, auth: false });
        const items = list.ok && typeof list.body === 'object' && list.body !== null && 'items' in list.body ? (list.body.items as PostBrief[]) : [];
        const foreign = items.find((p) => p.authorId !== auth.user?.id);
        if (!foreign) return list;
        return apiCall('PATCH', `/posts/${foreign.id}`, { body: { likes: foreign.likes } });
      },
    },
    {
      code: 404,
      label: '404: GET /posts/<випадковий uuid>',
      needsAuth: false,
      testId: 'err-404',
      run: () => apiCall('GET', '/posts/00000000-0000-4000-8000-000000000001', { auth: false }),
    },
    {
      code: 409,
      label: '409: POST /auth/register на зайнятий email',
      needsAuth: false,
      testId: 'err-409',
      run: () => apiCall('POST', '/auth/register', { body: { email: 'olena@devhub.local', password: 'password123', displayName: 'Olena' }, auth: false }),
    },
    {
      code: 422,
      label: '422: POST /credits/reserve на 1 000 000',
      needsAuth: true,
      testId: 'err-422',
      run: () => apiCall('POST', '/credits/reserve', { body: { amount: 1_000_000 } }),
    },
  ];

  async function burst429() {
    // GET /demo/throttled обмежений @nestjs/throttler: 10 за 10 с. 11-й і далі дають 429.
    const results: ApiExchange[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await latency.track(apiCall('GET', '/demo/throttled', { auth: false }));
      results.push(res);
      setBurst([...results]);
    }
  }

  return (
    <>
      <PageTitle
        title="Конфіг і формат помилок"
        sub="Падіння на старті з ясним текстом замість падіння в третьому запиті; одна форма JSON для будь-якої помилки"
      />

      <Concept
        what={
          <p>
            Застосунок бере налаштування (адреса бази, секрет JWT, порти) зі змінних оточення. Це просто рядки, і будь-якої може не бути або вона може бути
            зіпсована. Ідея проста: перевірити всі разом одразу при старті, і якщо щось не так, впасти з ясним текстом, а не на третьому запиті з «cannot read
            properties of undefined».
          </p>
        }
        when={
          <>
            <p>
              Потрібно, щойно змінних більше трьох-чотирьох і застосунок живе довше за один запуск. Помилку в конфігу тоді ловить деплой або CI, а не користувач
              о другій ночі. Не потрібно скрипту на 50 рядків з однією змінною: там вистачить звичайного if.
            </p>
            <p>Перевірка на старті не замінює перевірку «чи працює Redis». Вона каже лише, що змінна є і має правильний вигляд, а не що за адресою хтось відповідає.</p>
          </>
        }
        how={
          <>
            <p>
              Усі змінні один раз проходять через zod-схему. Схема сама перетворює типи: рядок «10» стає числом 10, тому ніхто в коді не пише Number(...), а
              значення за замовчуванням живуть в одному місці. Решта коду отримує типізований об'єкт конфігу, а не <code>process.env</code>. Якщо обов'язкової
              змінної немає, процес не стартує і друкує:
            </p>
            <pre>{`Застосунок не може стартувати: помилки у змінних оточення.
  DATABASE_URL: Invalid input: expected string, received undefined. Підказка: Рядок підключення до PostgreSQL, напр. postgres://devhub:devhub@localhost:5432/devhub
  JWT_SECRET: Invalid input: expected string, received undefined. Підказка: Секрет для підпису JWT, мінімум 16 символів. Згенеруй: openssl rand -hex 32
Див. .env.example у корені проєкту.`}</pre>
            <PanelNotes
              where={['src/modules/config/config.schema.ts', 'src/modules/config/config.module.ts', 'src/modules/config/config.spec.ts (unit-тест на помилку і на перетворення типів)']}
              tryItems={[
                <>
                  Прибери <code>JWT_SECRET</code> з <code>.env</code>, запусти <code>npm run dev</code>, прочитай повідомлення, поверни назад.
                </>,
                <>
                  Постав <code>DB_POOL_MAX=abc</code>: схема скаже, що це не число, і назве змінну.
                </>,
              ]}
            />
          </>
        }
      />

      <Concept
        what={
          <>
            <p>
              Коли щось іде не так, сервер каже про це двічі. HTTP-кодом, для машин: від нього залежать ретраї, алерти і кеш. І тілом, для людини і фронтенду:
              що саме сталося. Ідея в тому, що тіло в усіх помилок однакове.
            </p>
            <pre>{`{ "statusCode": 404, "code": "NOT_FOUND", "message": "Post 3f2... не знайдено",
  "details": { "entity": "Post", "id": "3f2..." }, "requestId": "7c1b..." }`}</pre>
          </>
        }
        when={
          <>
            <p>
              Одна форма потрібна, щойно в API більше одного клієнта або одного ендпоінта: фронтенд пише одну функцію обробки помилок замість десяти. Без
              спільного фільтра виходить, як зазвичай: валідація віддає одну форму, роутер на 404 іншу, а необроблений виняток іноді показує stack.
            </p>
            <p>Код має казати правду. Найгірше, що можна зробити, це 200 з «error: true»: усе, що не читає тіло, вважає, що все добре.</p>
          </>
        }
        how={
          <>
            <p>
              Сервіси кидають доменні помилки (NotFoundError, ConflictError, UnprocessableError), не знаючи про HTTP. Глобальний фільтр перетворює їх на код і тіло.
              Помилки валідації теж проходять через фільтр: код VALIDATION_ERROR, а в details список повідомлень з назвами полів. Невідоме падіння стає 500
              INTERNAL_ERROR без тексту винятку.
            </p>
            <p>
              Повний stack іде тільки в лог з тим самим requestId, що й у відповіді та в заголовку X-Request-Id. Користувач називає requestId в підтримку, і ти
              знаходиш рядок у логах (див. сторінку Логи).
            </p>
          </>
        }
      />

      <Card title="Викликати помилку">
        <div className="prose">
          <p>
            Кожна кнопка навмисно робить поганий запит. У всіх кодів одна форма тіла, відрізняються тільки code і details. У 400 details називає поле, яке не
            пройшло. У 429 є заголовок Retry-After, а ряд квадратиків показує, на якому запиті з 12 спрацював ліміт.
          </p>
        </div>
        <NeedAuth>Кнопки 403 і 422 потребують токена.</NeedAuth>
        {isAdmin && <div className="note">Ти admin, а admin може все, тому 403 не вийде. Увійди як olena@devhub.local.</div>}
        <div className="row">
          {buttons.map((b) => (
            <button
              key={b.code}
              type="button"
              data-testid={b.testId}
              disabled={latency.busy || (b.needsAuth && !auth.tokens) || (b.code === 403 && isAdmin)}
              onClick={() => {
                setBurst([]);
                void latency.track(b.run());
              }}
            >
              {b.label}
            </button>
          ))}
          <button type="button" className="primary" data-testid="err-429" disabled={latency.busy} onClick={() => void burst429()}>
            429: 12 x GET /demo/throttled
          </button>
        </div>
        {burst.length > 0 && (
          <div className="dots" data-testid="burst">
            {burst.map((r, i) => (
              <span key={i} className={`dot s${Math.floor(r.status / 100)}`} title={`${r.status} за ${r.durationMs} мс`}>
                {r.status}
              </span>
            ))}
          </div>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelNotes
          where={['src/modules/errors/domain-errors.ts', 'src/modules/errors/http-exception.filter.ts (AllExceptionsFilter)', 'src/app-setup.ts (ValidationPipe: whitelist, forbidNonWhitelisted)']}
          tryItems={[
            <>
              Натисни 400 і знайди в details назву поля. Потім 404 і порівняй поля тіла: ті самі <code>statusCode, code, message, requestId</code>.
            </>,
            <>Натисни 429 двічі поспіль: другий раз перші квадратики вже червоні, бо вікно в 10 секунд ще не закінчилось.</>,
          ]}
        />
      </Card>

      <Card title="Коли який код">
        <table className="tbl">
          <thead>
            <tr>
              <th>Код</th>
              <th>Коли повертати</th>
              <th>Типова помилка новачка</th>
              <th>Приклад у проєкті</th>
            </tr>
          </thead>
          <tbody>
            {CODE_ROWS.map((row) => (
              <tr key={row.code}>
                <td>
                  <StatusBadge status={Number(row.code)} />
                </td>
                <td>{row.when}</td>
                <td>{row.mistake}</td>
                <td className="mono">{row.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <PanelNotes
          where={['src/modules/errors/http-exception.filter.ts (statusForDomainError)', 'src/modules/errors/domain-errors.ts']}
          tryItems={[
            <>Знайди в коді, де кидається ConflictError і де UnprocessableError, і поясни собі, чому там саме такі коди.</>,
            <>
              Додай свій клас помилки (наприклад, GoneError для 410), кинь його і не додавай рядок у <code>statusForDomainError</code>: відповідь буде 500. Ось чому
              мапінг живе в одному місці.
            </>,
          ]}
        />
      </Card>
    </>
  );
}
