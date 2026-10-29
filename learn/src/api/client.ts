// Обгортка над fetch. Кожен виклик повертає ApiExchange: що пішло (метод, шлях, query, заголовки, тіло),
// що прийшло (статус, тіло, заголовки) і скільки тривало (мс). Панель "Запит / Відповідь / Час" малює саме це.
import { getAccessToken } from './auth';
import { ensureProbed, getBaseUrl } from './baseUrl';

export type QueryValue = string | number | boolean | undefined | null;

export interface ApiRequestInfo {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  startedAt: string;
}

export interface ApiExchange {
  request: ApiRequestInfo;
  status: number;
  statusText: string;
  ok: boolean;
  body: unknown;
  headers: Record<string, string>;
  durationMs: number;
  requestId: string | null;
  networkError: string | null;
}

export interface ApiCallOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  // true (типово): додати Authorization: Bearer, якщо є токен. false: піти анонімно навіть з токеном.
  auth?: boolean;
  signal?: AbortSignal;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

// Заголовки, які варто показати в панелі (інші теж зберігаємо, але ці йдуть першими).
export const INTERESTING_HEADERS = [
  'x-request-id',
  'x-cache',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'retry-after',
  'content-type',
  'cache-control',
];

const listeners = new Set<(exchange: ApiExchange) => void>();

export function subscribeExchanges(listener: (exchange: ApiExchange) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function buildQueryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function isErrorBody(body: unknown): body is ApiErrorBody {
  return typeof body === 'object' && body !== null && 'code' in body && 'statusCode' in body;
}

export async function apiCall(method: string, path: string, options: ApiCallOptions = {}): Promise<ApiExchange> {
  if (path !== '/health') await ensureProbed();
  const base = getBaseUrl();
  const qs = buildQueryString(options.query);
  const url = `${base}${path}${qs}`;
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  const token = getAccessToken();
  if (options.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const query: Record<string, string> = {};
  new URLSearchParams(qs).forEach((value, key) => {
    query[key] = value;
  });

  const request: ApiRequestInfo = {
    method,
    url,
    path,
    query,
    headers: maskAuth(headers),
    body: options.body,
    startedAt: new Date().toISOString(),
  };

  const t0 = performance.now();
  let exchange: ApiExchange;
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
    const durationMs = Math.round((performance.now() - t0) * 10) / 10;
    const text = await res.text();
    let body: unknown = text;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else {
      body = null;
    }
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });
    exchange = {
      request,
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      body,
      headers: resHeaders,
      durationMs,
      requestId: resHeaders['x-request-id'] ?? (isErrorBody(body) ? body.requestId : null),
      networkError: null,
    };
  } catch (err) {
    const durationMs = Math.round((performance.now() - t0) * 10) / 10;
    exchange = {
      request,
      status: 0,
      statusText: 'network error',
      ok: false,
      body: null,
      headers: {},
      durationMs,
      requestId: null,
      networkError: err instanceof Error ? err.message : String(err),
    };
  }
  for (const listener of listeners) listener(exchange);
  return exchange;
}

function maskAuth(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  if (out.Authorization) {
    const token = out.Authorization.replace('Bearer ', '');
    out.Authorization = `Bearer ${token.slice(0, 12)}...${token.slice(-6)}`;
  }
  return out;
}

// Дістати code з тіла помилки або null.
export function errorCode(exchange: ApiExchange): string | null {
  return isErrorBody(exchange.body) ? exchange.body.code : null;
}

export function errorMessage(exchange: ApiExchange): string {
  if (exchange.networkError) return `Мережа: ${exchange.networkError}`;
  if (isErrorBody(exchange.body)) return `${exchange.status} ${exchange.body.code}: ${exchange.body.message}`;
  return `${exchange.status} ${exchange.statusText}`;
}
