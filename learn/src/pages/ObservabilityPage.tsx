// Метрики, трейси, graceful shutdown: статика за docs/observability.md, docs/tracing.md і docs/modules/shutdown.md
// плюс живий GET /metrics з API, з якого показуємо найцікавіші рядки.
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useBaseUrl } from '../api/baseUrl';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Link } from 'react-router-dom';
import { Card, Explain, NeedAuth, PageTitle } from '../components/common';
import { PanelFooter, Topic } from '../components/TopicParts';

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
    // http_requests_total має багато серій: показуємо до 6 з найбільшими значеннями, решту метрик по 1-3 рядки.
    const limit = name === 'http_requests_total' ? 6 : name === 'bullmq_queue_jobs' ? 3 : name === 'http_request_duration_seconds_count' ? 2 : 1;
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


interface SlowResponse {
  poolMax: number;
  requested: number;
  sleepSeconds: number;
  wallClockMs: number;
  timings: Array<{ index: number; waitedForConnectionMs: number; totalMs: number }>;
}

function sumRequests(lines: MetricLine[]): number {
  return lines.filter((l) => l.name === 'http_requests_total').reduce((acc, l) => acc + Number(l.value), 0);
}

export function ObservabilityPage() {
  // Порти можуть відрізнятись від типових, якщо npm run up узяв наступний вільний: тоді вони приходять зі збірки.
  const grafanaUrl = (import.meta.env.VITE_GRAFANA_URL as string | undefined) ?? 'http://localhost:3001';
  const jaegerUrl = (import.meta.env.VITE_JAEGER_URL as string | undefined) ?? 'http://localhost:16686';

  return (
    <>
      <PageTitle title="Метрики, трейси, graceful shutdown" sub="Що не так (метрики), де саме (трейс), що точно (логи), і як вимкнутись, нічого не загубивши" />

      <Explain>
        <p>
          <b>Що це.</b> Три інструменти, які відповідають на три різні питання. Логи розповідають про один запит. Метрики описують усі запити разом одним числом.
          Трейс показує, куди пішов час усередині одного запиту.
        </p>
        <p>
          <b>Коли це потрібно і коли ні.</b> Не всі три потрібні щодня. Обирай за питанням:
        </p>
        <ul>
          <li>
            <b>Grafana</b>, коли питання "скільки і як швидко": запити за секунду, p95, відсоток помилок, пул, черга. Дивись після деплою, під навантаженням і коли
            кажуть "щось повільно".
          </li>
          <li>
            <b>Jaeger</b>, коли вже знаєш, який ендпоінт повільний, і треба побачити, на якому кроці всередині (SQL, Redis, воркер) пішов час.
          </li>
          <li>
            <b>Логи</b>, коли треба текст помилки або історія одного запиту за requestId.
          </li>
          <li>Порядок майже завжди один: Grafana каже ЩО не так, Jaeger ДЕ, логи ЩО САМЕ.</li>
        </ul>
        <p>
          <b>Як тут зроблено.</b> Кожен запит лишає слід у всіх трьох місцях.
        </p>
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
                  {grafanaUrl.replace('http://localhost', '')}
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
                  {jaegerUrl.replace('http://localhost', '')}
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
      </Explain>

      <h2>Метрики</h2>
      <MetricsBlock />

      <h2>Розслідування на живому прикладі</h2>
      <InvestigationBlock grafanaUrl={grafanaUrl} jaegerUrl={jaegerUrl} />

      <h2>Трейси</h2>
      <Topic
        what="Трейс це дерево кроків одного запиту з часом кожного. Крок називається span: SQL-запит, команда Redis, виконання job-а у воркері."
        when="Потрібен, коли знаєш, що ендпоінт повільний, але не знаєш чому. Для запитання «скільки» він марний: це до метрик. Тексту помилки не покаже: це до логів."
        how={
          <>
            Перед <code>queue.add</code> сервіс кладе у дані job-у заголовок <code>traceparent</code> (W3C Trace Context). Воркер читає його і відкриває span як
            дочірній до запиту. Тому трейс переходить з API у воркер, хоч це інший процес. Span-и їдуть у Jaeger пачками кожні 5 с, тож трейс з’являється із
            затримкою.
          </>
        }
      />
      <Card title="Один POST /reports через два процеси">
        <pre className="code">{`POST /reports                       26 мс   (api-1)
  evalsha                            4 мс   getWaitingCount у Redis
  pg.query:INSERT                    2 мс   рядок у reports
  reports.generate                1052 мс   (worker, інший процес, той самий traceId)
    report.step 1                  201 мс
    report.step 2                  201 мс
    ...`}</pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          Числа з реального трейсу при REPORT_STEP_MS=200. У Jaeger: Service api-1, Operation POST /reports, Find Traces.
        </div>
        <PanelFooter
          paths={['src/tracing.ts (NodeSDK, перший import у main.ts і worker.ts)', 'src/modules/jobs/reports.service.ts (traceparent у job)', 'src/modules/jobs/reports.processor.ts (span у воркері)']}
          tries={[
            <>
              Залогінься на <Link to="/start">Старті</Link>, запусти звіт на сторінці <Link to="/queue">Черга</Link> і за 10 с знайди його в Jaeger: у трейсі мають
              бути і api-1, і worker.
            </>,
          ]}
        />
      </Card>

      <h2>Graceful shutdown</h2>
      <Topic
        what="Коли процес отримує SIGTERM (деплой, перезапуск), він не вмирає одразу, а завершує розпочате і закриває з’єднання."
        when="Потрібен скрізь, де є довгі запити або job-и і де деплої відбуваються без простою. Для скрипта, який виконується і виходить, це зайве."
        how={
          <>
            <code>app.enableShutdownHooks()</code> запускає ланцюжок закриття модулів. Воркер чекає завершення поточного job-у і нових не бере. У compose для
            воркера <code>stop_grace_period: 30s</code>: стільки compose чекає перед SIGKILL.
          </>
        }
      />
      <Card title="SIGTERM по кроках">
        <pre className="code">{SHUTDOWN_DIAGRAM}</pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          Без цього при деплої частина запитів отримає connection reset, а job, що виконувався, лишиться в active, поки BullMQ не поверне його в чергу після
          stalledInterval. Перевірено: SIGTERM на 2-й секунді 5-секундного звіту, воркер вийшов через 3.6 с, звіт у БД completed.
        </div>
        <PanelFooter
          paths={['src/app-setup.ts, src/worker.ts (enableShutdownHooks)', 'src/modules/jobs/events.processor.ts (onModuleDestroy: collector.drain)', 'docker-compose.yml (stop_grace_period: 30s у worker)']}
          tries={['Запусти звіт, а на 2-й секунді зроби docker compose stop worker: звіт має дійти до completed, а не зависнути в active.']}
        />
      </Card>
    </>
  );
}

function MetricsBlock() {
  const base = useBaseUrl();
  const latency = useLatency();
  const [lines, setLines] = useState<Array<MetricLine & { why: string }> | null>(null);
  const [total, setTotal] = useState(0);
  const [requestsBefore, setRequestsBefore] = useState<number | null>(null);
  const [requestsNow, setRequestsNow] = useState<number | null>(null);

  async function loadMetrics() {
    const res = await latency.track(apiCall('GET', '/metrics', { auth: false }));
    if (!res.ok || typeof res.body !== 'string') {
      setLines(null);
      setTotal(0);
      return null;
    }
    const parsed = parseMetrics(res.body);
    setTotal(parsed.length);
    setLines(pickInteresting(parsed));
    return sumRequests(parsed);
  }

  // Свій трафік: 20 запитів на список постів і 3 на неіснуючий маршрут, щоб було видно, як росте лічильник.
  async function generateTraffic() {
    const first = await loadMetrics();
    if (first === null) return;
    await Promise.all([
      ...Array.from({ length: 20 }, () => apiCall('GET', '/posts', { query: { pageSize: 5 }, auth: false })),
      ...Array.from({ length: 3 }, () => apiCall('GET', '/nope-demo', { auth: false })),
    ]);
    const second = await loadMetrics();
    setRequestsBefore(first);
    setRequestsNow(second);
  }

  return (
    <>
      <Topic
        what="Числа, які процес віддає текстом на GET /metrics. Prometheus сам приходить раз на 5 с, запам’ятовує їх з часом, а Grafana малює графіки."
        when={
          <>
            Потрібні, щоб бачити всі запити разом: швидкість, помилки, пул, чергу. Лічильник сам по собі нічого не каже, цікава швидкість його росту. Gauge корисний,
            коли його значення має бути нулем (pg_pool_waiting) або не рости годинами (пам’ять). Не замінюють логи: який саме запит упав, з метрик не видно.
          </>
        }
        how={
          <>
            Label <code>route</code> це шаблон (<code>/posts/:id</code>), а не сирий URL, інакше кожен id створив би окрему серію. Неіснуючі маршрути йдуть в
            <code> unmatched</code>. <code>/metrics</code> і <code>/health</code> не рахуються: їх смикають Prometheus і healthcheck, а не користувачі. Два
            API і воркер мають кожен свій набір чисел.
          </>
        }
      />
      <Card title="GET /metrics: живі числа з API">
        <div className="prose">
          <p>
            Кнопка "Згенерувати трафік" читає метрики, робить 20 запитів GET /posts і 3 на неіснуючий маршрут, читає знову. Дивись, на скільки виріс лічильник і де
            з’явився route="unmatched". Нормальні значення: pg_pool_waiting 0, nodejs_eventloop_lag_seconds близько нуля, пам’ять не росте годинами.
          </p>
        </div>
        <div className="row">
          <button type="button" className="primary" data-testid="metrics-load" disabled={latency.busy} onClick={() => void loadMetrics()}>
            {lines ? 'Оновити' : 'GET /metrics'}
          </button>
          <button type="button" data-testid="metrics-traffic" disabled={latency.busy} onClick={() => void generateTraffic()}>
            Згенерувати трафік
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
        {requestsBefore !== null && requestsNow !== null && (
          <div className="note ok" data-testid="metrics-delta">
            Сума http_requests_total: було {requestsBefore}, стало {requestsNow} (+{requestsNow - requestsBefore}). {requestsNow - requestsBefore === 23
              ? 'Рівно наші 23 запити: /metrics і /health не рахуються.'
              : 'Ми зробили 23 запити, решта це чужий трафік.'}
          </div>
        )}
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
            своєму порту (:3000); за nginx (:8080) він теж є, але щоразу від іншого інстансу (api-1 або api-2), тому числа можуть стрибати.
          </div>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelFooter
          paths={['src/modules/metrics/metrics.service.ts (усі метрики)', 'src/modules/metrics/metrics.middleware.ts (підрахунок HTTP)', 'observability/prometheus.yml, observability/grafana/']}
          tries={[
            'Натисни "Згенерувати трафік" двічі поспіль: лічильник росте на ту саму величину, а gauge pg_pool_waiting лишається 0.',
            'Відкрий дашборд devhub у Grafana (профіль observability) і знайди ті самі 23 запити на графіку "Запитів за секунду".',
          ]}
        />
      </Card>
    </>
  );
}

function InvestigationBlock({ grafanaUrl, jaegerUrl }: { grafanaUrl: string; jaegerUrl: string }) {
  const latency = useLatency();
  const [slow, setSlow] = useState<SlowResponse | null>(null);

  async function makeSlow() {
    setSlow(null);
    const res = await latency.track(apiCall('GET', '/demo/pool/slow', { query: { seconds: 2, n: 20 } }));
    if (res.ok) setSlow(res.body as SlowResponse);
  }

  const waited = slow ? slow.timings.filter((t) => t.waitedForConnectionMs > 500).length : 0;
  const maxWait = slow ? Math.max(...slow.timings.map((t) => t.waitedForConnectionMs)) : 0;

  return (
    <>
      <Topic
        what="Скарга: «GET /demo/pool/slow повільний». Приклад, як пройти всі три інструменти по черзі з ендпоінтами цього проєкту."
        when="Такий порядок працює для будь-якої скарги «повільно». Якщо починати з логів або трейсу, не знатимеш, чи це один випадок, чи так у всіх."
        how={
          <>
            Ендпоінт запускає 20 паралельних <code>pg_sleep(2)</code> при пулі з 10 з’єднань (DB_POOL_MAX). Перші 10 беруть з’єднання одразу, наступні 10 чекають 2 с,
            поки звільниться місце. Разом виходить близько 4 с замість 2.
          </>
        }
      />
      <Card title="Скарга: запит триває 4 секунди замість двох">
        <NeedAuth />
        <div className="row">
          <button type="button" className="primary" onClick={() => void makeSlow()} disabled={latency.busy} data-testid="slow-run">
            {latency.busy ? 'чекаю ~4 с...' : 'GET /demo/pool/slow?seconds=2&n=20'}
          </button>
        </div>
        {slow && (
          <div className="cols-3" style={{ marginBottom: 12 }} data-testid="slow-result">
            <div className="col">
              <h3>wallClockMs</h3>
              <div className="big">{slow.wallClockMs}</div>
              <div className="muted small">очікувано 2000, якби пул не був малим</div>
            </div>
            <div className="col">
              <h3>чекали на з’єднання</h3>
              <div className="big">
                {waited} з {slow.requested}
              </div>
              <div className="muted small">понад 0.5 с у черзі пулу</div>
            </div>
            <div className="col">
              <h3>найдовше чекання</h3>
              <div className="big">{maxWait} мс</div>
              <div className="muted small">poolMax = {slow.poolMax}</div>
            </div>
          </div>
        )}
        <ol>
          <li>
            <b>Grafana</b> (
            <a href={grafanaUrl} target="_blank" rel="noreferrer">
              дашборд devhub
            </a>
            ): на панелі "p95 по маршрутах" маршрут /demo/pool/slow піднявся до ~4 с, а на "Пул Postgres" лінія waiting піднялась до 10. Висновок: щось чекає на
            з’єднання. Де саме, метрики не скажуть.
          </li>
          <li>
            <b>Jaeger</b> (
            <a href={jaegerUrl} target="_blank" rel="noreferrer">
              Service api-1
            </a>
            , Operation GET /demo/pool/slow): 20 запитів у базу, 10 стартують одразу, 10 лише через ~2 с, перед ними крок pg-pool.connect. Висновок: час іде не в
            SQL, а в черзі за з’єднанням.
          </li>
          <li>
            <b>Логи</b>: requestId береш із заголовка X-Request-Id відповіді (він у панелі нижче). Далі <code>docker compose logs api-1</code> з grep по цьому id, або
            панель "Логи api-1" у Grafana. Подробиці на сторінці <Link to="/logging">Логи, request-id і health</Link>.
          </li>
        </ol>
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelFooter
          paths={['src/modules/pool/pool.controller.ts (/demo/pool/slow)', 'observability/grafana/dashboards/devhub.json (панелі)', 'docs/tracing.md (Jaeger за 30 секунд)']}
          tries={[
            <>
              Натисни кнопку і за 10 с знайди цей трейс у Jaeger. Потім відкрий сторінку <Link to="/pool">Пул з’єднань</Link> і дай n=10: час зрівняється з 2 с.
            </>,
          ]}
        />
      </Card>
    </>
  );
}
