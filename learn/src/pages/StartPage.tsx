// Старт: реєстрація, логін, JWT розкодований, зворотний відлік до exp, refresh з ротацією і виявлення повторного використання.
import { useEffect, useState } from 'react';
import { apiCall } from '../api/client';
import { AuthUser, Tokens, clearAuth, decodeJwt, getAuthState, setAuth, useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, pretty } from '../components/Panel';
import { Card, NeedAuth, PageTitle } from '../components/common';
import { Concept, PanelNotes } from '../components/topic';

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

// Підроблений токен: той самий header і підпис, але payload з іншою роллю. Підпис більше не відповідає payload.
function forgeRole(token: string): { token: string; role: string } | null {
  const decoded = decodeJwt(token);
  if (!decoded) return null;
  const role = decoded.payload.role === 'admin' ? 'user' : 'admin';
  const json = JSON.stringify({ ...decoded.payload, role });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const payload = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const parts = token.split('.');
  return { token: `${parts[0]}.${payload}.${parts[2]}`, role };
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
  const forgeLatency = useLatency();
  const [email, setEmail] = useState('olena@devhub.local');
  const [password, setPassword] = useState('password123');
  const [displayName, setDisplayName] = useState('Olena');
  const [previousRefresh, setPreviousRefresh] = useState<string | null>(null);
  const [reuseLines, setReuseLines] = useState<string[] | null>(null);
  const [forgedRole, setForgedRole] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const decoded = auth.tokens ? decodeJwt(auth.tokens.accessToken) : null;
  const countdown = useCountdown(decoded?.exp ?? null);

  async function submit(path: '/auth/register' | '/auth/login') {
    const body = path === '/auth/register' ? { email, password, displayName } : { email, password };
    const res = await latency.track(apiCall('POST', path, { body, auth: false }));
    if (res.ok && isAuthResponse(res.body)) {
      setAuth(res.body.user, res.body.tokens);
      setPreviousRefresh(null);
      setReuseLines(null);
    }
  }

  // Одна ротація: нова пара токенів, старий refresh стає "спаленим". Повертає старий refresh або null, якщо не вийшло.
  async function rotate(): Promise<string | null> {
    if (!auth.tokens) return null;
    const old = auth.tokens.refreshToken;
    const res = await latency.track(apiCall('POST', '/auth/refresh', { body: { refreshToken: old }, auth: false }));
    // /auth/refresh віддає тільки нову пару токенів, без user.
    if (res.ok && isTokens(res.body)) {
      setAuth(null, res.body);
      setPreviousRefresh(old);
      setReuseLines(null);
      return old;
    }
    return null;
  }

  async function refresh() {
    setRunning(true);
    try {
      await rotate();
    } finally {
      setRunning(false);
    }
  }

  // Сценарій крадіжки цілком: (якщо ще не було ротації, робимо її), потім пред'являємо старий refresh,
  // потім перевіряємо, що новий теж мертвий, а access ще живий, і логінимось знову, щоб читач не вилетів.
  async function stealAndReuse() {
    if (!auth.tokens || !auth.user) return;
    setRunning(true);
    try {
      const userEmail = auth.user.email;
      const stolen = previousRefresh ?? (await rotate());
      if (!stolen) return;
      const lines: string[] = [];
      const reuse = await latency.track(apiCall('POST', '/auth/refresh', { body: { refreshToken: stolen }, auth: false }));
      if (reuse.status !== 401) {
        setReuseLines([`Несподівано: ${reuse.status}. Ротація не спрацювала.`]);
        return;
      }
      lines.push("401: старий refresh відхилено. Сервер вважає це крадіжкою і відкликав усю сім'ю токенів.");
      const current = getAuthState().tokens?.refreshToken;
      if (current) {
        const second = await latency.track(apiCall('POST', '/auth/refresh', { body: { refreshToken: current }, auth: false }));
        lines.push(`Новий refresh, який щойно був справжнім: ${second.status}. Він теж мертвий, це навмисно.`);
      }
      const me = await latency.track(apiCall('GET', '/auth/me'));
      lines.push(`Access-токен, виданий разом з ним: GET /auth/me дає ${me.status}. Його не відкликати, він доживе свої 15 хв.`);
      const login = await latency.track(apiCall('POST', '/auth/login', { body: { email: userEmail, password }, auth: false }));
      if (login.ok && isAuthResponse(login.body)) {
        setAuth(login.body.user, login.body.tokens);
        lines.push(`Щоб ти не вилетів, панель увійшла знову як ${userEmail}.`);
      } else {
        clearAuth();
        lines.push('Повторний вхід не вдався, тому тебе розлогінило. Увійди через форму вище.');
      }
      setPreviousRefresh(null);
      setReuseLines(lines);
    } finally {
      setRunning(false);
    }
  }

  async function me() {
    await latency.track(apiCall('GET', '/auth/me'));
  }

  async function forge() {
    if (!auth.tokens) return;
    const forged = forgeRole(auth.tokens.accessToken);
    if (!forged) return;
    setForgedRole(forged.role);
    await forgeLatency.track(apiCall('GET', '/auth/me', { auth: false, headers: { Authorization: `Bearer ${forged.token}` } }));
  }

  function fillSeed(seedEmail: string, name: string) {
    setEmail(seedEmail);
    setDisplayName(name);
    setPassword('password123');
  }

  const busy = latency.busy || running;

  return (
    <>
      <PageTitle title="Старт" sub="Реєстрація і логін, JWT усередині, refresh з ротацією" />
      <Concept
        what={
          <>
            <p>
              Сервер мусить знати, хто робить запит. Тому після логіну він видає клієнту два токени, і клієнт додає один із них до кожного запиту. Access-токен
              це короткий пропуск. Refresh-токен потрібен тільки для того, щоб без пароля отримати новий пропуск.
            </p>
            <p>
              Access-токен це JWT: рядок із трьох частин через крапку, header.payload.signature. Перші дві частини це просто JSON у base64, тож їх може прочитати
              будь-хто, і в payload не кладуть нічого таємного. Третя частина це підпис: хеш від перших двох частин із секретом, який знає тільки сервер. Якщо
              змінити в payload роль з user на admin, підпис не зійдеться і сервер відхилить токен. Тому JWT можна читати, але не можна підробити.
            </p>
            <p>Сервер access-токен ніде не зберігає. Щоб його перевірити, достатньо порахувати підпис наново, без запиту до бази.</p>
          </>
        }
        when={
          <>
            <p>
              JWT добре підходить, коли серверів кілька: api-1 і api-2 перевіряють токен самі, їм не потрібна спільна таблиця сесій. Ціна в тому, що access не
              можна відкликати до кінця його життя. Тому він живе 15 хвилин: вкрадений токен працює максимум чверть години. А просити пароль кожні 15 хвилин
              не можна, тому є refresh, який живе 30 днів.
            </p>
            <p>
              Якщо сервер один, а клієнт один сайт, звичайна сесія (cookie з id, дані в Redis) простіша і вбивається миттєво. JWT там нічого не дає, лише додає
              проблему з відкликанням.
            </p>
          </>
        }
        how={
          <>
            <p>
              Логін перевіряє пароль через bcrypt (близько 50-100 мс на хеш, навмисно повільно) і видає пару: access на 15 хвилин і refresh з 32 випадкових байтів.
              У базі лежить тільки sha256 від refresh. Якщо базу витягнуть, по хешах токени не відновити.
            </p>
            <p>
              Кожен refresh можна використати рівно один раз. Він видає нову пару і позначає старий токен як використаний (поле used_at). Усі токени одного логіну
              належать до однієї сім'ї.
            </p>
            <p>
              Навіщо так. Refresh живе 30 днів, тож його крадіжка найнебезпечніша. Без ротації вкрадений токен працював би місяць, і ніхто б цього не помітив. З
              ротацією справжній клієнт і злодій не можуть обидва мати «останній» токен. Хто прийде другим зі старим токеном, отримає 401.
            </p>
            <p>
              Сервер не знає, хто з двох злодій. Тому він відкликає всю сім'ю: логінитись наново мусять обидва. Це навмисно, незручність для одного користувача
              краща за тихий доступ чужого. Побічний ефект: клієнт, який двічі надіслав той самий refresh (подвійний клік, повтор після таймауту), теж вилетить.
              Тому оновлювати токен має одне місце у фронтенді.
            </p>
            <p className="small muted">
              Сід має користувачів admin@, olena@, taras@, iryna@devhub.local з паролем password123. Admin потрібен для сторінки Кредити.
            </p>
          </>
        }
      />

      <div className="card-grid">
        <Card title="Форма">
          <div className="prose">
            <p>
              Зареєструйся новим email або увійди сід-користувачем. У відповіді будуть user і пара токенів, а шапка праворуч покаже, хто залогінений. 400 означає,
              що тіло не пройшло валідацію (у details назва поля), 409 що email уже зайнятий.
            </p>
          </div>
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
            <button type="button" className="primary" onClick={() => submit('/auth/register')} disabled={busy} data-testid="register">
              Зареєструватись (POST /auth/register)
            </button>
            <button type="button" className="primary" onClick={() => submit('/auth/login')} disabled={busy} data-testid="login">
              Увійти (POST /auth/login)
            </button>
            <button type="button" onClick={me} disabled={!auth.tokens || busy}>
              GET /auth/me
            </button>
          </div>
          <PanelNotes
            where={['src/modules/auth/auth.controller.ts (register, login, me)', 'src/modules/auth/auth.service.ts (bcrypt, issueTokens)', 'src/modules/auth/dto/']}
            tryItems={[
              <>Натисни «Зареєструватись» з email olena@devhub.local. Очікуй 409 EMAIL_TAKEN.</>,
              <>
                Увійди з неправильним паролем, потім з неіснуючим email. Повідомлення однакове: сервер не підказує, які email існують.
              </>,
            ]}
          />
        </Card>

        <Card title="JWT розкодований і підроблений">
          <div className="prose">
            <p>
              Тут видно три частини токена. Payload читається без жодного секрету, а лічильник показує, скільки лишилось до exp (з 15:00 до нуля). Кнопка нижче бере
              твій токен, міняє в payload роль і лишає старий підпис.
            </p>
          </div>
          {!decoded && (
            <>
              <NeedAuth />
              <div className="muted">Токена ще немає.</div>
            </>
          )}
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
              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" className="danger" onClick={() => void forge()} disabled={forgeLatency.busy} data-testid="forge">
                  Підробити роль у payload і надіслати
                </button>
              </div>
              {forgedRole && (
                <div className="muted small">
                  Надіслано GET /auth/me з payload, де role = {forgedRole}, і з підписом від справжнього токена. Сервер порахував підпис і побачив розбіжність.
                </div>
              )}
              {forgeLatency.exchange && <Panel exchange={forgeLatency.exchange} busy={forgeLatency.busy} />}
            </>
          )}
          <PanelNotes
            where={['src/modules/auth/jwt.service.ts (sign, verify: HS256)', 'src/modules/auth/jwt-auth.guard.ts', 'src/modules/config/config.schema.ts (JWT_SECRET, JWT_ACCESS_TTL_SECONDS)']}
            tryItems={[
              <>Постав JWT_ACCESS_TTL_SECONDS=30 у .env, перезапусти API, залогінься і через пів хвилини натисни GET /auth/me. Лічильник дійде до нуля, і буде 401.</>,
              <>Натисни «Підробити»: очікуй 401 «Токен невалідний або протермінований», хоч payload читається ідеально.</>,
            ]}
          />
        </Card>
      </div>

      <Card title="Refresh з ротацією і крадіжка токена">
        <div className="prose">
          <p>
            «Оновити пару» робить одну ротацію: нова пара токенів, а попередній refresh стає спаленим (нижче видно обидва). Друга кнопка розігрує крадіжку: пред'являє
            спалений refresh і показує, що сервер зробив із сім'єю. Вона сама робить ротацію, якщо її ще не було.
          </p>
        </div>
        <NeedAuth />
        <div className="row">
          <button type="button" className="primary" onClick={() => void refresh()} disabled={!auth.tokens || busy} data-testid="refresh">
            Оновити пару (POST /auth/refresh)
          </button>
          <button type="button" className="danger" onClick={() => void stealAndReuse()} disabled={!auth.tokens || !auth.user || busy} data-testid="reuse">
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
        {reuseLines && (
          <div className="note err" data-testid="reuse-result">
            {reuseLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelNotes
          where={['src/modules/auth/auth.service.ts (refresh: used_at, revoked_at, familyId)', 'src/modules/auth/refresh-token.entity.ts (token_hash, family_id)']}
          tryItems={[
            <>Натисни «Оновити пару» тричі: refresh щоразу новий, а в таблиці refresh_tokens з'являються три рядки з used_at, окрім останнього.</>,
            <>Після крадіжки подивись у refresh_tokens: у всіх рядків сім'ї заповнений revoked_at.</>,
          ]}
        />
      </Card>
    </>
  );
}
