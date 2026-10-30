// Конфіг і помилки: як застосунок падає на старті з ясним текстом (config), кнопки на кожен код і таблиця "коли який код" (errors).
// Усі відповіді з помилкою мають однакову форму з requestId.
import { useState } from 'react';
import { apiCall, ApiExchange } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, StatusBadge } from '../components/Panel';
import { Card, Explain, NeedAuth, PageTitle } from '../components/common';

interface ErrorButton {
  code: number;
  label: string;
  needsAuth: boolean;
  run: () => Promise<ApiExchange>;
  testId: string;
}

const CODE_ROWS: Array<[string, string, string]> = [
  ['400', 'Тіло або query не проходять валідацію', 'невідоме поле role у POST /auth/register'],
  ['401', 'Немає або невалідний токен', 'GET /auth/me без Bearer'],
  ['403', 'Користувач відомий, але права не ті', 'user викликає POST /credits/topup'],
  ['404', "Об'єкта немає (або він м'яко видалений)", 'GET /posts/:id після DELETE'],
  ['409', 'Конфлікт стану', 'email зайнятий, пост уже опублікований'],
  ['422', 'Запит валідний, але бізнес-правило не дозволяє', 'INSUFFICIENT_CREDITS'],
  ['429', 'Ліміт', 'token bucket, QUEUE_FULL, @nestjs/throttler'],
  ['500', 'Наш баг', 'будь-який необроблений виняток, stack тільки в лог'],
];

export function ErrorsPage() {
  const auth = useAuth();
  const latency = useLatency();
  const [burst, setBurst] = useState<ApiExchange[]>([]);

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
      label: '403: POST /credits/topup як user',
      needsAuth: true,
      testId: 'err-403',
      run: () => apiCall('POST', '/credits/topup', { body: { userId: auth.user?.id ?? '', amount: 1 } }),
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
      <Explain>
        <p>
          <b>Конфіг: перевірка на старті.</b> Усі змінні оточення читаються один раз і проходять zod-схему (<code>src/modules/config/config.schema.ts</code>).
          Далі код працює з типізованим <code>AppConfig</code>, а не з <code>process.env.X</code>, який може бути <code>undefined</code>.{' '}
          <code>z.coerce.number()</code> перетворює <code>"10"</code> у <code>10</code>, тому ніхто не робить <code>Number(...)</code> по коду, а значення за
          замовчуванням живуть в одному місці. Якщо бракує <code>DATABASE_URL</code> або <code>JWT_SECRET</code>, процес не стартує і друкує:
        </p>
        <pre>{`Застосунок не може стартувати: помилки у змінних оточення.
  DATABASE_URL: Invalid input: expected string, received undefined. Підказка: Рядок підключення до PostgreSQL, напр. postgres://devhub:devhub@localhost:5432/devhub
  JWT_SECRET: Invalid input: expected string, received undefined. Підказка: Секрет для підпису JWT, мінімум 16 символів. Згенеруй: openssl rand -hex 32
Див. .env.example у корені проєкту.`}</pre>
        <p className="muted small">
          Спробуй сам: прибери <code>JWT_SECRET</code> з <code>.env</code>, запусти <code>npm run dev</code>, прочитай повідомлення, поверни назад. Усі змінні з
          коментарями: <code>.env.example</code>; unit-тест на помилку і перетворення типів: <code>config.spec.ts</code>.
        </p>
      </Explain>
      <Explain>
        <p>
          <b>Помилки: одна форма для всього.</b> Сервіси кидають доменні класи (<code>NotFoundError</code>, <code>ConflictError</code>,{' '}
          <code>UnprocessableError</code>
          ...), а глобальний фільтр <code>AllExceptionsFilter</code> перекладає їх у HTTP-код і одну форму тіла:
        </p>
        <pre>{`{ "statusCode": 404, "code": "NOT_FOUND", "message": "Post 3f2... не знайдено",
  "details": { "entity": "Post", "id": "3f2..." }, "requestId": "7c1b..." }`}</pre>
        <p>
          Помилки валідації від <code>ValidationPipe</code> теж проходять через фільтр: <code>code: VALIDATION_ERROR</code>, у <code>details</code> список
          повідомлень з назвами полів. Невідомі помилки стають <code>500 INTERNAL_ERROR</code> без тексту винятку назовні; повний stack іде в лог з тим самим{' '}
          <code>requestId</code>, що й у відповіді і в заголовку <code>X-Request-Id</code>. Фронтенд пише одну функцію обробки помилок.
        </p>
      </Explain>

      <Card title="Викликати помилку">
        <NeedAuth>Кнопки 403 і 422 потребують токена (і не-admin для 403).</NeedAuth>
        <div className="row">
          {buttons.map((b) => (
            <button
              key={b.code}
              type="button"
              data-testid={b.testId}
              disabled={latency.busy || (b.needsAuth && !auth.tokens)}
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
      </Card>

      <Card title="Коли який код">
        <table className="tbl">
          <thead>
            <tr>
              <th>Код</th>
              <th>Коли</th>
              <th>Приклад у проєкті</th>
            </tr>
          </thead>
          <tbody>
            {CODE_ROWS.map(([code, when, example]) => (
              <tr key={code}>
                <td>
                  <StatusBadge status={Number(code)} />
                </td>
                <td>{when}</td>
                <td className="mono">{example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
