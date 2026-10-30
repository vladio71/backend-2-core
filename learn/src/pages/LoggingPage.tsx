// Логи, request-id і health: GET /health по кожній залежності і X-Request-Id, який повертається з будь-якої відповіді.
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useLatency } from '../hooks/useLatency';
import { Panel, StatusBadge } from '../components/Panel';
import { Card, Explain, PageTitle } from '../components/common';

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

const CODE_PLACES: Array<[string, string]> = [
  ['src/modules/logging/request-id.middleware.ts', 'бере X-Request-Id із запиту або генерує uuid, повертає в заголовку, пише рядок METHOD url status ms'],
  ['src/modules/logging/request-context.ts', 'AsyncLocalStorage: runWithRequestId(), getRequestId(); id їде через усі await без аргументів'],
  ['src/modules/logging/app-logger.ts', 'JSON-логер, рівень через LOG_LEVEL; у кожному рядку time, level, context, requestId, instance, msg'],
  ['src/modules/jobs/reports.processor.ts', 'воркер: runWithRequestId(job.data.requestId, ...), тому лог job-у має id запиту, що його створив'],
  ['src/modules/health/health.controller.ts', 'SELECT 1 у Postgres і PING у Redis, статус і latencyMs кожного, 503 якщо щось лежить'],
  ['docker-compose.yml', 'healthcheck у api-1 і api-2; nginx стартує лише після service_healthy'],
];

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
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> Middleware бере <code>X-Request-Id</code> із запиту (або генерує uuid), повертає його у відповіді тим самим заголовком
          і кладе в <code>AsyncLocalStorage</code>. Логер друкує JSON, у кожному рядку є <code>requestId</code>. Job у черзі несе <code>requestId</code> у{' '}
          <code>job.data</code>, тому рядки з воркера мають той самий id, що й HTTP-запит, який його створив:
        </p>
        <pre>{`{"time":"2026-10-29T18:46:50.496Z","level":"info","context":"ReportsProcessor","requestId":"demo-req-1","instance":"worker","msg":"Звіт ddd5... : спроба 1, старт"}`}</pre>
        <p>
          <b>Як знайти один запит у логах.</b> Взяти <code>X-Request-Id</code> з відповіді (панель нижче показує його на кожному запиті) і грепнути одразу API і
          воркер: <code>docker compose logs api-1 api-2 worker | grep &lt;requestId&gt;</code>. У Grafana (профіль observability) те саме через поле{' '}
          <code>requestId</code> угорі дашборда. Помилка 500 теж повертає цей id у тілі: користувач називає його в підтримку, і ви бачите повний stack замість
          "щось не працює".
        </p>
        <p>
          <b>/health.</b> Балансувальник, Docker healthcheck і Kubernetes дивляться саме сюди: 503 означає "не слати трафік на цей інстанс". Статус окремо по
          кожній залежності потрібен людині о третій ночі: одразу видно, що впав Redis, а не "щось".
        </p>
      </Explain>

      <Card title="GET /health">
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
      </Card>

      <Card title="X-Request-Id на будь-якому запиті">
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
      </Card>

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
