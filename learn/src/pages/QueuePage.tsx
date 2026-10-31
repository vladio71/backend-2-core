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
import { Card, Explain, NeedAuth, PageTitle, Progress, WhereInCode } from '../components/common';

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

  function stopFollowers() {
    for (const fn of cleanupRef.current) fn();
    cleanupRef.current = [];
  }

  async function start() {
    stopFollowers();
    setPoll(EMPTY);
    setSse(EMPTY);
    setWs(EMPTY);
    // WebSocket підключаємо ДО створення звіту, щоб не пропустити перші події.
    const socket = await connectLive();
    const res = await latency.track(apiCall('POST', '/reports', { body: failRate > 0 ? { failRate } : {} }));
    if (res.status !== 202) {
      socket.disconnect();
      return;
    }
    const id = (res.body as { id: string }).id;
    setReportId(id);
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
    try {
      const results = await Promise.all(Array.from({ length: floodN }, () => apiCall('POST', '/reports', { body: {} })));
      setFlood(results);
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
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> POST /reports створює рядок у таблиці reports, кладе job у чергу BullMQ (Redis) і одразу відповідає{' '}
          <code>202 {'{ id, status: "queued" }'}</code>.
        </p>
        <p>
          Воркер (окремий процес) бере job, робить 5 кроків по 1 с, оновлюючи прогрес, при помилці повторює до 3 разів з експоненційним backoff. Статус летить з
          воркера в API через Redis pub/sub, а API роздає його polling-у, SSE і WebSocket-у.
        </p>
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
          <b>Backpressure.</b> Якщо у черзі чекає більше QUEUE_MAX_WAITING (типово 100) job-ів, POST /reports відповідає <code>429 QUEUE_FULL</code> із
          заголовком Retry-After: 5. Обіцяти те, чого не виконаємо, гірше, ніж чесно сказати "пізніше".
        </p>
        <p>
          <b>Батчинг.</b> POST /events кладе один job на подію. Воркер черги events має concurrency 100, а колектор збирає job-и "у польоті" у пачку до 100 (або
          50 мс очікування) і пише ОДНИМ <code>INSERT ... VALUES (...), (...)</code>.
        </p>
        <p>Виміряно: 500 одиничних INSERT 459 мс, 5 пачок по 100 рядків 10 мс, прискорення x47.</p>
        <WhereInCode paths={['src/worker.ts', 'modules/jobs/reports.processor.ts', 'report-events.service.ts (pub/sub)', 'batch-collector.ts', 'events.processor.ts']} />
      </Explain>

      <Explain>
        <p>
          <b>Проблема, яку розв'язують polling, SSE і WebSocket.</b> HTTP працює так: клієнт питає, сервер відповідає, і все. Сервер сам нічого не може
          сказати браузеру. Але звіт робиться 5 секунд у воркері, і браузер хоче бачити прогрес. Як йому дізнатись, що щось змінилось? Є три способи.
        </p>
        <p>
          <b>Polling (опитування).</b> Браузер сам питає знову і знову: <code>GET /reports/:id</code> кожні 500 мс, «вже готово?». Просто, працює скрізь, без
          нічого нового. Ціна: купа порожніх запитів, у яких відповідь «ще ні», і затримка до півсекунди між подією і тим, що ти її побачив.
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
polling          клієнт, щоразу   клієнт -> сервер  10-11
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
            Нижче один звіт на 5 секунд і всі три способи одночасно стежать за ним. Три колонки показують той самий job: статус, прогрес, номер спроби. Головне
            число внизу кожної колонки: скільки HTTP-запитів це коштувало. Polling близько 10, SSE один, WebSocket нуль. Уяви 1000 відкритих вкладок: це 1000
            запитів кожні півсекунди проти нуля.
          </p>
          <p>
            Добре: усі три доходять до completed з прогресом 100. Постав failRate 0.5, щоб побачити attempt 2 і 3 і, можливо, failed після третьої спроби.
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
      </Card>

      <div className="card-grid">
        <Card title="Стан черги (GET /reports/queue-stats щосекунди)">
          <div className="prose">
            <p>
              Лічильники BullMQ: waiting скільки job-ів чекають воркера, active скільки виконуються зараз (не більше за WORKER_CONCURRENCY), completed і
              failed за весь час. Якщо воркер не запущений, waiting росте, а active лишається 0.
            </p>
          </div>
          {stats ? (
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
            </div>
          ) : (
            <div className="muted">нема даних</div>
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
          <div className="muted small">Bull Board з тим самим: {getBaseUrl()}/queues</div>
        </Card>

        <Card title="Flood: впертися в QUEUE_FULL">
          <div className="prose">
            <p>
              Перевіряємо backpressure: шлемо більше звітів, ніж черга погоджується тримати. Добре, коли частина відповідей 202, а решта 429 QUEUE_FULL з
              Retry-After, і waiting у стані черги не перевищує ліміт. Погано, якби усі 202 проходили, а черга росла без межі.
            </p>
          </div>
          <div className="row">
            <label>
              N звітів одночасно
              <input type="number" min={1} max={500} value={floodN} onChange={(e) => setFloodN(Number(e.target.value) || 120)} />
            </label>
            <button type="button" className="danger" onClick={() => void runFlood()} disabled={!auth.tokens || floodBusy} data-testid="flood">
              {floodBusy ? 'надсилаю...' : `${floodN} x POST /reports`}
            </button>
          </div>
          <div className="note">Воркер робить 2 звіти по 5 с одночасно, тому черга розсмоктується хвилин 5. QUEUE_MAX_WAITING у .env бекенду типово 100.</div>
          {flood && (
            <div className="row" data-testid="flood-result">
              <span className="pill">
                202 accepted <b className="mono">{floodAccepted}</b>
              </span>
              <span className="pill">
                429 QUEUE_FULL <b className="mono">{floodRejected}</b>
              </span>
              {floodRetryAfter && (
                <span className="pill">
                  Retry-After <b className="mono">{floodRetryAfter} с</b>
                </span>
              )}
            </div>
          )}
        </Card>

        <Card title="300 подій: батчинг у воркері">
          <div className="prose">
            <p>
              300 окремих POST /events, кожен кладе свій job. Дивись у логи воркера: замість 300 INSERT він пише кілька пачок по 100 рядків. Тут видно тільки
              час і кількість 202; скільки саме пачок вийшло, показує лог воркера "Записано пачку подій: N".
            </p>
          </div>
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
          <div className="note ok">
            API відповідає 202 одразу (job у черзі). Воркер збере ці 300 job-ів у 3-4 пачки і зробить 3-4 INSERT замість 300. Дивись лог воркера: розмір кожної
            пачки.
          </div>
        </Card>
      </div>
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
