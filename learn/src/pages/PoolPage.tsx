// Пул з'єднань: n паралельних pg_sleep(seconds) при DB_POOL_MAX=10. Таймлайн показує, що запити 11-20 чекали.
// Під час виконання опитуємо /demo/pool/stats кожні 500 мс і малюємо total/idle/waiting.
import { useRef, useState } from 'react';
import { apiCall } from '../api/client';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, Explain, PageTitle, WhereInCode } from '../components/common';

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
      const res = await latency.track(apiCall('GET', '/demo/pool/slow', { query: { seconds, n }, auth: false }));
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
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> Postgres створює процес на кожне з'єднання, тому їх мало (max_connections типово 100). Пул у застосунку тримає
          DB_POOL_MAX=10 з'єднань відкритими і видає їх запитам по черзі.
        </p>
        <p>
          Коли всі зайняті, новий запит чекає DB_ACQUIRE_TIMEOUT_MS, потім помилка. Демо-ендпоінт запускає n паралельних <code>SELECT pg_sleep(seconds)</code>{' '}
          і міряє окремо очікування з'єднання і загальний час.
        </p>
        <pre>{`запит  1..10: waitedForConnection ~20 мс,   total ~1020 мс
запит 11..20: waitedForConnection ~1020 мс, total ~2030 мс    <- чекали, поки перші 10 звільнять з'єднання`}</pre>
        <p>Три класичні помилки:</p>
        <ol>
          <li>Довга транзакція: BEGIN, 3 секунди обчислень у Node, COMMIT. З'єднання зайняте, хоча Postgres нічого не робить.</li>
          <li>Зовнішній HTTP-виклик всередині транзакції: BEGIN, fetch у Stripe на 2 с, COMMIT. Якщо Stripe завис, завис і пул.</li>
          <li>Пул завеликий: max 100 на кожному з 5 процесів = 500 &gt; max_connections. Більший пул не дає більше паралелізму, ніж є ядер у Postgres.</li>
        </ol>
        <WhereInCode paths={['src/modules/pool/pool.controller.ts (/demo/pool/slow)', 'database/data-source-options.ts (DB_POOL_MAX, DB_ACQUIRE_TIMEOUT_MS)']} />
      </Explain>

      <Card title="Запустити">
        <div className="prose">
          <p>
            Пул має 10 з'єднань, а ми запускаємо n запитів по seconds секунд одночасно. "Чекали на з'єднання" це запити, яким не дісталось вільного з'єднання
            одразу: сіра частина смужки в таймлайні, а waiting у pool stats показує їх кількість у кожен момент.
          </p>
          <p>
            При n=20 і 1 секунді добре виглядає так: перші 10 без очікування і total близько 1 с, наступні 10 чекають близько 1 с і мають total близько 2 с.
            Якщо n більше за пул у кілька разів, останні запити можуть не дочекатись і впасти по DB_ACQUIRE_TIMEOUT_MS.
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
