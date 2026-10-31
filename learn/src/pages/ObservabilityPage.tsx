// Метрики, трейси, graceful shutdown: статика за docs/observability.md, docs/tracing.md і docs/modules/shutdown.md
// плюс живий GET /metrics з API, з якого показуємо найцікавіші рядки.
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useBaseUrl } from '../api/baseUrl';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, Explain, PageTitle, WhereInCode } from '../components/common';

interface MetricLine {
  name: string;
  labels: string;
  value: string;
}

// Які метрики показати і в якому порядку. Решта (process_*, nodejs_*, bucket-и гістограми) лишається у повному тексті в панелі.
const WANTED: Array<[string, string]> = [
  ['http_requests_total', 'counter: скільки запитів, по методу, маршруту і статусу; цікава не величина, а швидкість росту (rate за 1 хв)'],
  ['http_requests_in_flight', 'gauge: скільки запитів обробляється прямо зараз'],
  ['http_request_duration_seconds_count', 'histogram: з count і sum Grafana рахує середнє, з bucket-ів p50 і p95'],
  ['pg_pool_total', "gauge: скільки з'єднань з Postgres відкрито (ті самі числа, що у GET /demo/pool/stats)"],
  ['pg_pool_idle', "gauge: скільки з'єднань вільні"],
  ['pg_pool_waiting', "gauge: скільки запитів чекають на вільне з'єднання; має бути 0"],
  ['bullmq_queue_jobs', 'gauge: job-и в черзі по стану (waiting, active, completed, failed, delayed), раз на 5 с з Redis'],
  ['process_resident_memory_bytes', "gauge: пам'ять процесу; росте годинами і не падає = витік"],
  ['nodejs_eventloop_lag_seconds', 'gauge: затримка event loop; велика = щось синхронне блокує процес'],
];

function parseMetrics(text: string): MetricLine[] {
  const out: MetricLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)/.exec(line);
    if (!match) continue;
    out.push({ name: match[1], labels: match[2] ?? '', value: match[3] });
  }
  return out;
}

function pickInteresting(lines: MetricLine[]): Array<MetricLine & { why: string }> {
  const picked: Array<MetricLine & { why: string }> = [];
  for (const [name, why] of WANTED) {
    const matching = lines.filter((l) => l.name === name);
    // http_requests_total має багато серій: показуємо до 4 з найбільшими значеннями, решту метрик по 1-3 рядки.
    const limit = name === 'http_requests_total' ? 4 : name === 'bullmq_queue_jobs' ? 3 : name === 'http_request_duration_seconds_count' ? 2 : 1;
    matching
      .sort((a, b) => Number(b.value) - Number(a.value))
      .slice(0, limit)
      .forEach((l) => picked.push({ ...l, why }));
  }
  return picked;
}

const SHUTDOWN_DIAGRAM = `SIGTERM
  |
  v
API: HTTP-сервер перестає приймати нові з'єднання (app.close)
  |   відкриті запити дороблюються
  v
модулі: onModuleDestroy / onApplicationShutdown
  |   LiveGateway: відписка від подій, зупинка heartbeat
  |   ReportEventsService: quit підписника Redis
  |   TypeORM: закриття пулу з'єднань
  |   RedisModule: quit клієнта
  v
exit

Воркер: спершу worker.close() від @nestjs/bullmq, який чекає завершення поточного job-у і не бере нових.`;

const CODE_PLACES: Array<[string, string]> = [
  [
    'src/modules/metrics/metrics.service.ts, metrics.middleware.ts, metrics.controller.ts',
    'усі метрики, підрахунок HTTP, GET /metrics у API; у воркері окремий сервер на METRICS_PORT',
  ],
  ['observability/prometheus.yml, observability/grafana/', 'Prometheus раз на 5 с читає api-1, api-2, worker; дашборд devhub'],
  [
    'src/tracing.ts',
    'перший import у main.ts і worker.ts: NodeSDK з авто-інструментаціями http, express, pg, ioredis; без OTEL_EXPORTER_OTLP_ENDPOINT нічого не робить',
  ],
  [
    'src/modules/jobs/reports.service.ts, reports.processor.ts',
    'traceparent кладеться у дані job-у і читається у воркері: трейс перестрибує з API у воркер через Redis',
  ],
  ['src/app-setup.ts, src/worker.ts', 'app.enableShutdownHooks(): SIGTERM запускає ланцюжок закриття'],
  ['src/modules/jobs/events.processor.ts', 'onModuleDestroy робить collector.drain(), щоб недописана пачка подій потрапила в БД'],
  ['docker-compose.yml', 'stop_grace_period: 30s у worker: скільки compose чекає перед SIGKILL'],
];

export function ObservabilityPage() {
  const base = useBaseUrl();
  const latency = useLatency();
  const [lines, setLines] = useState<Array<MetricLine & { why: string }> | null>(null);
  const [total, setTotal] = useState(0);

  async function loadMetrics() {
    const res = await latency.track(apiCall('GET', '/metrics', { auth: false }));
    if (!res.ok || typeof res.body !== 'string') {
      setLines(null);
      setTotal(0);
      return;
    }
    const parsed = parseMetrics(res.body);
    setTotal(parsed.length);
    setLines(pickInteresting(parsed));
  }

  const grafanaUrl = 'http://localhost:3001';
  const jaegerUrl = 'http://localhost:16686';

  return (
    <>
      <PageTitle title="Метрики, трейси, graceful shutdown" sub="Що не так (метрики), де саме (трейс), і як вимкнутись, нічого не загубивши" />
      <Explain>
        <p>
          <b>Три інструменти, три питання.</b> Логи відповідають "що сталося з одним конкретним запитом" (сторінка "Логи, request-id і health"). <b>Метрики</b>{' '}
          відповідають "скільки, як швидко, скільки помилок за хвилину": не один запит, а всі разом одним числом.
        </p>
        <p>
          <b>Трейси</b> відповідають "де саме всередині одного запиту витрачено час": SQL, Redis, очікування пулу, воркер.
        </p>
        <p>Порядок завжди той самий: дашборд (ЩО не так), потім Jaeger (ДЕ всередині запиту), потім логи за requestId (ЧОМУ).</p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Інструмент</th>
              <th>Де в devhub</th>
              <th>Де дивитись</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Метрики</td>
              <td className="mono">prom-client, GET /metrics у API і воркері</td>
              <td>
                Prometheus :9090, Grafana{' '}
                <a href={grafanaUrl} target="_blank" rel="noreferrer">
                  :3001
                </a>{' '}
                (дашборд devhub)
              </td>
            </tr>
            <tr>
              <td>Трейси</td>
              <td className="mono">OpenTelemetry, src/tracing.ts, traceparent у job-і</td>
              <td>
                Jaeger{' '}
                <a href={jaegerUrl} target="_blank" rel="noreferrer">
                  :16686
                </a>
              </td>
            </tr>
            <tr>
              <td>Логи</td>
              <td className="mono">AppLogger, JSON з requestId</td>
              <td>Loki через Grafana, або docker compose logs</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">
          Grafana, Prometheus і Loki є тільки з профілем observability: <code>npm run up -- --observability</code>. Jaeger піднімається у звичайному{' '}
          <code>docker compose up</code>; без Docker його немає, і трейсинг нічого не робить.
        </p>
        <WhereInCode paths={['src/modules/metrics/metrics.service.ts', 'metrics.middleware.ts', 'src/tracing.ts', 'logging/app-logger.ts']} />
      </Explain>

      <Card title="GET /metrics: живі числа з API">
        <div className="prose">
          <p>
            Сирий текст у форматі Prometheus, з якого таблиця нижче витягує знайомі метрики. Які числа важливі: pg_pool_waiting має бути 0 (інакше пул замалий
            або транзакції довгі), nodejs_eventloop_lag_seconds близько нуля, process_resident_memory_bytes не росте годинами.
          </p>
          <p>Лічильники самі по собі нічого не кажуть: http_requests_total цікавий швидкістю росту. Зроби кілька запитів на інших сторінках і натисни "Оновити".</p>
        </div>
        <div className="row">
          <button type="button" className="primary" data-testid="metrics-load" disabled={latency.busy} onClick={() => void loadMetrics()}>
            {lines ? 'Оновити' : 'GET /metrics'}
          </button>
          <span className="muted small">
            адреса <span className="mono">{base.url}/metrics</span>
            {total > 0 && (
              <>
                , усього рядків зі значеннями: <b data-testid="metrics-total">{total}</b>
              </>
            )}
          </span>
        </div>
        {lines && lines.length > 0 && (
          <table className="tbl metrics-table" data-testid="metrics-table">
            <thead>
              <tr>
                <th>метрика</th>
                <th>значення</th>
                <th>що це</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="mono">
                    {l.name}
                    <span className="muted">{l.labels}</span>
                  </td>
                  <td className="mono">{l.value}</td>
                  <td className="muted small">{l.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {lines && lines.length === 0 && <div className="note">Відповідь прийшла, але знайомих метрик у ній немає. Повний текст у панелі нижче.</div>}
        {latency.exchange && !latency.exchange.ok && (
          <div className="note err">
            /metrics недоступний: {latency.exchange.networkError ?? `${latency.exchange.status} ${latency.exchange.statusText}`}. Без Docker API віддає його на
            своєму порту (:3000); за nginx (:8080) теж проксіюється, але щоразу від іншого інстансу (api-1 або api-2), тому числа можуть стрибати. Зроби кілька
            запитів на інших сторінках і натисни "Оновити": лічильники зміняться.
          </div>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
      </Card>

      <div className="card-grid">
        <Card title="Трейси: один запит через два процеси">
          <pre className="code">{`POST /reports                       26 мс   (api-1)
  evalsha                            4 мс   getWaitingCount у Redis
  pg.query:INSERT                    2 мс   рядок у reports
  reports.generate                1052 мс   (worker, інший процес, той самий traceId)
    report.step 1                  201 мс
    report.step 2                  201 мс
    ...`}</pre>
          <div className="muted small" style={{ marginTop: 8 }}>
            Перед <code>queue.add</code> сервіс кладе у дані job-у <code>traceparent</code> (W3C Trace Context). Воркер читає його і відкриває span як дочірній
            до span-у запиту. У Jaeger: Service api-1, Operation POST /reports, Find Traces. Span-и їдуть пачками кожні 5 с, тому трейс з'являється з затримкою.
          </div>
        </Card>

        <Card title="Graceful shutdown: SIGTERM по кроках">
          <pre className="code">
            {SHUTDOWN_DIAGRAM}
          </pre>
          <div className="muted small" style={{ marginTop: 8 }}>
            Без цього при деплої половина запитів отримає connection reset, а job, що виконувався, лишиться в active, поки BullMQ не поверне його в чергу після
            stalledInterval. Перевірено: SIGTERM на 2-й секунді 5-секундного звіту, воркер вийшов через 3.6 с, звіт у БД completed.
          </div>
        </Card>
      </div>

      <Card title="Де в коді">
        <table className="tbl">
          <tbody>
            {CODE_PLACES.map(([file, what]) => (
              <tr key={file}>
                <td className="mono">{file}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
