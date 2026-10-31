// Черга і воркер: POST /reports (202), три способи стежити за одним job-ом (polling, SSE, WebSocket),
// стан черги, flood до QUEUE_FULL і 300 подій для демонстрації батчингу.
import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { apiCall, ApiExchange } from '../api/client';
import { getAccessToken, useAuth } from '../api/auth';
import { getBaseUrl } from '../api/baseUrl';
import { connectLive } from '../api/live';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { PanelFooter, Topic } from '../components/TopicParts';
import { Card, Explain, NeedAuth, PageTitle, Progress } from '../components/common';

interface ReportEvent {
  reportId: string;
  status: 'queued' | 'active' | 'completed' | 'failed';
  progress: number;
  attempt?: number;
  attempts?: number;
  result?: Record<string, unknown>;
  error?: string;
}

interface Follower {
  status: string;
  progress: number;
  attempt: number;
  requests: number;
  messages: number;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  maxWaiting: number;
}

const FLOOD_WAVE = 10;

const EMPTY: Follower = { status: 'очікую', progress: 0, attempt: 0, requests: 0, messages: 0, error: null, startedAt: 0, finishedAt: null };

function isFinal(status: string): boolean {
  return status === 'completed' || status === 'failed';
}

export function QueuePage() {
  const auth = useAuth();
  const latency = useLatency();
  const [failRate, setFailRate] = useState(0);
  const [reportId, setReportId] = useState<string | null>(null);
  const [poll, setPoll] = useState<Follower>(EMPTY);
  const [sse, setSse] = useState<Follower>(EMPTY);
  const [ws, setWs] = useState<Follower>(EMPTY);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [floodN, setFloodN] = useState(120);
  const [flood, setFlood] = useState<ApiExchange[] | null>(null);
  const [events, setEvents] = useState<{ count: number; ok: number; ms: number } | null>(null);
  const [eventsBusy, setEventsBusy] = useState(false);
  const [floodBusy, setFloodBusy] = useState(false);
  const [workerHint, setWorkerHint] = useState(false);
  const [drained, setDrained] = useState<{ removed: number; waitingAfter: number | null } | null>(null);
  const [peakWaiting, setPeakWaiting] = useState<number | null>(null);
  const pollStatusRef = useRef('очікую');
  const cleanupRef = useRef<Array<() => void>>([]);

  // Стан черги: GET /reports/queue-stats щосекунди, поки сторінка відкрита.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const res = await apiCall('GET', '/reports/queue-stats', { auth: false });
      if (alive && res.ok) setStats(res.body as QueueStats);
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => () => stopFollowers(), []);
  pollStatusRef.current = poll.status;

  function stopFollowers() {
    for (const fn of cleanupRef.current) fn();
    cleanupRef.current = [];
  }

  async function start() {
    stopFollowers();
    setPoll(EMPTY);
    setSse(EMPTY);
    setWs(EMPTY);
    setWorkerHint(false);
    // Свій стан готуємо самі: прибираємо свої job-и, що застрягли в черзі (наприклад, після flood), інакше звіт стояв би за ними.
    await apiCall('POST', '/reports/demo/drain');
    // WebSocket підключаємо ДО створення звіту, щоб не пропустити перші події.
    const socket = await connectLive();
    const res = await latency.track(apiCall('POST', '/reports', { body: failRate > 0 ? { failRate } : {} }));
    if (res.status !== 202) {
      socket.disconnect();
      return;
    }
    const id = (res.body as { id: string }).id;
    setReportId(id);
    window.setTimeout(() => {
      if (pollStatusRef.current === 'queued') setWorkerHint(true);
    }, 4000);
    const t0 = Date.now();
    setPoll({ ...EMPTY, startedAt: t0, status: 'queued' });
    setSse({ ...EMPTY, startedAt: t0, status: 'queued' });
    setWs({ ...EMPTY, startedAt: t0, status: 'queued' });
    followByPolling(id);
    followBySse(id);
    followByWs(socket, id);
  }

  function apply(setter: (fn: (prev: Follower) => Follower) => void, event: ReportEvent, extra: Partial<Follower>) {
    setter((prev) => ({
      ...prev,
      ...extra,
      status: event.status,
      progress: event.progress,
      attempt: event.attempt ?? event.attempts ?? prev.attempt,
      error: event.error ?? null,
      finishedAt: isFinal(event.status) ? Date.now() : prev.finishedAt,
    }));
  }

  function followByPolling(id: string) {
    let requests = 0;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      requests += 1;
      const res = await apiCall('GET', `/reports/${id}`);
      if (stopped) return;
      if (res.ok) {
        const body = res.body as ReportEvent;
        apply(setPoll, body, { requests });
        if (isFinal(body.status)) stop();
      } else {
        setPoll((prev) => ({ ...prev, requests, error: `HTTP ${res.status}` }));
        stop();
      }
    };
    const interval = setInterval(() => void tick(), 1000);
    const stop = () => {
      stopped = true;
      clearInterval(interval);
    };
    void tick();
    cleanupRef.current.push(stop);
  }

  function followBySse(id: string) {
    // EventSource не вміє ставити заголовки, тому токен у ?token=. Один HTTP-запит на весь звіт.
    const source = new EventSource(`${getBaseUrl()}/reports/${id}/events?token=${encodeURIComponent(getAccessToken() ?? '')}`);
    let messages = 0;
    source.onmessage = (msg) => {
      messages += 1;
      const event = JSON.parse(msg.data) as ReportEvent;
      apply(setSse, event, { requests: 1, messages });
      if (isFinal(event.status)) source.close();
    };
    source.onerror = () => {
      setSse((prev) => (isFinal(prev.status) ? prev : { ...prev, error: "SSE: з'єднання розірвано" }));
      source.close();
    };
    cleanupRef.current.push(() => source.close());
  }

  function followByWs(socket: Socket, id: string) {
    let messages = 0;
    socket.on('report:progress', (event: ReportEvent) => {
      if (event.reportId !== id) return;
      messages += 1;
      apply(setWs, event, { requests: 1, messages });
      if (isFinal(event.status)) socket.disconnect();
    });
    socket.on('connect_error', (err: Error) => setWs((prev) => ({ ...prev, error: `WS: ${err.message}` })));
    cleanupRef.current.push(() => socket.disconnect());
  }

  async function runFlood() {
    setFloodBusy(true);
    setFlood(null);
    setDrained(null);
    setPeakWaiting(null);
    try {
      // Чистий старт: прибираємо свої завислі job-и, щоб результат не залежав від попередніх кліків.
      await apiCall('POST', '/reports/demo/drain');
      // Хвилями по 10 паралельних: перевірка "waiting < QUEUE_MAX_WAITING" і додавання job-а це два кроки, і 120 запитів
      // одночасно всі встигають прочитати "waiting = 0". Хвилі показують ліміт так, як його бачать реальні клієнти.
      const results: ApiExchange[] = [];
      for (let sent = 0; sent < floodN; sent += FLOOD_WAVE) {
        const size = Math.min(FLOOD_WAVE, floodN - sent);
        results.push(...(await Promise.all(Array.from({ length: size }, () => apiCall('POST', '/reports', { body: {} })))));
      }
      setFlood(results);
      const peak = await apiCall('GET', '/reports/queue-stats', { auth: false });
      if (peak.ok) {
        setStats(peak.body as QueueStats);
        setPeakWaiting((peak.body as QueueStats).waiting);
      }
      // Відновлення: прибираємо свої job-и, що чекають. Після цього сторінку можна використовувати знову.
      const drainRes = await apiCall('POST', '/reports/demo/drain');
      const after = await apiCall('GET', '/reports/queue-stats', { auth: false });
      if (after.ok) setStats(after.body as QueueStats);
      setDrained({ removed: drainRes.ok ? (drainRes.body as { removed: number }).removed : 0, waitingAfter: after.ok ? (after.body as QueueStats).waiting : null });
    } finally {
      setFloodBusy(false);
    }
  }

  async function send300() {
    setEventsBusy(true);
    setEvents(null);
    const t0 = performance.now();
    try {
      const results = await Promise.all(Array.from({ length: 300 }, (_, i) => apiCall('POST', '/events', { body: { type: 'click', payload: { n: i } } })));
      setEvents({ count: 300, ok: results.filter((r) => r.status === 202).length, ms: Math.round(performance.now() - t0) });
    } finally {
      setEventsBusy(false);
    }
  }

  const floodAccepted = flood ? flood.filter((r) => r.status === 202).length : 0;
  const floodRejected = flood ? flood.filter((r) => r.status === 429).length : 0;
  const floodRetryAfter = flood?.find((r) => r.status === 429)?.headers['retry-after'] ?? null;

  return (
    <>
      <PageTitle title="Черга і воркер: polling, SSE, WebSocket" sub="BullMQ, окремий процес воркера, 202 + три способи стежити за job-ом, backpressure, батчинг" />

      <Topic
        what={
          <>
            Довга робота не має виконуватись усередині HTTP-запиту. API кладе job у чергу (Redis), одразу відповідає 202 і йде далі, а окремий процес-воркер
            бере job і робить його. Клієнт отримує id і потім дізнається результат.
          </>
        }
        when={
          <>
            Потрібно, коли робота довша за секунду-дві, коли її треба повторити при збої або коли піки навантаження треба згладити чергою. Не потрібно для
            швидких запитів: черга додає Redis, окремий процес і нову категорію помилок (job загубився, воркер не запущений). Якщо відповідь потрібна тут і зараз,
            роби її в запиті.
          </>
        }
        how={
          <>
            POST /reports пише рядок у таблицю reports, кладе job у BullMQ і відповідає 202. Воркер (src/worker.ts) робить 5 кроків по 1 с, оновлює прогрес
            і публікує його в Redis pub/sub. API підписаний на канал і роздає статус клієнтам. Рядок у БД створюється ДО job-а: якщо Redis упаде між двома
            кроками, ми побачимо звіт у статусі queued без job-а, а не job без звіту.
          </>
        }
        extra={
          <>
            <pre>{`клієнт        API                    Redis (BullMQ)        воркер               БД
  |-- POST -->|                         |                     |                   |
  |           |-- INSERT reports ------------------------------------------------->|
  |           |-- add(job) ------------>|                     |                   |
  |<-- 202 ---|                         |--- job ------------>|                   |
  |           |                         |                     |-- UPDATE active ->|
  |           |<== pub report-events ===|<== publish =========|                   |
  |<-- SSE ---|                         |                     |   ...5 кроків...  |
  |<-- WS ----|                         |                     |-- UPDATE done --->|`}</pre>
            <p>
              <b>Чому в job-а такі налаштування.</b> attempts: 3, бо збій часто тимчасовий (мережа, перезапуск, лок), а звіт, який не вийшов тричі, не вийде і
              вчетверте, лише забиватиме чергу. backoff exponential з 500 мс дає паузи 0,5 с і 1 с: не добиваємо залежність, яка щойно впала. removeOnComplete: 100 і
              removeOnFail: 100, бо результат уже лежить у таблиці reports, а Redis не має рости вічно; останні сто лишаються, щоб було що розглянути в Bull Board.
              Для подій інакше: removeOnComplete: true, бо їх тисячі, а removeOnFail: 1000, щоб розібрати збої.
            </p>
          </>
        }
      />

      <Explain>
        <p>
          <b>Проблема, яку розв'язують polling, SSE і WebSocket.</b> HTTP працює так: клієнт питає, сервер відповідає, і все. Сервер сам нічого не може
          сказати браузеру. Але звіт робиться 5 секунд у воркері, і браузер хоче бачити прогрес. Як йому дізнатись, що щось змінилось? Є три способи.
        </p>
        <p>
          <b>Polling (опитування).</b> Браузер сам питає знову і знову: <code>GET /reports/:id</code> кожну секунду, «вже готово?». Просто, працює скрізь, без
          нічого нового. Ціна: купа порожніх запитів, у яких відповідь «ще ні», і затримка до секунди між подією і тим, що ти її побачив.
        </p>
        <p>
          <b>SSE (Server-Sent Events).</b> Браузер робить один <code>GET /reports/:id/events</code>, а сервер не закриває з'єднання і дописує в нього рядок
          щоразу, як щось сталось. Як радіо: ти ввімкнув, далі тільки слухаєш. В один бік, від сервера до клієнта. Це звичайний HTTP, тому проходить через
          будь-який проксі. У браузері це <code>new EventSource(url)</code>.
        </p>
        <p>
          <b>WebSocket.</b> Браузер і сервер один раз домовляються і відкривають постійну лінію в обидва боки. Далі будь-хто з них може надіслати повідомлення
          будь-коли. Це вже не HTTP, окремий протокол. У проєкті лінія <code>/live</code> уже відкрита для «хто онлайн» і дошки, тому прогрес звіту приходить
          по ній безкоштовно: нуль нових запитів.
        </p>
        <pre>{`                 хто починає      напрям          нових запитів на один звіт
polling          клієнт, щоразу   клієнт -> сервер  6-7 (звіт триває 5 с, опитування щосекунди)
SSE              клієнт, один раз сервер -> клієнт  1
WebSocket        клієнт, один раз обидва боки       0 (лінія вже є)`}</pre>
        <p>
          Коли що брати: прогрес одного звіту або нечасті оновлення: polling, він найпростіший. Стрічка подій, логи, сповіщення від сервера: SSE. Чат,
          спільна дошка, гра, усе, де клієнт теж часто шле дані: WebSocket.
        </p>
      </Explain>

      <Card title="Один звіт, три спостерігачі">
        <div className="prose">
          <p>
            Одна кнопка: перед стартом ми самі прибираємо твої застряглі job-и, потім створюємо звіт на 5 секунд, і всі три способи стежать за ним одночасно.
            Колонки показують той самий job: статус, прогрес, номер спроби. Головне число внизу кожної: скільки HTTP-запитів це коштувало. Polling близько 6-7, SSE
            один, WebSocket нуль. Уяви 1000 відкритих вкладок: це 1000 запитів щосекунди проти нуля.
          </p>
          <p>
            Добре: усі три доходять до completed з прогресом 100. Постав failRate 0.5, щоб побачити attempt 2 і 3 і, можливо, failed після третьої спроби. Потрібен
            запущений воркер.
          </p>
        </div>
        <NeedAuth />
        <div className="row">
          <label>
            failRate (0..1)
            <input type="number" min={0} max={1} step={0.1} value={failRate} onChange={(e) => setFailRate(Number(e.target.value) || 0)} />
          </label>
          <button type="button" className="primary" onClick={() => void start()} disabled={!auth.tokens || latency.busy} data-testid="start-report">
            Запустити звіт (POST /reports)
          </button>
          {reportId && (
            <span className="pill mono small" data-testid="report-id">
              id {reportId.slice(0, 8)}
            </span>
          )}
        </div>
        {workerHint && <div className="note err">Звіт 4 секунди стоїть у queued: схоже, воркер не запущений. Запусти npm run start:worker (або dev:worker) і натисни кнопку ще раз.</div>}
        <div className="cols-3">
          <FollowerCol title="Polling" sub="GET /reports/:id кожну 1 с" f={poll} testId="col-poll" costLabel={`${poll.requests} HTTP-запитів`} />
          <FollowerCol
            title="SSE"
            sub="EventSource /reports/:id/events"
            f={sse}
            testId="col-sse"
            costLabel={`${sse.requests} HTTP-запит, ${sse.messages} подій`}
          />
          <FollowerCol
            title="WebSocket"
            sub="socket.io /live, report:progress"
            f={ws}
            testId="col-ws"
            costLabel={`${ws.requests} з'єднання, ${ws.messages} подій`}
          />
        </div>
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelFooter
          paths={[
            'src/modules/jobs/reports.service.ts (create: enqueue з attempts і backoff)',
            'src/modules/jobs/reports.processor.ts (5 кроків, retry, публікація статусу)',
            'src/modules/jobs/reports.controller.ts (SSE) і report-events.service.ts (pub/sub)',
          ]}
          tries={[
            <>
              Постав failRate 0.5 і запусти звіт кілька разів: у якій колонці раніше видно attempt 2? Потім зміни delay у backoff на 5000 і подивись на паузу між спробами.
            </>,
            <>Закрий вкладку під час звіту і відкрий Bull Board: job доробить без тебе, бо живе у воркері.</>,
          ]}
        />
      </Card>

      <Topic
        what={
          <>
            Backpressure це чесна відмова, коли система не встигає. Якщо черга вже довга, нові звіти не приймаємо і кажемо «пізніше» (429 і Retry-After),
            замість обіцяти те, чого не виконаємо.
          </>
        }
        when={
          <>
            Потрібно, коли роботу кладуть швидше, ніж воркер її робить: без межі черга росте, Redis їсть пам'ять, а клієнт чекає годинами. Не потрібно, коли черга
            короткоживуча і навантаження завжди менше за пропускну здатність воркера.
          </>
        }
        how={
          <>
            Межа це QUEUE_MAX_WAITING, у проєкті 100. Воркер робить 2 звіти по 5 с, тобто 0,4 звіту за секунду. Сотий у черзі чекав би 100 / 0,4 = 250 с, майже
            чотири хвилини. Тому 101-й отримує 429 QUEUE_FULL з Retry-After: 5. Межа м'яка: перевірка «скільки чекає» і додавання job-а це два окремі кроки,
            тому 120 запитів в один момент усі бачать порожню чергу і проходять усі 120. Це та сама гонка, що на сторінці «Кредити», тільки для черги її
            наслідки безпечні. Для грошей так не можна.
          </>
        }
      />

      <Card title="Flood: впертися в QUEUE_FULL і відновити чергу">
        <div className="prose">
          <p>
            Кнопка шле N звітів хвилями по {FLOOD_WAVE} паралельних, потім показує, скільки прийнято (202) і скільки відхилено (429). Це вже реальний стан черги в момент
            піку. Одразу після цього ми самі прибираємо твої job-и, що чекають, тому сторінкою можна користуватись знову, а звіт з верхньої панелі не стоїть у черзі.
          </p>
          <p>
            Добре: приблизно {stats?.maxWaiting ?? 100} з N пройшли як 202 (плюс 2, які воркер встиг узяти одразу), решта 429 з Retry-After 5, а waiting у піку не
            перевищує межу більше ніж на розмір хвилі. Погано, якби усі 202 проходили, а черга росла без межі.
          </p>
        </div>
        <NeedAuth />
        <div className="row">
          <label>
            N звітів
            <input type="number" min={1} max={500} value={floodN} onChange={(e) => setFloodN(Number(e.target.value) || 120)} />
          </label>
          <button type="button" className="danger" onClick={() => void runFlood()} disabled={!auth.tokens || floodBusy} data-testid="flood">
            {floodBusy ? 'надсилаю...' : `${floodN} x POST /reports`}
          </button>
        </div>
        {stats && (
          <div className="row" data-testid="queue-stats">
            <span className="pill">
              waiting <b className="mono">{stats.waiting}</b> / {stats.maxWaiting}
            </span>
            <span className="pill">
              active <b className="mono">{stats.active}</b>
            </span>
            <span className="pill">
              completed <b className="mono">{stats.completed}</b>
            </span>
            <span className="pill">
              failed <b className="mono">{stats.failed}</b>
            </span>
            <span className="muted small">оновлюється щосекунди, GET /reports/queue-stats</span>
          </div>
        )}
        {stats && (
          <div className="progress">
            <span
              style={{
                width: `${Math.min(100, (stats.waiting / Math.max(1, stats.maxWaiting)) * 100)}%`,
                background: stats.waiting >= stats.maxWaiting ? 'var(--err)' : undefined,
              }}
            />
          </div>
        )}
        {flood && (
          <div className="row" data-testid="flood-result">
            <span className="pill">
              202 accepted <b className="mono" data-testid="flood-202">{floodAccepted}</b>
            </span>
            <span className="pill">
              429 QUEUE_FULL <b className="mono" data-testid="flood-429">{floodRejected}</b>
            </span>
            {floodRetryAfter && (
              <span className="pill">
                Retry-After <b className="mono">{floodRetryAfter} с</b>
              </span>
            )}
            {peakWaiting !== null && (
              <span className="pill">
                waiting у піку <b className="mono">{peakWaiting}</b>
              </span>
            )}
          </div>
        )}
        {drained && (
          <div className="note ok" data-testid="flood-restored">
            Черга відновлена: прибрано {drained.removed} job-ів, waiting тепер {drained.waitingAfter ?? '?'}. Два звіти, які воркер уже взяв, добіжать за 5 с.
          </div>
        )}
        <div className="muted small">Bull Board з тим самим: {getBaseUrl()}/queues</div>
        <PanelFooter
          paths={[
            'src/modules/jobs/reports.service.ts (create: перевірка QUEUE_MAX_WAITING; drainMine: демо-відновлення)',
            'src/modules/config/config.schema.ts (QUEUE_MAX_WAITING, WORKER_CONCURRENCY)',
            'test/e2e/jobs.e2e-spec.ts (QUEUE_FULL при ліміті 3)',
          ]}
          tries={[
            <>Запусти API з QUEUE_MAX_WAITING=20 і повтори flood: скільки 202 тепер?</>,
            <>Зміни FLOOD_WAVE на 120 у QueuePage.tsx: усі запити йдуть в один момент. Скільки з них проскочить понад межу?</>,
          ]}
        />
      </Card>

      <Topic
        what={
          <>
            Батчинг це збирання багатьох дрібних записів в один великий INSERT. База платить за кожну команду (мережа, парсинг, WAL), а не лише за рядки, тому 100
            рядків одним запитом набагато дешевші за 100 запитів по рядку.
          </>
        }
        when={
          <>
            Потрібно для потоку дрібних подій: кліки, метрики, логи. Не потрібно для записів, які мають бути видимі одразу або де кожен рядок може впасти окремо: там
            важливіше простота.
          </>
        }
        how={
          <>
            POST /events кладе один job на подію. Воркер черги events має concurrency 100, а колектор збирає job-и «у польоті» в пачку до 100 (або 50 мс очікування)
            і пише одним INSERT ... VALUES (...), (...). Виміряно: 500 одиничних INSERT 459 мс, 5 пачок по 100 рядків 10 мс, прискорення x47.
          </>
        }
      />

      <Card title="300 подій: батчинг у воркері">
        <div className="prose">
          <p>
            300 окремих POST /events, кожен кладе свій job. Тут видно лише час і кількість 202; скільки пачок вийшло, показує лог воркера «Записано пачку
            подій: N». Замість 300 INSERT там буде кілька пачок по 100 рядків.
          </p>
        </div>
        <NeedAuth />
        <div className="row">
          <button type="button" className="primary" onClick={() => void send300()} disabled={!auth.tokens || eventsBusy} data-testid="send-events">
            {eventsBusy ? 'надсилаю...' : '300 x POST /events'}
          </button>
          {events && (
            <span className="pill" data-testid="events-result">
              202: <b className="mono">{events.ok}</b> з {events.count} за <b className="mono">{events.ms} мс</b>
            </span>
          )}
        </div>
        <PanelFooter
          paths={['src/modules/jobs/batch-collector.ts (збирання пачки)', 'src/modules/jobs/events.processor.ts', 'src/modules/jobs/events.controller.ts (202 і job на подію)']}
          tries={[
            <>Запусти npm run bench:batch у корені проєкту і порівняй одиничні INSERT з пачками.</>,
            <>Зменш concurrency воркера events з 100 до 1 і повтори кнопку: якого розміру тепер пачки в логу?</>,
          ]}
        />
      </Card>
    </>
  );
}

function FollowerCol({ title, sub, f, testId, costLabel }: { title: string; sub: string; f: Follower; testId: string; costLabel: string }) {
  const elapsed = f.startedAt ? ((f.finishedAt ?? Date.now()) - f.startedAt) / 1000 : 0;
  return (
    <div className="col" data-testid={testId} data-status={f.status}>
      <h3>{title}</h3>
      <div className="muted small mono">{sub}</div>
      <Progress value={f.progress} status={f.status} />
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="pill">
          status <b data-testid={`${testId}-status`}>{f.status}</b>
        </span>
        <span className="pill">
          progress <b className="mono">{f.progress}%</b>
        </span>
        {f.attempt > 0 && (
          <span className="pill">
            attempt <b className="mono">{f.attempt}</b>
          </span>
        )}
      </div>
      <div className="small">
        коштувало: <b>{costLabel}</b>
      </div>
      {f.startedAt > 0 && <div className="muted small">{elapsed.toFixed(1)} с</div>}
      {f.error && <div className="note err">{f.error}</div>}
    </div>
  );
}
