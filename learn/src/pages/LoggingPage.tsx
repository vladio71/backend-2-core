// Логи, request-id і health: GET /health по кожній залежності і X-Request-Id, який повертається з будь-якої відповіді.
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useLatency } from '../hooks/useLatency';
import { Panel, StatusBadge } from '../components/Panel';
import { Card, PageTitle } from '../components/common';
import { Concept, PanelNotes } from '../components/topic';

interface Dependency {
  status: string;
  latencyMs?: number;
  error?: string;
}

interface HealthBody {
  status: string;
  instance?: string;
  uptimeSeconds?: number;
  dependencies?: Record<string, Dependency>;
}

export function LoggingPage() {
  const health = useLatency();
  const reqs = useLatency(10);
  const [customId, setCustomId] = useState('');
  const [healthBody, setHealthBody] = useState<HealthBody | null>(null);

  async function loadHealth() {
    const res = await health.track(apiCall('GET', '/health', { auth: false }));
    setHealthBody(res.body && typeof res.body === 'object' ? (res.body as HealthBody) : null);
  }

  async function request(path: string) {
    const headers = customId.trim() ? { 'X-Request-Id': customId.trim() } : undefined;
    await reqs.track(apiCall('GET', path, { auth: false, headers, query: path === '/posts' ? { pageSize: 1 } : undefined }));
  }

  const deps = healthBody?.dependencies ? Object.entries(healthBody.dependencies) : [];

  return (
    <>
      <PageTitle title="Логи, request-id і health" sub="Один requestId на запит і на його job у воркері; /health по кожній залежності" />
      <Concept
        what={
          <>
            <p>
              Request id це унікальний рядок, який запит отримує на вході і який потім стоїть у кожному рядку логу цього запиту. Сервер ще й повертає його клієнту: у
              заголовку X-Request-Id і в тілі кожної помилки.
            </p>
            <p>
              <b>Що це дає, на прикладі.</b> Користувач пише в підтримку «звіт не створився» і надсилає скріншот. У тілі відповіді на скріншоті видно requestId.
              Ти виконуєш одну команду і бачиш усю історію цього запиту:
            </p>
            <pre>{`docker compose logs api-1 api-2 worker | grep 7c1b3e90
api-2   {"level":"info","context":"HTTP",             "requestId":"7c1b3e90",...,"msg":"POST /reports 202 33ms"}
worker  {"level":"info","context":"ReportsProcessor", "requestId":"7c1b3e90",...,"msg":"Звіт ddd5...: спроба 1, старт"}
worker  {"level":"warn","context":"ReportsProcessor", "requestId":"7c1b3e90",...,"msg":"Звіт ddd5...: спроба 1/3 упала: ..."}
worker  {"level":"info","context":"ReportsProcessor", "requestId":"7c1b3e90",...,"msg":"Звіт ddd5...: спроба 2, старт"}`}</pre>
            <p>
              Без id ти б шукав за часом і email серед тисяч паралельних запитів, а рядки воркера не знайшов би зовсім: це інший процес, в якому немає ні email, ні
              URL.
            </p>
          </>
        }
        when={
          <>
            <p>
              Потрібен будь-якому сервісу, який обслуговує більше одного запиту одночасно, тобто майже завжди. Особливо коли є кілька інстансів (api-1, api-2) і
              фонові процеси: без наскрізного id їх логи ніяк не зв'язати. Не потрібен одноразовому скрипту.
            </p>
            <p>
              Не плутай із трейсингом. Request id зв'язує рядки логів, а трейс (Jaeger) показує, де пішов час усередині запиту. Id корисний і без Jaeger, і коштує
              один middleware.
            </p>
          </>
        }
        how={
          <>
            <p>
              Middleware на вході бере X-Request-Id із запиту (якщо його поставив клієнт чи nginx і він коротший за 128 символів) або генерує uuid. Id лягає в
              AsyncLocalStorage: це змінна, прив'язана до поточного запиту, яку видно на будь-якій глибині await без передачі аргументами. Логер читає її і друкує в
              кожному JSON-рядку.
            </p>
            <p>
              Коли запит створює job у черзі, requestId їде в даних job-у. Воркер відкриває той самий контекст, тому його рядки мають id запиту, що job створив:
            </p>
            <pre>{`{"time":"2026-10-29T18:46:50.496Z","level":"info","context":"ReportsProcessor","requestId":"demo-req-1","instance":"worker","msg":"Звіт ddd5... : спроба 1, старт"}`}</pre>
            <p>
              Свій id можна задати зверху (nginx, фронтенд, інший сервіс), але це лише мітка для пошуку, не довіряй їй у питаннях безпеки. У Grafana (профіль
              observability) той самий пошук іде через поле requestId угорі дашборда.
            </p>
          </>
        }
      />

      <Card title="X-Request-Id на будь-якому запиті">
        <div className="prose">
          <p>
            Перевіряємо, що id запиту наскрізний. Залиш поле порожнім: сервер згенерує uuid і поверне його у заголовку відповіді. Впиши свій: той самий рядок
            повернеться назад, і саме його ти побачиш у кожному рядку логу цього запиту, включно з воркером, якщо запит створив job.
          </p>
        </div>
        <div className="row">
          <label>
            свій X-Request-Id (необов'язково)
            <input
              className="mono"
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              placeholder="порожньо = сервер згенерує uuid"
              style={{ width: 280 }}
              data-testid="custom-request-id"
            />
          </label>
          <button type="button" className="primary" data-testid="req-posts" disabled={reqs.busy} onClick={() => void request('/posts')}>
            GET /posts?pageSize=1
          </button>
          <button type="button" data-testid="req-404" disabled={reqs.busy} onClick={() => void request('/posts/00000000-0000-4000-8000-000000000002')}>
            GET /posts/&lt;немає&gt; (404 з requestId у тілі)
          </button>
        </div>
        {reqs.history.length > 0 && (
          <table className="tbl" data-testid="request-ids">
            <thead>
              <tr>
                <th>запит</th>
                <th>статус</th>
                <th>X-Request-Id у відповіді</th>
                <th>як знайти в логах</th>
              </tr>
            </thead>
            <tbody>
              {reqs.history.map((r, i) => (
                <tr key={i}>
                  <td className="mono">
                    {r.request.method} {r.request.path}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="mono">{r.requestId ?? 'немає (мережа)'}</td>
                  <td className="mono">{r.requestId ? `docker compose logs api-1 api-2 | grep ${r.requestId.slice(0, 8)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Panel exchange={reqs.exchange} busy={reqs.busy} />
        <PanelNotes
          where={[
            'src/modules/logging/request-id.middleware.ts (бере або генерує id, пише рядок METHOD url status ms)',
            'src/modules/logging/request-context.ts (AsyncLocalStorage)',
            'src/modules/logging/app-logger.ts (JSON-логер)',
            'src/modules/jobs/reports.processor.ts (runWithRequestId для job-у)',
          ]}
          tryItems={[
            <>
              Впиши свій id, наприклад <code>screenshot-42</code>, натисни обидві кнопки і знайди в терміналі API рядки з цим id: метод, URL, статус і мс.
            </>,
            <>
              Створи звіт на сторінці Черга і знайди в логах API і воркера рядки з його requestId: це той самий id в двох процесах.
            </>,
          ]}
        />
      </Card>

      <Concept
        what={
          <p>
            /health відповідає на одне питання: чи може цей інстанс прямо зараз обслужити запит? Для цього він сам пінгує Postgres (SELECT 1) і Redis (PING) і віддає
            статус по кожній залежності.
          </p>
        }
        when={
          <>
            <p>
              Балансувальник, Docker healthcheck і Kubernetes дивляться саме сюди: 503 означає «не слати трафік на цей інстанс». А статус окремо по залежностях потрібен
              людині о третій ночі: одразу видно, що впав Redis, а не просто «щось».
            </p>
            <p>
              Обережно з глибиною. Якщо /health перевіряє зовнішній платіжний сервіс, то його збій виведе з ротації всі твої здорові інстанси. Перевіряй тільки те,
              без чого ти справді не можеш працювати. І /health не мусить вимагати токена.
            </p>
          </>
        }
        how={
          <p>
            Контролер робить обидва пінги паралельно, міряє latencyMs кожного і віддає 200 або 503. У docker-compose healthcheck в api-1 і api-2 викликає цей
            ендпоінт, а nginx стартує тільки після service_healthy.
          </p>
        }
      />

      <Card title="GET /health">
        <div className="prose">
          <p>
            Те, що бачить балансувальник. Добре: 200 і status ok, кожна залежність up з часом відповіді в мілісекундах. Зупини Redis і натисни ще раз: буде 503,
            а в картці Redis стане down з текстом помилки, Postgres при цьому лишиться up.
          </p>
        </div>
        <div className="row">
          <button type="button" className="primary" data-testid="health" disabled={health.busy} onClick={() => void loadHealth()}>
            GET /health
          </button>
          {healthBody && (
            <span className="muted small" data-testid="health-summary">
              status <b>{healthBody.status}</b>
              {healthBody.instance && (
                <>
                  , інстанс <b>{healthBody.instance}</b>
                </>
              )}
              {healthBody.uptimeSeconds !== undefined && <>, uptime {healthBody.uptimeSeconds} с</>}
            </span>
          )}
        </div>
        {deps.length > 0 && (
          <div className="dep-grid" data-testid="health-deps">
            {deps.map(([name, dep]) => (
              <div key={name} className={`dep ${dep.status === 'up' ? 'up' : 'down'}`}>
                <h3>{name}</h3>
                <div>
                  <b>{dep.status}</b>
                  {dep.latencyMs !== undefined && <span className="muted small"> {dep.latencyMs} мс</span>}
                </div>
                {dep.error && (
                  <div className="small" style={{ color: 'var(--err)' }}>
                    {dep.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {health.exchange && !health.exchange.ok && !healthBody && (
          <div className="note err">API не відповідає: {health.exchange.networkError ?? `${health.exchange.status} ${health.exchange.statusText}`}</div>
        )}
        <Panel exchange={health.exchange} busy={health.busy} />
        <PanelNotes
          where={['src/modules/health/health.controller.ts (SELECT 1, PING, 503)', 'docker-compose.yml (healthcheck у api-1 і api-2)']}
          tryItems={[
            <>
              Зупини Redis (<code>docker compose stop redis</code>) і натисни кнопку: буде 503, redis down з текстом помилки, postgres лишиться up.
            </>,
            <>Подивись latencyMs: SELECT 1 і PING мають займати одиниці мілісекунд. Якщо багато, проблема в мережі до залежності.</>,
          ]}
        />
      </Card>
    </>
  );
}
