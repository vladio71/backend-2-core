// Rate limit: 15 x POST /posts підряд, таблиця статусів і X-RateLimit-* заголовків, візуалізація відра.
import { useEffect, useState } from 'react';
import { apiCall, ApiExchange } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, StatusBadge } from '../components/Panel';
import { Card, Explain, NeedAuth, PageTitle } from '../components/common';

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
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  async function send(count: number) {
    setRunning(true);
    const started = performance.now();
    const list: Shot[] = [];
    try {
      for (let i = 1; i <= count; i++) {
        const res = await latency.track(
          apiCall('POST', '/posts', { body: { title: `rate-limit demo ${i}`, body: `Пост ${i} зі сторінки Rate limit`, tags: ['demo'] } }),
        );
        list.push(toShot(i, Math.round(performance.now() - started), res));
        setShots([...list]);
      }
    } finally {
      setRunning(false);
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
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> Для кожного користувача (або IP для анонімних) у Redis лежить відро: ємність 10 токенів, поповнення 1 токен/с.
          Lua-скрипт атомарно рахує, скільки токенів натекло з минулого разу, і забирає один. Якщо токенів немає, 429 з <code>Retry-After</code>. Заголовки{' '}
          <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Reset</code> (unix-час, коли відро знову повне) є на кожній
          відповіді.
        </p>
        <pre>{`Token bucket (ємність 10, +1 токен/с):            Fixed window (10 за вікно 10 с):

токени   10 |*                                     лічильник 10 |         *
            |  *                 *                              |        * *
          5 |    *   *   *  *                                 5 |       *   *
            |      * * * *  *   *                               |      *     *
          0 +------------------------> час                    0 +--*-*-------*--> час
            0   2   4   6   8  10  12                             0  2  4  6  8 10 12
         сплеск з 10 запитів у t=0 проходить,            10 запитів у t=9.9 і ще 10 у t=10.1
         далі рівно 1 запит/с; відмова лише              проходять усі (20 за 0.2 с), бо вікно
         коли відро порожнє                              скинулось на межі`}</pre>
        <p>
          Чому Lua, а не три команди з Node: "прочитати, порахувати, записати" дає гонку між двома одночасними запитами; скрипт виконується в Redis як одна
          операція. Чому Redis, а не пам'ять процесу: два інстанси API за nginx мають спільний лічильник. Для порівняння <code>GET /demo/throttled</code>{' '}
          обмежений готовим <code>@nestjs/throttler</code> (fixed window), його видно на сторінці Помилки.
        </p>
      </Explain>

      <Card title="Надіслати сплеск">
        <NeedAuth />
        <div className="row">
          <button type="button" className="primary" onClick={() => void send(15)} disabled={!auth.tokens || running} data-testid="send15">
            {running ? 'надсилаю...' : 'Надіслати 15 x POST /posts'}
          </button>
          <button type="button" onClick={() => void send(1)} disabled={!auth.tokens || running} data-testid="send1">
            1 x POST /posts (перевірити, чи натекло)
          </button>
          <button type="button" onClick={() => setShots([])} disabled={shots.length === 0}>
            Очистити
          </button>
        </div>

        <h3>відро зараз (оцінка з останньої відповіді + 1 токен/с)</h3>
        <div className="slots" data-testid="slots">
          {Array.from({ length: capacity }, (_, i) => (
            <span key={i} className={`slot ${i < estimated ? 'full' : ''}`} />
          ))}
          <span className="mono small" style={{ alignSelf: 'center', marginLeft: 8 }}>
            {estimated} / {capacity}
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
