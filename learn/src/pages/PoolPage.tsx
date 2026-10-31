// Пул з'єднань: n паралельних pg_sleep(seconds) при DB_POOL_MAX=10. Таймлайн показує, що запити 11-20 чекали.
// Під час виконання опитуємо /demo/pool/stats кожні 500 мс і малюємо total/idle/waiting.
import { useRef, useState } from 'react';
import { apiCall } from '../api/client';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { PanelFooter, Topic } from '../components/TopicParts';
import { Card, NeedAuth, PageTitle } from '../components/common';

interface Timing {
  index: number;
  waitedForConnectionMs: number;
  totalMs: number;
}

interface SlowResponse {
  poolMax: number;
  requested: number;
  sleepSeconds: number;
  wallClockMs: number;
  timings: Timing[];
  poolAfter: PoolStats;
}

interface PoolStats {
  max: number;
  total: number;
  idle: number;
  waiting: number;
}

interface Sample {
  t: number;
  stats: PoolStats;
}

export function PoolPage() {
  const latency = useLatency();
  const [seconds, setSeconds] = useState(1);
  const [n, setN] = useState(20);
  const [result, setResult] = useState<SlowResponse | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<number | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setSamples([]);
    const started = performance.now();
    const poll = async () => {
      const res = await apiCall('GET', '/demo/pool/stats', { auth: false });
      if (res.ok) setSamples((prev) => [...prev, { t: Math.round(performance.now() - started), stats: res.body as PoolStats }]);
    };
    void poll();
    pollRef.current = window.setInterval(() => void poll(), 500);
    try {
      const res = await latency.track(apiCall('GET', '/demo/pool/slow', { query: { seconds, n } }));
      if (res.ok) setResult(res.body as SlowResponse);
    } finally {
      if (pollRef.current !== null) clearInterval(pollRef.current);
      pollRef.current = null;
      await poll();
      setRunning(false);
    }
  }

  const maxTotal = result ? Math.max(...result.timings.map((t) => t.totalMs), 1) : 1;
  const waitedCount = result ? result.timings.filter((t) => t.waitedForConnectionMs > 200).length : 0;

  return (
    <>
      <PageTitle title="Пул з'єднань" sub="Чому запити 11-20 чекають і три класичні помилки з пулом" />
      <Topic
        what={
          <>
            Пул це набір уже відкритих дротів до бази, тобто з'єднань. Відкрити нове з'єднання з Postgres дорого: на сервері народжується окремий процес,
            іде автентифікація. Тому застосунок відкриває кілька з'єднань один раз і видає їх запитам по черзі. Запит узяв дріт, зробив справу, повернув.
          </>
        }
        when={
          <>
            Пул потрібен будь-якому веб-застосунку, і він уже є в драйвері. Питання тільки в розмірі. Більший пул не робить базу швидшою: паралелізм обмежений
            ядрами Postgres, а решта лише сперечається за CPU. Не роби пул «про запас».
          </>
        }
        how={
          <>
            DB_POOL_MAX=10 з'єднань на процес, DB_ACQUIRE_TIMEOUT_MS=10000: стільки запит чекає на вільний дріт, потім помилка. Postgres у docker compose має
            max_connections=100, а процесів три (api-1, api-2, worker), тож 3 x 10 = 30 з ста. Демо-ендпоінт запускає n паралельних SELECT pg_sleep і міряє окремо
            очікування з'єднання і загальний час.
          </>
        }
        extra={
          <>
            <pre>{`n=20, пул 10, кожен запит спить 1 с:
запит  1..10: чекав з'єднання ~20 мс,   усього ~1020 мс
запит 11..20: чекав з'єднання ~1020 мс, усього ~2030 мс    <- стояли в черзі, поки перші 10 звільнять дріт`}</pre>
            <p>Три класичні помилки:</p>
            <ol>
              <li>Довга транзакція: BEGIN, 3 секунди обчислень у Node, COMMIT. Дріт зайнятий, хоча Postgres нічого не робить.</li>
              <li>Зовнішній виклик усередині транзакції: BEGIN, fetch у платіжний сервіс на 2 с, COMMIT. Завис сервіс, завис і пул.</li>
              <li>Завеликий пул: max 100 на кожному з 5 процесів дає 500 при max_connections 100. Частина процесів не підключиться взагалі.</li>
            </ol>
          </>
        }
      />

      <Card title="Запустити">
        <NeedAuth>/demo/pool/slow навмисно займає з'єднання пулу на секунди, тому анонімно його не викликати: інакше будь-хто міг би вичерпати пул і покласти /health.</NeedAuth>
        <div className="prose">
          <p>
            Ніяких підготовок: кнопка сама запускає n запитів по seconds секунд одночасно, а кожні 500 мс питає лічильники пулу. «Чекали на з'єднання» це запити, яким
            не дісталось вільного дроту одразу: сіра частина смужки в таймлайні, а waiting у лічильниках показує їх кількість у кожен момент.
          </p>
          <p>
            Добре при n=20 і 1 с: перші 10 без очікування і з total близько 1 с, наступні 10 чекають близько 1 с і мають total близько 2 с. Постав n=10: чекачів
            нуль, пул вистачає. Постав n=50: у черзі стоїть 40, wallClock близько 5 с.
          </p>
        </div>
        <div className="row">
          <label>
            seconds (1..10)
            <input type="number" min={1} max={10} value={seconds} onChange={(e) => setSeconds(Number(e.target.value) || 1)} data-testid="seconds" />
          </label>
          <label>
            n (1..50)
            <input type="number" min={1} max={50} value={n} onChange={(e) => setN(Number(e.target.value) || 20)} data-testid="n" />
          </label>
          <button type="button" className="primary" onClick={() => void run()} disabled={running} data-testid="run">
            {running ? 'виконується...' : 'GET /demo/pool/slow'}
          </button>
          {result && (
            <span className="pill">
              poolMax <b>{result.poolMax}</b>, wallClock <b className="mono">{result.wallClockMs} мс</b>, чекали на з'єднання:{' '}
              <b data-testid="waited-count">{waitedCount}</b> з {result.requested}
            </span>
          )}
        </div>

        {samples.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <h3>pool stats кожні 500 мс (total / idle / waiting)</h3>
            <PoolStatsChart samples={samples} />
            <div className="panel-headers">
              {samples.slice(-6).map((s) => (
                <span key={s.t}>
                  t={s.t}мс: total <b>{s.stats.total}</b> idle <b>{s.stats.idle}</b> waiting <b>{s.stats.waiting}</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div data-testid="timeline">
            <h3>таймлайн запитів: сірий = чекав з'єднання, синій = виконував pg_sleep</h3>
            {result.timings.map((t) => (
              <div className="timeline-row" key={t.index}>
                <span>#{t.index}</span>
                <div className="timeline-bar">
                  <span className="wait" style={{ left: 0, width: `${(t.waitedForConnectionMs / maxTotal) * 100}%` }} />
                  <span
                    className="work"
                    style={{ left: `${(t.waitedForConnectionMs / maxTotal) * 100}%`, width: `${((t.totalMs - t.waitedForConnectionMs) / maxTotal) * 100}%` }}
                  />
                </div>
                <span className="muted">
                  wait {t.waitedForConnectionMs} / total {t.totalMs}
                </span>
              </div>
            ))}
          </div>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelFooter
          paths={['src/modules/pool/pool.controller.ts (/demo/pool/slow тільки з JWT і з межами n <= 30, seconds <= 5; /demo/pool/stats)', 'src/modules/database/data-source-options.ts (max, connectionTimeoutMillis)', 'src/modules/config/config.schema.ts (DB_POOL_MAX, DB_ACQUIRE_TIMEOUT_MS)']}
          tries={[
            <>
              Запусти API з DB_POOL_MAX=20 і повтори n=20: таймлайн майже без сірого. Потім DB_POOL_MAX=2: скільки тепер займає wallClock?
            </>,
            <>
              Постав DB_ACQUIRE_TIMEOUT_MS=1000, а в формі seconds=3 і n=20: запити 11-20 не дочекаються дроту, і ендпоінт відповість помилкою замість таймлайну.
            </>,
          ]}
        />
      </Card>
    </>
  );
}

// Три лінії на SVG: total, idle, waiting за часом.
function PoolStatsChart({ samples }: { samples: Sample[] }) {
  const width = 640;
  const height = 120;
  const padL = 30;
  const padB = 20;
  const maxT = Math.max(1, ...samples.map((s) => s.t));
  const maxV = Math.max(1, ...samples.map((s) => Math.max(s.stats.total, s.stats.idle, s.stats.waiting)));
  const x = (t: number) => padL + (t / maxT) * (width - padL - 8);
  const y = (v: number) => 8 + (1 - v / maxV) * (height - padB - 8);
  const line = (pick: (s: PoolStats) => number) => samples.map((s) => `${x(s.t)},${y(pick(s.stats))}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
      <line className="axis" x1={padL} y1={height - padB} x2={width - 8} y2={height - padB} />
      <line className="axis" x1={padL} y1={8} x2={padL} y2={height - padB} />
      <text x={2} y={12}>
        {maxV}
      </text>
      <text x={2} y={height - padB}>
        0
      </text>
      <text x={width - 60} y={height - 4}>
        {maxT} мс
      </text>
      <polyline points={line((s) => s.total)} fill="none" stroke="var(--bar-work)" strokeWidth={2} />
      <polyline points={line((s) => s.idle)} fill="none" stroke="var(--ok)" strokeWidth={2} />
      <polyline points={line((s) => s.waiting)} fill="none" stroke="var(--err)" strokeWidth={2} />
      <text x={padL + 6} y={12} fill="var(--bar-work)">
        total
      </text>
      <text x={padL + 50} y={12} fill="var(--ok)">
        idle
      </text>
      <text x={padL + 86} y={12} fill="var(--err)">
        waiting
      </text>
    </svg>
  );
}
