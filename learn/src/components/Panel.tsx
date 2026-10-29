// Панель "Запит / Відповідь / Час": малює один ApiExchange. Є на кожній сторінці, оновлюється після кожного кліку.
import { ApiExchange, INTERESTING_HEADERS } from '../api/client';

interface PanelProps {
  exchange: ApiExchange | null;
  busy?: boolean;
  // Які заголовки відповіді показати крупно. Типово: INTERESTING_HEADERS.
  headers?: string[];
}

export function statusClass(status: number): string {
  return `s${Math.floor(status / 100)}`;
}

export function StatusBadge({ status, text }: { status: number; text?: string }) {
  return <span className={`badge ${statusClass(status)}`}>{text ?? (status === 0 ? 'мережа' : status)}</span>;
}

export function pretty(value: unknown, maxLength = 4000): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n... (обрізано, ${text.length} символів)` : text;
}

export function Panel({ exchange, busy, headers }: PanelProps) {
  const wanted = headers ?? INTERESTING_HEADERS;
  if (!exchange) {
    return (
      <div className="panel">
        <div className="panel-box">
          <h3>Запит</h3>
          <div className="muted small">{busy ? 'виконується...' : 'ще не було'}</div>
        </div>
        <div className="panel-box">
          <h3>Відповідь</h3>
          <div className="muted small">{busy ? 'чекаємо...' : 'ще не було'}</div>
        </div>
        <div className="panel-box">
          <h3>Час</h3>
          <div className="latency">
            {busy ? '...' : '0'} <small>мс</small>
          </div>
        </div>
      </div>
    );
  }
  const { request } = exchange;
  const shownHeaders = wanted.filter((h) => exchange.headers[h] !== undefined);
  const queryText = Object.keys(request.query).length ? `?${new URLSearchParams(request.query).toString()}` : '';
  return (
    <div className="panel" data-testid="panel">
      <div className="panel-box">
        <h3>Запит</h3>
        <div className="panel-line">
          <span className="method">{request.method}</span> {request.path}
          {queryText}
        </div>
        {Object.keys(request.query).length > 0 && (
          <div className="panel-headers">
            {Object.entries(request.query).map(([k, v]) => (
              <span key={k}>
                {k}=<b>{v}</b>
              </span>
            ))}
          </div>
        )}
        <div className="panel-headers">
          {Object.entries(request.headers).map(([k, v]) => (
            <span key={k}>
              {k}: <b>{v}</b>
            </span>
          ))}
          {Object.keys(request.headers).length === 0 && <span>без заголовків</span>}
        </div>
        {request.body !== undefined && <pre>{pretty(request.body)}</pre>}
      </div>
      <div className="panel-box">
        <h3>Відповідь</h3>
        <div className="panel-line">
          <StatusBadge status={exchange.status} /> {exchange.networkError ?? exchange.statusText}
          {busy && <span className="muted"> (новий запит у польоті)</span>}
        </div>
        {shownHeaders.length > 0 && (
          <div className="panel-headers">
            {shownHeaders.map((h) => (
              <span key={h}>
                {h}: <b>{exchange.headers[h]}</b>
              </span>
            ))}
          </div>
        )}
        <pre data-testid="response-body">{pretty(exchange.body)}</pre>
      </div>
      <div className="panel-box">
        <h3>Час</h3>
        <div className="latency" data-testid="latency">
          {exchange.durationMs} <small>мс</small>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          {new Date(request.startedAt).toLocaleTimeString('uk-UA')}
        </div>
        {exchange.requestId && (
          <div className="muted small mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>
            requestId {exchange.requestId.slice(0, 8)}
          </div>
        )}
      </div>
    </div>
  );
}
