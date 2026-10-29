// Зовнішнє API: POST /github/import тягне репозиторії користувача під лімітами GitHub (семафор, бюджети, retry).
import { useState } from 'react';
import { apiCall, errorCode } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, Explain, NeedAuth, PageTitle } from '../components/common';

interface ImportResult {
  username: string;
  imported: number;
  client: { inFlight: number; queued: number; retries: number };
}

interface RepoRow {
  name: string;
  stars?: number;
  language?: string | null;
  description?: string | null;
  htmlUrl?: string;
  url?: string;
}

export function GithubPage() {
  const auth = useAuth();
  const latency = useLatency();
  const [username, setUsername] = useState('vladio71');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  async function runImport() {
    setProblem(null);
    setResult(null);
    const res = await latency.track(apiCall('POST', '/github/import', { body: { username } }));
    if (res.ok) {
      setResult(res.body as ImportResult);
      await loadRepos();
      return;
    }
    const code = errorCode(res);
    if (res.status === 502 && code === 'GITHUB_RATE_LIMITED') {
      setProblem(
        '502 GITHUB_RATE_LIMITED: GitHub обмежив запити і 3 повтори не допомогли. Без GITHUB_TOKEN анонімний ліміт лише 60 запитів/год на IP. Постав GITHUB_TOKEN у .env бекенду (classic або fine-grained, без прав) і перезапусти API: буде 5000/год.',
      );
    } else if (res.status === 502 && code === 'GITHUB_NOT_FOUND') {
      setProblem(`502 GITHUB_NOT_FOUND: користувача "${username}" на GitHub немає.`);
    } else if (res.status === 502 && JSON.stringify(res.body).includes('401')) {
      setProblem(
        '502 GITHUB_ERROR з 401 від GitHub: токен у GITHUB_TOKEN бекенду невалідний або протермінований. Прибери його (анонімно, 60/год) або встав робочий.',
      );
    } else if (res.status === 502) {
      setProblem('502: GitHub відповів помилкою або недоступний з сервера (немає мережі, проксі). Деталі в тілі відповіді нижче.');
    } else if (res.status === 0) {
      setProblem('API недоступний: перевір адресу в шапці.');
    }
  }

  async function loadRepos() {
    const res = await latency.track(apiCall('GET', `/github/repos/${username}`, { auth: false }));
    if (res.ok) setRepos(res.body as RepoRow[]);
  }

  return (
    <>
      <PageTitle title="Зовнішнє API (GitHub)" sub="Семафор, бюджети на годину і хвилину, retry по Retry-After" />
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> <code>POST /github/import {'{ username }'}</code> ходить у <code>GET /users/:username/repos?per_page=100</code>{' '}
          посторінково і робить UPSERT у <code>github_repos</code> по <code>(owner, name)</code>. Кожен виклик проходить через <code>Semaphore(100)</code> (не
          більше 100 у польоті), <code>WindowBudget</code> на годину і на хвилину, а 429/403 з <code>Retry-After</code> дає паузу і повтор до 3 разів.
        </p>
        <table className="tbl" style={{ marginBottom: 10 }}>
          <thead>
            <tr>
              <th>Ліміт GitHub</th>
              <th>Тип</th>
              <th>Значення</th>
              <th>Що робимо</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Запитів на годину</td>
              <td>primary</td>
              <td>5000 з токеном, 60 без</td>
              <td className="mono">WindowBudget(5000 або 60, 1 год)</td>
            </tr>
            <tr>
              <td>Поінтів на хвилину для REST</td>
              <td>secondary</td>
              <td>900 (GET = 1, POST/PATCH/PUT/DELETE = 5)</td>
              <td className="mono">WindowBudget(900, 1 хв)</td>
            </tr>
            <tr>
              <td>Одночасних запитів</td>
              <td>secondary</td>
              <td>100</td>
              <td className="mono">Semaphore(100)</td>
            </tr>
            <tr>
              <td>Відповідь при перевищенні</td>
              <td></td>
              <td>429 або 403 з Retry-After</td>
              <td>чекаємо стільки секунд, повтор до 3 разів</td>
            </tr>
          </tbody>
        </table>
        <p>
          Primary ліміт це квота на годину (заголовки <code>x-ratelimit-remaining</code>/<code>x-ratelimit-reset</code>). Secondary ліміти захищають GitHub від
          сплесків: навіть маючи 4000 запитів квоти, не можна відправити їх за секунду. <code>Promise.all(500 запитів)</code> отримає 403 і, якщо продовжувати,
          тимчасовий бан. Документація:{' '}
          <a href="https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api" target="_blank" rel="noreferrer">
            Rate limits for the REST API
          </a>
          .
        </p>
      </Explain>

      <Card title="Імпорт">
        <NeedAuth />
        <div className="row">
          <label>
            username на GitHub
            <input value={username} onChange={(e) => setUsername(e.target.value)} data-testid="username" />
          </label>
          <button type="button" className="primary" onClick={() => void runImport()} disabled={!auth.tokens || latency.busy} data-testid="import">
            {latency.busy ? 'імпортую...' : 'POST /github/import'}
          </button>
          <button type="button" onClick={() => void loadRepos()} disabled={latency.busy}>
            GET /github/repos/:owner (з таблиці)
          </button>
        </div>
        {problem && (
          <div className="note err" data-testid="problem">
            {problem}
          </div>
        )}
        {result && (
          <div className="cols-3" style={{ marginBottom: 12 }}>
            <div className="col">
              <h3>imported</h3>
              <div className="big">{result.imported}</div>
            </div>
            <div className="col">
              <h3>client</h3>
              <div className="mono small">
                inFlight {result.client.inFlight}, queued {result.client.queued}, retries {result.client.retries}
              </div>
            </div>
            <div className="col">
              <h3>username</h3>
              <div className="mono">{result.username}</div>
            </div>
          </div>
        )}
        {repos.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>name</th>
                <th>language</th>
                <th>stars</th>
                <th>description</th>
              </tr>
            </thead>
            <tbody>
              {repos.slice(0, 20).map((r) => (
                <tr key={r.name}>
                  <td className="mono">{r.name}</td>
                  <td>{r.language ?? ''}</td>
                  <td className="mono">{r.stars ?? ''}</td>
                  <td className="small">{r.description ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
      </Card>
    </>
  );
}
