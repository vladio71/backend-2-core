// Rate limit: 15 x POST /posts підряд, таблиця статусів і X-RateLimit-* заголовків, візуалізація відра.
import { useEffect, useState } from 'react';
import { apiCall, ApiExchange } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, StatusBadge } from '../components/Panel';
import { PanelFooter, Topic } from '../components/TopicParts';
import { Card, NeedAuth, PageTitle } from '../components/common';

interface Shot {
  index: number;
  t: number;
  status: number;
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
  retryAfter: string | null;
  durationMs: number;
  sentAt: number;
}

interface FixedShot {
  burst: string;
  status: number;
  remaining: string;
  reset: string;
  t: number;
}

function toShot(index: number, t: number, res: ApiExchange): Shot {
  const num = (name: string) => (res.headers[name] !== undefined ? Number(res.headers[name]) : null);
  return {
    index,
    t,
    status: res.status,
    limit: num('x-ratelimit-limit'),
    remaining: num('x-ratelimit-remaining'),
    resetAt: num('x-ratelimit-reset'),
    retryAfter: res.headers['retry-after'] ?? null,
    durationMs: res.durationMs,
    sentAt: Date.now(),
  };
}

export function RateLimitPage() {
  const auth = useAuth();
  const latency = useLatency();
  const [shots, setShots] = useState<Shot[]>([]);
  const [running, setRunning] = useState(false);
  const [fixedBusy, setFixedBusy] = useState(false);
  const [fixedShots, setFixedShots] = useState<FixedShot[]>([]);
  const [fixedLog, setFixedLog] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // План: числа це кількість запитів поспіль, { pause } це пауза в мс. Перед планом відро скидається, тож результат не залежить від попередніх кліків.
  async function send(plan: Array<number | { pause: number }>, reset = true) {
    setRunning(true);
    setShots([]);
    const started = performance.now();
    const list: Shot[] = [];
    try {
      if (reset) await latency.track(apiCall('POST', '/demo/ratelimit/reset'));
      for (const step of plan) {
        if (typeof step !== 'number') {
          await new Promise((resolve) => setTimeout(resolve, step.pause));
          continue;
        }
        for (let i = 0; i < step; i++) {
          const index = list.length + 1;
          const res = await latency.track(
            apiCall('POST', '/posts', { body: { title: `rate-limit demo ${index}`, body: `Пост ${index} зі сторінки Rate limit`, tags: ['demo'] } }),
          );
          list.push(toShot(index, Math.round(performance.now() - started), res));
          setShots([...list]);
        }
      }
    } finally {
      setRunning(false);
    }
  }

  // Fixed window з @nestjs/throttler: 10 запитів на вікно 10 с, вікно рахується від першого запиту.
  // Показуємо межу вікна: 10 запитів у кінці вікна і ще 10 одразу після його закінчення. Усі 20 проходять за ~1 с.
  async function fixedWindowBoundary() {
    setFixedBusy(true);
    setFixedShots([]);
    setFixedLog([]);
    const log = (line: string) => setFixedLog((prev) => [...prev, line]);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const all: FixedShot[] = [];
    const fire = async (label: string, count: number, t0: number) => {
      const results = await Promise.all(Array.from({ length: count }, () => apiCall('GET', '/demo/throttled', { auth: false })));
      for (const r of results) all.push({ burst: label, status: r.status, remaining: r.headers['x-ratelimit-remaining'] ?? '-', reset: r.headers['x-ratelimit-reset'] ?? r.headers['retry-after'] ?? '-', t: Math.round(performance.now() - t0) });
      setFixedShots([...all]);
    };
    try {
      // 1. Свіже вікно: проба. Якщо вікно уже використане (remaining не 9) або там 429, чекаємо, поки воно закінчиться.
      let probeAt = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        probeAt = performance.now();
        const probe = await apiCall('GET', '/demo/throttled', { auth: false });
        const remaining = Number(probe.headers['x-ratelimit-remaining']);
        if (probe.status === 200 && remaining === 9) {
          all.push({ burst: 'проба', status: 200, remaining: '9', reset: probe.headers['x-ratelimit-reset'] ?? '-', t: 0 });
          break;
        }
        const wait = Number(probe.headers['retry-after'] ?? probe.headers['x-ratelimit-reset'] ?? 10) * 1000 + 500;
        log(`вікно вже використане, чекаю ${Math.round(wait / 1000)} с, поки воно закінчиться`);
        await sleep(wait);
      }
      if (all.length === 0) {
        log('не вдалось отримати свіже вікно, спробуй ще раз');
        return;
      }
      setFixedShots([...all]);
      // 2. Перший сплеск наприкінці вікна: ще 9 запитів на 9,4 с від проби. Разом 10 з 10.
      log('проба відкрила вікно на 10 с; чекаю до його кінця');
      await sleep(Math.max(0, 9400 - (performance.now() - probeAt)));
      await fire('кінець вікна', 9, probeAt);
      log('9 запитів наприкінці вікна пройшли (разом 10 з 10)');
      // 3. Другий сплеск одразу після закінчення вікна.
      await sleep(Math.max(0, 10300 - (performance.now() - probeAt)));
      await fire('початок нового вікна', 10, probeAt);
      log('ще 10 запитів одразу після межі');
    } finally {
      setFixedBusy(false);
    }
  }

  const last = shots[shots.length - 1];
  const capacity = last?.limit ?? 10;
  // Оцінка поточного стану відра: remaining з останньої відповіді + 1 токен/с, що минула відтоді.
  const elapsedSinceLast = last ? Math.max(0, (now - last.sentAt) / 1000) : 0;
  const estimated = last && last.remaining !== null ? Math.min(capacity, Math.floor(last.remaining + elapsedSinceLast)) : capacity;

  return (
    <>
      <PageTitle title="Rate limit" sub="Token bucket у Redis на Lua: 10 запитів за 10 с на користувача для POST /posts" />

      <Topic
        what={
          <>
            Rate limit обмежує, скільки запитів один користувач може зробити за час. Це захист від клієнта із зацикленим кодом, від підбору паролів і від того,
            що один користувач з'їсть ресурси всіх. Відмова виглядає як 429 із підказкою, коли повторити.
          </>
        }
        when={
          <>
            Потрібно на маршрутах, що коштують дорого або чутливі: логін, створення, пошук, виклики до платних API. Не потрібно на дешевих GET, які й так віддає кеш,
            і там, де ліміт уже є вище: nginx чи API gateway рахують швидше, ніж твій код.
          </>
        }
        how={
          <>
            Для кожного користувача (або IP, якщо анонімний) у Redis лежить відро: ємність 10 токенів, поповнення 1 токен за секунду. Кожен запит бере один. Порожнє
            відро це 429. Lua потрібен, бо «прочитати, порахувати, записати» з Node це три команди, і між ними влізе другий запит: та сама гонка, що на сторінці
            «Кредити». Redis, а не пам'ять процесу, бо два API мають рахувати спільно.
          </>
        }
        extra={
          <>
            <pre>{`token bucket (10 токенів, +1/с)         fixed window (10 на вікно 10 с)
t=0     [##########] 10 запитів: ok     t=0..9.9  10 запитів: ok
t=0.1   [          ] 11-й: 429          t=10.0    лічильник скинуто
t=1     [#         ] 1 запит: ok        t=10.1    ще 10 запитів: ok
t=5     [#####     ] 5 запитів: ok      -> 20 запитів за 0,2 с на межі вікна
сплеск дозволений, але лише раз          межа вікна пропускає подвійний сплеск`}</pre>
            <p>Що означають заголовки відповіді:</p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Заголовок</th>
                  <th>Значення</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono">X-RateLimit-Limit</td>
                  <td>ємність відра, тут 10</td>
                </tr>
                <tr>
                  <td className="mono">X-RateLimit-Remaining</td>
                  <td>скільки токенів лишилось після цього запиту</td>
                </tr>
                <tr>
                  <td className="mono">X-RateLimit-Reset</td>
                  <td>unix-час, коли відро знову буде повне. У throttler це інше: секунди до кінця вікна. Умовності різні, читай документацію.</td>
                </tr>
                <tr>
                  <td className="mono">Retry-After</td>
                  <td>тільки на 429: за скільки секунд можна повторити</td>
                </tr>
              </tbody>
            </table>
          </>
        }
      />

      <Card title="Token bucket: сплеск і повільна течія">
        <div className="prose">
          <p>
            Кожна кнопка спочатку скидає твоє відро до 10 з 10 (POST /demo/ratelimit/reset, лише поза production), тож результат завжди однаковий. Перша кнопка шле 15
            запитів поспіль: 10 пройдуть (201), 5 отримають 429, а Remaining падає з 9 до 0. Друга кнопка показує межу: 10 запитів, пауза 1 с, ще 10. Відро за секунду
            поповнилось на один токен, тому з других десяти пройде 1.
          </p>
          <p>
            Погано, якби 429 приходив раніше 11-го запиту або не приходив узагалі. Фіксоване вікно на межі пропустило б усі 20: це панель нижче.
          </p>
        </div>
        <NeedAuth />
        <div className="row">
          <button type="button" className="primary" onClick={() => void send([15])} disabled={!auth.tokens || running} data-testid="send15">
            {running ? 'надсилаю...' : 'Скинути відро і надіслати 15 x POST /posts'}
          </button>
          <button type="button" onClick={() => void send([10, { pause: 1000 }, 10])} disabled={!auth.tokens || running} data-testid="send-boundary">
            Скинути, 10 запитів, пауза 1 с, ще 10
          </button>
          <button type="button" onClick={() => void send([1], false)} disabled={!auth.tokens || running} data-testid="send1">
            1 x POST /posts без скидання
          </button>
        </div>

        <h3>відро зараз (оцінка з останньої відповіді + 1 токен/с)</h3>
        <div className="slots" data-testid="slots">
          {Array.from({ length: capacity }, (_, i) => (
            <span key={i} className={`slot ${i < estimated ? 'full' : ''}`} />
          ))}
          <span className="mono small" style={{ alignSelf: 'center', marginLeft: 8 }}>
            {estimated} / {capacity}
            {last?.resetAt ? `, повне о ${new Date(last.resetAt * 1000).toLocaleTimeString('uk-UA')}` : ''}
          </span>
        </div>

        {shots.length > 0 && (
          <>
            <BucketChart shots={shots} capacity={capacity} />
            <table className="tbl" data-testid="shots">
              <thead>
                <tr>
                  <th>#</th>
                  <th>t, мс</th>
                  <th>статус</th>
                  <th>X-RateLimit-Limit</th>
                  <th>X-RateLimit-Remaining</th>
                  <th>X-RateLimit-Reset</th>
                  <th>Retry-After</th>
                  <th>мс</th>
                </tr>
              </thead>
              <tbody>
                {shots.map((s) => (
                  <tr key={s.index}>
                    <td className="mono">{s.index}</td>
                    <td className="mono">{s.t}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="mono">{s.limit ?? '-'}</td>
                    <td className="mono">{s.remaining ?? '-'}</td>
                    <td className="mono">{s.resetAt ? new Date(s.resetAt * 1000).toLocaleTimeString('uk-UA') : '-'}</td>
                    <td className="mono">{s.retryAfter ? `${s.retryAfter} с` : '-'}</td>
                    <td className="mono">{s.durationMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <Panel
          exchange={latency.exchange}
          busy={latency.busy}
          headers={['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after', 'x-request-id']}
        />
        <PanelFooter
          paths={[
            'src/modules/ratelimit/token-bucket.service.ts (Lua-скрипт)',
            'src/modules/ratelimit/token-bucket.guard.ts (заголовки і 429)',
            'src/modules/ratelimit/ratelimit-demo.controller.ts (скидання відра для демо)',
          ]}
          tries={[
            <>Запусти API з RATE_LIMIT_CAPACITY=5 і RATE_LIMIT_WINDOW_SECONDS=5 та повтори сплеск: скільки тепер проходить?</>,
            <>Постав RATE_LIMIT_WINDOW_SECONDS=100: поповнення стає 0,1 токена за секунду, і Retry-After на 429 виростає до 10 с.</>,
          ]}
        />
      </Card>

      <Card title="Fixed window: межа вікна пропускає подвійний сплеск">
        <div className="prose">
          <p>
            Той самий ліміт 10 на 10 с, але готовою бібліотекою @nestjs/throttler. Кнопка сама чекає, поки вікно стане свіжим, потім шле 10 запитів у кінці вікна
            і ще 10 одразу після межі. Займає близько 11 с. Погано: усі 20 отримають 200, хоча ліміт 10. Це не баг бібліотеки, так працює фіксоване вікно.
          </p>
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={() => void fixedWindowBoundary()} disabled={fixedBusy} data-testid="fixed-window">
            {fixedBusy ? 'чекаю межу вікна...' : 'Показати межу вікна (GET /demo/throttled)'}
          </button>
          {fixedShots.length > 0 && (
            <span className="pill" data-testid="fixed-result">
              пройшло <b className="mono">{fixedShots.filter((s) => s.status === 200).length}</b> з {fixedShots.length}; від першого запиту кінця вікна до
              останнього нового вікна <b className="mono">{((fixedShots[fixedShots.length - 1].t - (fixedShots.find((s) => s.burst === 'кінець вікна')?.t ?? 0)) / 1000).toFixed(1)} с</b>
            </span>
          )}
        </div>
        {fixedLog.length > 0 && <pre className="mono small">{fixedLog.join('\n')}</pre>}
        {fixedShots.length > 0 && (
          <div className="dots" data-testid="fixed-dots">
            {fixedShots.map((s, i) => (
              <span key={i} className={`dot s${Math.floor(s.status / 100)}`} title={`${s.burst}, t=${s.t} мс`}>
                {s.status}
              </span>
            ))}
          </div>
        )}
        <PanelFooter
          paths={['src/modules/ratelimit/throttler-demo.controller.ts (@Throttle 10 на 10 с)', 'src/modules/ratelimit/ratelimit.module.ts (лічильники в Redis, не в пам\'яті)']}
          tries={[
            <>Зміни ttl у @Throttle на 2000 і повтори: межа вікна стає частішою, а подвійний сплеск лишається.</>,
            <>Прибери storage з ThrottlerModule і підніми два API: кожен рахуватиме свою частину, і ліміт 10 перетвориться на 20.</>,
          ]}
        />
      </Card>
    </>
  );
}

// Токени, що лишились, за часом (x = мс від початку серії). Точки з відповідей, між ними лінія.
function BucketChart({ shots, capacity }: { shots: Shot[]; capacity: number }) {
  const width = 640;
  const height = 130;
  const padL = 30;
  const padB = 20;
  const maxT = Math.max(1000, ...shots.map((s) => s.t));
  const x = (t: number) => padL + (t / maxT) * (width - padL - 8);
  const y = (v: number) => 8 + (1 - v / capacity) * (height - padB - 8);
  const points = shots.filter((s) => s.remaining !== null).map((s) => `${x(s.t)},${y(s.remaining ?? 0)}`);
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" data-testid="bucket-chart">
      <line className="axis" x1={padL} y1={height - padB} x2={width - 8} y2={height - padB} />
      <line className="axis" x1={padL} y1={8} x2={padL} y2={height - padB} />
      <text x={2} y={12}>
        {capacity}
      </text>
      <text x={2} y={height - padB}>
        0
      </text>
      <text x={width - 70} y={height - 4}>
        {maxT} мс
      </text>
      <polyline points={points.join(' ')} fill="none" stroke="var(--bar-work)" strokeWidth={2} />
      {shots.map((s) => (
        <circle key={s.index} cx={x(s.t)} cy={y(s.remaining ?? 0)} r={4} fill={s.status === 429 ? 'var(--err)' : 'var(--ok)'}>
          <title>
            #{s.index}: {s.status}, remaining {s.remaining}
          </title>
        </circle>
      ))}
    </svg>
  );
}
