// Безпека: SQL-ін'єкція наживо (склеєний рядок проти параметра), helmet, CORS, bcrypt з часом логіну, і чому токени не пишуть у логи.
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, PageTitle } from '../components/common';
import { PanelFooter, Topic } from '../components/TopicParts';

interface InjectionResponse {
  safe: boolean;
  sql: string;
  rows?: Array<{ id: string; email: string }>;
}

interface Run {
  q: string;
  ms: number;
  body: InjectionResponse;
}

const PRESETS: Array<{ label: string; q: string; hint: string }> = [
  { label: 'Звичайний email', q: 'olena@devhub.local', hint: 'Нормальне введення: обидва способи дають один рядок. Тому ін’єкцію не зловиш звичайним тестуванням.' },
  { label: 'Завжди істина', q: "' OR 1=1 --", hint: 'Лапка закриває рядок, OR 1=1 робить умову істинною, -- відкидає решту. Склеєний запит віддасть усіх користувачів.' },
  {
    label: 'Витяг хешів паролів',
    q: "' UNION SELECT id, password_hash FROM users --",
    hint: 'UNION підклеює чужий SELECT. У колонці email з’являться хеші паролів: колонки, яких ендпоінт ніколи не віддавав.',
  },
  {
    label: 'Друга команда (пауза 1 с)',
    q: "x'; SELECT pg_sleep(1) --",
    hint: 'Крапка з комою починає нову команду. Рядків немає, але склеєний запит триватиме понад секунду: друга команда виконалась.',
  },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function SecurityPage() {
  const latency = useLatency();
  const [q, setQ] = useState("' OR 1=1 --");
  const [unsafe, setUnsafe] = useState<Run | null>(null);
  const [safe, setSafe] = useState<Run | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(isSafe: boolean) {
    setProblem(null);
    const res = await latency.track(apiCall('GET', '/demo/sql-injection', { query: { safe: isSafe, q }, auth: false }));
    if (res.status === 404) {
      setProblem('404: бекенд запущений не в development, і контролера в застосунку немає. Для production це правильна поведінка. Щоб побачити демо, запусти API з NODE_ENV=development.');
      return;
    }
    if (res.status === 0) {
      setProblem('API недоступний: перевір адресу в шапці.');
      return;
    }
    if (!res.ok) {
      setProblem(`${res.status}: ${res.statusText}. Деталі в панелі нижче.`);
      return;
    }
    const entry: Run = { q, ms: Math.round(res.durationMs), body: res.body as InjectionResponse };
    if (isSafe) setSafe(entry);
    else setUnsafe(entry);
  }

  async function runBoth() {
    await run(false);
    await run(true);
  }

  const preset = PRESETS.find((p) => p.q === q);
  const rowsText = (r: Run | null, withEmails: boolean) => {
    if (!r) return '?';
    const rows = r.body.rows ?? [];
    if (!withEmails || rows.length === 0) return `${rows.length} рядків`;
    return `${rows.length} рядків: ${rows
      .slice(0, 4)
      .map((x) => (x.email.length > 34 ? `${x.email.slice(0, 34)}...` : x.email))
      .join(', ')}${rows.length > 4 ? ', ...' : ''}`;
  };

  let verdict: string | null = null;
  if (unsafe && safe && unsafe.q === safe.q) {
    const u = unsafe.body.rows ?? [];
    const s = safe.body.rows ?? [];
    if (u.length > s.length) {
      verdict = `Склеєний рядок повернув рядків: ${u.length}, параметр: ${s.length}. Ця різниця і є ін’єкція.`;
      if (u.some((r) => r.email.startsWith('$2'))) verdict += ' Те, що в колонці email схоже на $2b$10$..., це bcrypt-хеші паролів.';
    } else if (unsafe.ms - safe.ms > 800) {
      verdict = `Рядків однаково, але склеєний запит ішов ${unsafe.ms} мс проти ${safe.ms} мс. Друга команда після крапки з комою виконалась.`;
    } else {
      verdict = 'Результат однаковий: на нормальному введенні обидва способи працюють. Небезпека видна тільки на ворожому введенні.';
    }
  }

  return (
    <>
      <PageTitle title="Безпека" sub="SQL-ін'єкція, helmet, CORS, bcrypt: що це, від чого рятує і коли можна не думати" />

      <h2>SQL-ін'єкція</h2>
      <Topic
        what={
          <>
            Це коли дані від користувача стають частиною самого SQL. Ти склеюєш рядок: <code>WHERE email = '</code> плюс введення плюс <code>'</code>. База не
            відрізняє твій код від чужого, для неї це один текст. Якщо у введенні є лапка, вона закриває твій рядок, і все, що після неї, виконується як SQL.
          </>
        }
        when={
          <>
            Параметри потрібні завжди, коли в запит потрапляє щось не написане тобою: query, тіло, заголовок, навіть значення, прочитане з власної бази. Винятків
            немає. ORM параметризує сам, але сирий рядок у <code>query()</code> або у <code>where</code> знову вразливий. Назву таблиці чи колонки параметром не
            передати: для них роблять whitelist.
          </>
        }
        how={
          <>
            Один ендпоінт у двох режимах. <code>safe=true</code>: текст запиту з <code>$1</code> і значення йдуть у Postgres окремо, значення ніколи не стає
            SQL. <code>safe=false</code>: рядок склеєний. Чесно про цей ендпоінт: він існує тільки при NODE_ENV=development, у production контролера в
            застосунку немає взагалі. І ще одна деталь: без параметрів драйвер pg шле простий запит, а в ньому Postgres приймає кілька команд через крапку з
            комою. Тому справжня ін’єкція може не лише читати, а й дописати <code>; DROP TABLE users</code>.
          </>
        }
      />
      <Card title="SQL-ін'єкція: склеєний рядок проти параметра">
        <div className="row">
          <label>
            готовий payload
            <select
              value={preset ? preset.q : ''}
              onChange={(e) => {
                if (e.target.value !== '') setQ(e.target.value);
              }}
            >
              {!preset && <option value="">свій</option>}
              {PRESETS.map((p) => (
                <option key={p.q} value={p.q}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            q (payload)
            <input className="mono" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 300 }} data-testid="payload" />
          </label>
        </div>
        {preset && <div className="muted small" style={{ marginBottom: 10 }}>{preset.hint}</div>}
        <div className="row">
          <button type="button" className="danger" onClick={() => void run(false)} disabled={latency.busy} data-testid="unsafe">
            safe=false (склеєний рядок)
          </button>
          <button type="button" className="primary" onClick={() => void run(true)} disabled={latency.busy} data-testid="safe">
            safe=true ($1)
          </button>
          <button type="button" onClick={() => void runBoth()} disabled={latency.busy} data-testid="both">
            Обидва підряд
          </button>
        </div>
        {problem && (
          <div className="note err" data-testid="problem">
            {problem}
          </div>
        )}
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>SQL, який пішов у Postgres</th>
              <th>Результат</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">safe=false</td>
              <td className="mono" data-testid="unsafe-sql">
                {unsafe?.body.sql ?? '?'}
              </td>
              <td data-testid="unsafe-rows">
                {rowsText(unsafe, true)}
                {unsafe && <span className="muted"> ({unsafe.ms} мс)</span>}
              </td>
            </tr>
            <tr>
              <td className="mono">safe=true</td>
              <td className="mono" data-testid="safe-sql">
                {safe?.body.sql ?? '?'}
              </td>
              <td data-testid="safe-rows">
                {rowsText(safe, false)}
                {safe && <span className="muted"> ({safe.ms} мс)</span>}
              </td>
            </tr>
          </tbody>
        </table>
        {verdict && (
          <div className="note" data-testid="verdict">
            {verdict}
          </div>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelFooter
          paths={['src/modules/security/sql-injection.controller.ts (обидві гілки)', 'src/modules/security/security.module.ts (forEnv: контролер лише в development)']}
          tries={[
            'Вибери "Звичайний email" і натисни "Обидва підряд": результат однаковий. Потім "Витяг хешів паролів": склеєний рядок віддасть хеші.',
            'Вибери "Друга команда" і порівняй час: склеєний запит триває понад секунду, параметризований ні.',
          ]}
        />
      </Card>

      <h2>helmet</h2>
      <Topic
        what="Middleware, яке додає до кожної відповіді захисні HTTP-заголовки. Це готовий набір, який браузер читає і сам вмикає обмеження."
        when={
          <>
            Від чого захищає: X-Content-Type-Options не дає браузеру вгадувати тип файлу, X-Frame-Options забороняє вставляти сторінку в чужий iframe,
            Strict-Transport-Security каже ходити лише по HTTPS. Коли можна не думати: для чистого JSON API майже завжди, достатньо один рядок підключення.
            Коли думати: якщо API віддає HTML.
          </>
        }
        how={
          <>
            Підключено в main.ts одним рядком. CSP вимкнено: Scalar (сторінка /reference) вантажить скрипти з CDN, і суворий CSP її зламав би. У своєму
            фронтенді з HTML Content-Security-Policy вмикають.
          </>
        }
      />
      <Card title="Заголовки, які бачить браузер">
        <pre className="code">{`$ curl -sI localhost:3000/health
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: no-referrer
Cross-Origin-Resource-Policy: same-origin`}</pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          Це справжній вивід цього API. З JavaScript на іншому origin ти цих заголовків не побачиш (CORS показує лише дозволені), тому тут curl, а не кнопка.
        </div>
        <PanelFooter
          paths={['src/main.ts (helmet, contentSecurityPolicy: false)']}
          tries={['Виконай curl -sI на свій API і порівняй із виводом вище. Потім у main.ts заміни contentSecurityPolicy на true і відкрий /reference: скрипти Scalar заблокуються.']}
        />
      </Card>

      <h2>CORS</h2>
      <Topic
        what="Правило браузера, не сервера. Сторінка з одного origin може звернутись до API на іншому, але браузер віддасть JavaScript відповідь лише якщо сервер явно дозволив цей origin."
        when={
          <>
            Від чого захищає: чужий сайт у вкладці користувача не прочитає відповіді твого API від його імені. Потрібен, коли фронтенд і API на різних origin
            (тут :5173 і :3000). Не потрібен для серверних викликів, curl і мобільних клієнтів: вони правило не застосовують. Це не авторизація: хто ходить без
            браузера, CORS не зупинить.
          </>
        }
        how={
          <>
            Список origin береться зі змінної CORS_ORIGINS. Окремо виставлено <code>exposedHeaders</code>: без нього JS бачить лише кілька стандартних заголовків,
            а X-Request-Id, X-Cache і X-RateLimit-* на сторінках курсу були б невидимі.
          </>
        }
      />
      <Card title="Той самий запит з різних origin">
        <pre className="code">{`$ curl -sI localhost:3000/health -H "Origin: http://localhost:5173"
Access-Control-Allow-Origin: http://localhost:5173
Vary: Origin

$ curl -sI localhost:3000/health -H "Origin: http://evil.example"
Vary: Origin                      <- Allow-Origin немає: браузер не віддасть відповідь JS`}</pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          Сервер відповів обом однаково з кодом 200. Забороняє саме браузер, коли не бачить свого origin у Allow-Origin.
        </div>
        <PanelFooter
          paths={['src/main.ts (enableCors, exposedHeaders)', 'src/modules/config/config.schema.ts (CORS_ORIGINS)']}
          tries={['Зміни порт у шапці на сторінці на таку адресу, якої немає в CORS_ORIGINS, і подивись у консолі браузера помилку CORS.', 'Прибери X-Cache з exposedHeaders і відкрий сторінку "Кеш": колонка X-Cache стане порожньою.']}
        />
      </Card>

      <h2>bcrypt і паролі</h2>
      <Topic
        what={
          <>
            Хеш-функція для паролів, яка повільна навмисно. Сіль зашита в сам хеш, тому однакові паролі дають різні хеші. Параметр cost (тут 10) це
            2<sup>10</sup> раундів: кожна одиниця подвоює час.
          </>
        }
        when={
          <>
            Від чого захищає: якщо базу вкрали, перебрати паролі коштує дуже дорого (одна спроба 50-100 мс замість мікросекунд). Не потрібен там, де пароля немає:
            токени API, refresh-токени. Вони довгі й випадкові, тому для них достатньо швидкого sha256. md5, sha1 і sha256 для паролів не можна ніколи.
          </>
        }
        how={
          <>
            BCRYPT_COST=10 з конфіга, перевірка через <code>bcrypt.compare</code>. На логіні тут є дрібна діра, яку видно на панелі нижче: відповідь 401 однакова,
            але час різний.
          </>
        }
      />
      <BcryptCard />

      <h2>Токени не пишуть у логи</h2>
      <Topic
        what="Будь-що, що дає доступ (JWT, refresh-токен, пароль, ключ API), не має потрапляти в логи. Ні в тілі, ні в URL."
        when={
          <>
            Чому: логи читає більше людей і систем, ніж базу: збирач логів, дашборд, чат, куди хтось скопіював рядок. Токен у лозі діє, поки не спливе. Тому
            правило без винятків: не логувати Authorization, пароль, тіла /auth/*.
          </>
        }
        how={<TokenLogNote />}
      />
      <Card title="Що саме потрапляє в лог запиту">
        <pre className="code">{`без redactUrl:  GET /reports/42/events?token=eyJhbGciOiJIUzI1NiIs...  200 31ms
з redactUrl:    GET /reports/42/events?token=[redacted]  200 31ms`}</pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          Перший рядок: так виглядав би access-лог для SSE, якби middleware писав originalUrl як є. Другий: що він пише насправді. Шаблон рядка з реального
          middleware, токен умовний.
        </div>
        <PanelFooter
          paths={['src/modules/logging/request-id.middleware.ts (redactUrl і рядок access-логу)', 'src/modules/logging/request-id.middleware.spec.ts (що саме вирізається)', 'src/modules/jobs/reports.controller.ts (токен у ?token= для SSE)']}
          tries={[
            'Відкрий сторінку "Черга", запусти звіт з SSE і знайди в логах API рядок із цим запитом: замість токена має бути [redacted].',
            'Додай у SECRET_QUERY_PARAMS ще один параметр (наприклад, api_key) і допиши випадок у request-id.middleware.spec.ts.',
          ]}
        />
      </Card>
    </>
  );
}

// Пояснення про логування query з токеном. Текст відповідає тому, що зараз робить request-id.middleware.ts.
function TokenLogNote() {
  return (
    <>
      Заголовок Authorization і пароль ми не логуємо. Але access-лог пише <code>originalUrl</code> разом з query, а EventSource не вміє ставити заголовки,
      тому SSE-ендпоінт і Bull Board приймають JWT у <code>?token=</code>. Без додаткового кроку токен SSE-запиту потрапив би в лог. Тому перед записом
      <code>redactUrl</code> замінює значення <code>token</code>, <code>access_token</code>, <code>refresh_token</code>, <code>key</code> і <code>password</code> у query на <code>[redacted]</code>:
      шлях і решта параметрів лишаються, їх можна шукати в логах. Сильніший варіант, коли токен у query взагалі не потрібен: сервер видає одноразовий короткий
      ticket на кілька секунд, і в SSE-URL іде він, а не JWT.
    </>
  );
}

function BcryptCard() {
  const latency = useLatency();
  const [result, setResult] = useState<{ known: number; unknown: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function measure() {
    setProblem(null);
    setResult(null);
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = await latency.track(apiCall('POST', '/auth/login', { body: { email: 'olena@devhub.local', password: 'wrong-password' }, auth: false }));
      if (a.status === 0) {
        setProblem('API недоступний: перевір адресу в шапці.');
        return;
      }
      known.push(a.durationMs);
      const b = await latency.track(apiCall('POST', '/auth/login', { body: { email: `nobody${i}@devhub.local`, password: 'wrong-password' }, auth: false }));
      unknown.push(b.durationMs);
    }
    setResult({ known: median(known), unknown: median(unknown) });
  }

  return (
    <Card title="Однакова 401, різний час">
      <div className="prose">
        <p>
          Хеш виглядає так: <code>$2b$10$</code> (версія і cost), потім 22 символи солі <code>nZj0jzAyQw4xuIQfSGeQse</code>, потім 31 символ самого хешу{' '}
          <code>BZq8OVuyqYXe/zDPigIib/WArIttEWm</code>. Це справжній хеш із бази навчального сіду.
        </p>
        <p>
          Кнопка робить по 5 невдалих логінів: з email, який існує, і з вигаданим. Тіло відповіді в обох однакове, але для існуючого email сервер рахує bcrypt, а
          для неіснуючого одразу відповідає.
        </p>
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={() => void measure()} disabled={latency.busy} data-testid="bcrypt-measure">
          {latency.busy ? 'міряю...' : 'POST /auth/login 10 разів'}
        </button>
      </div>
      {problem && <div className="note err">{problem}</div>}
      {result && (
        <>
          <div className="cols-3" style={{ marginBottom: 12 }} data-testid="bcrypt-result">
            <div className="col">
              <h3>email існує</h3>
              <div className="big">{result.known} мс</div>
              <div className="muted small">медіана з 5, bcrypt.compare</div>
            </div>
            <div className="col">
              <h3>email вигаданий</h3>
              <div className="big">{result.unknown} мс</div>
              <div className="muted small">медіана з 5, без bcrypt</div>
            </div>
          </div>
          <div className="note">
            Атакуючий міряє час і дізнається, які email зареєстровані. Виправлення: коли користувача нема, все одно порівняти пароль з фіктивним хешем. Тут цього
            не зроблено.
          </div>
        </>
      )}
      <Panel exchange={latency.exchange} busy={latency.busy} />
      <PanelFooter
        paths={['src/modules/auth/auth.service.ts (register: bcrypt.hash, login: bcrypt.compare, sha256 для refresh)', 'src/modules/config/config.schema.ts (BCRYPT_COST)']}
        tries={['Запусти API з BCRYPT_COST=12 і повтори замір: час для існуючого email зросте приблизно вчетверо.', 'Додай у login фіктивне порівняння для неіснуючого користувача і переміряй: час має зрівнятись.']}
      />
    </Card>
  );
}
