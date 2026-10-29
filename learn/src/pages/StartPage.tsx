// Старт: реєстрація, логін, JWT розкодований, зворотний відлік до exp, refresh з ротацією і виявлення повторного використання.
import { useEffect, useState } from 'react';
import { apiCall } from '../api/client';
import { AuthUser, Tokens, decodeJwt, setAuth, useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, pretty } from '../components/Panel';
import { Card, Explain, PageTitle } from '../components/common';

interface AuthResponse {
  user: AuthUser;
  tokens: Tokens;
}

function isTokens(body: unknown): body is Tokens {
  return typeof body === 'object' && body !== null && 'accessToken' in body && 'refreshToken' in body;
}

function isAuthResponse(body: unknown): body is AuthResponse {
  return typeof body === 'object' && body !== null && 'tokens' in body && 'user' in body;
}

function useCountdown(exp: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!exp) return '';
  const left = exp * 1000 - now;
  if (left <= 0) return 'протермінований';
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function StartPage() {
  const auth = useAuth();
  const latency = useLatency();
  const [email, setEmail] = useState('olena@devhub.local');
  const [password, setPassword] = useState('password123');
  const [displayName, setDisplayName] = useState('Olena');
  const [previousRefresh, setPreviousRefresh] = useState<string | null>(null);
  const [reuseResult, setReuseResult] = useState<string | null>(null);

  const decoded = auth.tokens ? decodeJwt(auth.tokens.accessToken) : null;
  const countdown = useCountdown(decoded?.exp ?? null);

  async function submit(path: '/auth/register' | '/auth/login') {
    const body = path === '/auth/register' ? { email, password, displayName } : { email, password };
    const res = await latency.track(apiCall('POST', path, { body, auth: false }));
    if (res.ok && isAuthResponse(res.body)) {
      setAuth(res.body.user, res.body.tokens);
      setPreviousRefresh(null);
      setReuseResult(null);
    }
  }

  async function refresh() {
    if (!auth.tokens) return;
    const old = auth.tokens.refreshToken;
    const res = await latency.track(apiCall('POST', '/auth/refresh', { body: { refreshToken: old }, auth: false }));
    // /auth/refresh віддає тільки нову пару токенів, без user.
    if (res.ok && isTokens(res.body)) {
      setAuth(null, res.body);
      setPreviousRefresh(old);
      setReuseResult(null);
    }
  }

  async function reuseOld() {
    if (!previousRefresh) return;
    const res = await latency.track(apiCall('POST', '/auth/refresh', { body: { refreshToken: previousRefresh }, auth: false }));
    if (res.status === 401) {
      setReuseResult(
        "401: старий refresh уже використаний. Сервер вважає це крадіжкою і відкликав усю сім'ю токенів: новий refresh теж мертвий, access доживе свої 15 хв. Далі тільки логін.",
      );
    } else {
      setReuseResult(`Несподівано: ${res.status}`);
    }
  }

  async function me() {
    await latency.track(apiCall('GET', '/auth/me'));
  }

  function fillSeed(seedEmail: string, name: string) {
    setEmail(seedEmail);
    setDisplayName(name);
    setPassword('password123');
  }

  return (
    <>
      <PageTitle title="Старт" sub="Реєстрація і логін, JWT усередині, refresh з ротацією" />
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> <code>POST /auth/login</code> перевіряє пароль через bcrypt і віддає дві речі: <b>access-токен</b> (JWT, 15 хв) і{' '}
          <b>refresh-токен</b> (32 випадкові байти, 30 днів). Access перевіряється тільки підписом, без запиту до БД: дешево, але його не можна відкликати, тому
          він короткий. Refresh зберігається в БД як sha256-хеш і його можна відкликати.
        </p>
        <p>
          <b>Ротація.</b> Кожен <code>POST /auth/refresh</code> видає нову пару і позначає старий refresh як використаний (<code>used_at</code>). Якщо
          використаний токен приходить знову, його хтось вкрав: сервер відкликає всю сім'ю (<code>revoked_at WHERE family</code>) і відповідає 401.
        </p>
        <p className="small muted">
          Сід має користувачів admin@, olena@, taras@, iryna@devhub.local з паролем password123. Admin потрібен для сторінок Кредити (topup).
        </p>
      </Explain>

      <div className="card-grid">
        <Card title="Форма">
          <div className="row">
            <button type="button" onClick={() => fillSeed('olena@devhub.local', 'Olena')}>
              olena (user)
            </button>
            <button type="button" onClick={() => fillSeed('admin@devhub.local', 'Admin')}>
              admin
            </button>
            <button type="button" onClick={() => fillSeed(`user${Date.now()}@example.com`, 'Новий')}>
              новий email
            </button>
          </div>
          <div className="row">
            <label>
              email
              <input value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email" />
            </label>
            <label>
              password (8+)
              <input value={password} onChange={(e) => setPassword(e.target.value)} data-testid="password" />
            </label>
            <label>
              displayName
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="displayName" />
            </label>
          </div>
          <div className="row">
            <button type="button" className="primary" onClick={() => submit('/auth/register')} disabled={latency.busy} data-testid="register">
              Зареєструватись (POST /auth/register)
            </button>
            <button type="button" className="primary" onClick={() => submit('/auth/login')} disabled={latency.busy} data-testid="login">
              Увійти (POST /auth/login)
            </button>
            <button type="button" onClick={me} disabled={!auth.tokens || latency.busy}>
              GET /auth/me
            </button>
          </div>
        </Card>

        <Card title="JWT розкодований">
          {!decoded && <div className="muted">Немає токена. Увійди або зареєструйся.</div>}
          {decoded && (
            <>
              <div className="row">
                <span className="pill">
                  до exp:{' '}
                  <b className="mono" data-testid="countdown">
                    {countdown}
                  </b>
                </span>
                <span className="pill">
                  role: <b>{String(decoded.payload.role)}</b>
                </span>
              </div>
              <h3>header</h3>
              <pre className="mono">{pretty(decoded.header)}</pre>
              <h3 style={{ marginTop: 8 }}>payload</h3>
              <pre className="mono" data-testid="jwt-payload">
                {pretty(decoded.payload)}
              </pre>
              <div className="muted small" style={{ marginTop: 6 }}>
                signature: <span className="mono">{decoded.signature.slice(0, 20)}...</span> (HMAC-SHA256 від header.payload і JWT_SECRET; перевіряється без БД)
              </div>
            </>
          )}
        </Card>
      </div>

      <Card title="Refresh з ротацією">
        <div className="row">
          <button type="button" className="primary" onClick={refresh} disabled={!auth.tokens || latency.busy} data-testid="refresh">
            Оновити пару (POST /auth/refresh)
          </button>
          <button type="button" className="danger" onClick={reuseOld} disabled={!previousRefresh || latency.busy} data-testid="reuse">
            Використати старий refresh ще раз
          </button>
        </div>
        {auth.tokens && (
          <div className="panel-headers">
            <span>
              поточний refresh: <b>{auth.tokens.refreshToken.slice(0, 16)}...</b>
            </span>
            {previousRefresh && (
              <span>
                попередній (спалений): <b>{previousRefresh.slice(0, 16)}...</b>
              </span>
            )}
          </div>
        )}
        {reuseResult && (
          <div className="note err" data-testid="reuse-result">
            {reuseResult}
          </div>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
      </Card>
    </>
  );
}
