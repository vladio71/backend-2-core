// Безпека: демо SQL-ін'єкції (safe проти unsafe) і що ще робить бекенд (helmet, CORS, bcrypt).
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, Explain, PageTitle, WhereInCode } from '../components/common';

interface InjectionResponse {
  safe: boolean;
  sql: string;
  rows: Array<{ id: string; email: string }>;
}

export function SecurityPage() {
  const latency = useLatency();
  const [q, setQ] = useState("' OR 1=1 --");
  const [unsafe, setUnsafe] = useState<InjectionResponse | null>(null);
  const [safe, setSafe] = useState<InjectionResponse | null>(null);
  const [missing, setMissing] = useState(false);

  async function run(isSafe: boolean) {
    setMissing(false);
    const res = await latency.track(apiCall('GET', '/demo/sql-injection', { query: { safe: isSafe, q }, auth: false }));
    if (res.status === 404) {
      setMissing(true);
      return;
    }
    if (!res.ok) return;
    if (isSafe) setSafe(res.body as InjectionResponse);
    else setUnsafe(res.body as InjectionResponse);
  }

  return (
    <>
      <PageTitle title="Безпека" sub="Параметризовані запити, helmet, CORS, bcrypt" />
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> Параметр ніколи не стає частиною SQL: Postgres отримує текст запиту (<code>WHERE email = $1</code>) і значення окремо.
        </p>
        <p>
          Якщо ж значення склеїти в рядок, <code>' OR 1=1 --</code> перетворює умову на "завжди істина" і коментує решту.
        </p>
        <ul>
          <li>
            <b>helmet()</b> ставить безпечні заголовки (X-Content-Type-Options, Strict-Transport-Security, ...). CSP вимкнено, бо Scalar і демо-сторінка
            вантажать скрипти з CDN; у своєму фронтенді вмикайте.
          </li>
          <li>
            <b>CORS</b>: список origin-ів зі змінної CORS_ORIGINS. Цей фронтенд на :5173 є у списку типово; нестандартні заголовки (X-Cache, X-RateLimit-*)
            браузер бачить тільки через exposedHeaders.
          </li>
          <li>
            <b>bcrypt</b> з BCRYPT_COST=10 (2^10 раундів, 50-100 мс на хеш). Повільний навмисно, сіль усередині: перебір дорогий, однакові паролі дають різні
            хеші. Ніколи md5/sha1/sha256 для паролів.
          </li>
          <li>Refresh-токени зберігаються як sha256 (тут хеш доречний: токен випадковий і довгий), щоб витік БД не давав сесій.</li>
          <li>
            Валідація з whitelist і forbidNonWhitelisted: клієнт не підкине <code>role: "admin"</code> у реєстрацію.
          </li>
          <li>Однакова 401 для "немає користувача" і "не той пароль". Токени і паролі ніколи не пишуться в логи.</li>
        </ul>
        <WhereInCode paths={['src/app-setup.ts (helmet, CORS, ValidationPipe)', 'modules/security/sql-injection.controller.ts', 'auth/auth.service.ts (bcrypt, sha256)']} />
      </Explain>

      <Card title="SQL-ін'єкція: safe проти unsafe">
        <div className="prose">
          <p>
            Один і той самий payload іде в один ендпоінт у двох режимах: safe передає його параметром, unsafe склеює в рядок SQL. Добре, коли safe повертає порожній список
            (такого email немає), а unsafe повертає всіх користувачів: це і є ін'єкція. Порівняй текст SQL в обох відповідях.
          </p>
        </div>
        <div className="note">
          <code>GET /demo/sql-injection</code> існує ТІЛЬКИ при <code>NODE_ENV=development</code> (<code>SecurityModule.forEnv</code>: у production контролера
          немає в застосунку взагалі).
        </div>
        <div className="row">
          <label>
            q (payload)
            <input className="mono" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} data-testid="payload" />
          </label>
          <button type="button" className="danger" onClick={() => void run(false)} disabled={latency.busy} data-testid="unsafe">
            safe=false (склеєний рядок)
          </button>
          <button type="button" className="primary" onClick={() => void run(true)} disabled={latency.busy} data-testid="safe">
            safe=true ($1)
          </button>
        </div>
        {missing && <div className="note err">404: бекенд запущений не в development, контролера немає.</div>}
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>SQL, який пішов у Postgres</th>
              <th>Результат</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">safe=false</td>
              <td className="mono" data-testid="unsafe-sql">
                {unsafe?.sql ?? '?'}
              </td>
              <td data-testid="unsafe-rows">{unsafe ? `${unsafe.rows.length} рядків: ${unsafe.rows.map((r) => r.email).join(', ')}` : '?'}</td>
            </tr>
            <tr>
              <td className="mono">safe=true</td>
              <td className="mono" data-testid="safe-sql">
                {safe?.sql ?? '?'}
              </td>
              <td data-testid="safe-rows">{safe ? `${safe.rows.length} рядків` : '?'}</td>
            </tr>
          </tbody>
        </table>
        <Panel exchange={latency.exchange} busy={latency.busy} />
      </Card>
    </>
  );
}
