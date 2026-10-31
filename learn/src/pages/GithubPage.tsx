// Зовнішнє API: ліміти GitHub (primary і secondary), симуляція семафора в браузері і справжній POST /github/import.
import { useState } from 'react';
import { apiCall, errorCode } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, NeedAuth, PageTitle } from '../components/common';
import { PanelFooter, Topic } from '../components/TopicParts';

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
}

interface SimResult {
  label: string;
  peak: number;
  ms: number;
}

const GITHUB_LIMIT = 100;
const TASK_MS = 40;

// Симуляція в браузері: n "запитів" по TASK_MS мс. limit = null: усі одразу (Promise.all), число: не більше стільки у польоті (семафор).
async function simulate(n: number, limit: number | null): Promise<{ peak: number; ms: number }> {
  let inFlight = 0;
  let peak = 0;
  let free = limit ?? n;
  const waiters: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (free > 0) {
      free -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push(resolve));
  };
  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else free += 1;
  };
  const started = performance.now();
  await Promise.all(
    Array.from({ length: n }, async () => {
      await acquire();
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, TASK_MS));
      inFlight -= 1;
      release();
    }),
  );
  return { peak, ms: Math.round(performance.now() - started) };
}

export function GithubPage() {
  return (
    <>
      <PageTitle title="Зовнішнє API (GitHub)" sub="Два види лімітів, семафор, бюджети на годину і хвилину, повтор по Retry-After" />

      <h2>Ліміти GitHub і як з ними жити</h2>
      <Topic
        what={
          <>
            GitHub захищається двома шарами. <b>Primary</b>: квота на годину, 5000 запитів з токеном і 60 без. <b>Secondary</b>: захист від сплесків, не більше 100
            одночасних запитів і не більше 900 поінтів на хвилину (GET коштує 1 поінт, POST, PATCH, PUT, DELETE по 5). Тобто навіть маючи 4000 запитів квоти, відправити
            їх за секунду не вийде.
          </>
        }
        when={
          <>
            Клієнтські обмеження потрібні, коли йдеш у чужий API багато разів поспіль: імпорт, синхронізація, масова обробка. Не потрібні, коли викликів мало, наприклад
            один запит на дію користувача. Тоді досить обробити 429. Наївний <code>Promise.all</code> на 500 запитів отримає 403, а якщо наполягати, то й тимчасовий бан.
          </>
        }
        how={
          <>
            Кожен виклик бере 1 з годинного бюджету (5000 або 60 залежно від GITHUB_TOKEN), 1 з хвилинного (900) і місце в семафорі на 100. Якщо GitHub все одно
            відповів 429 або 403 з Retry-After, клієнт чекає стільки секунд і повторює, до 3 разів, далі 502 GITHUB_RATE_LIMITED.
          </>
        }
        extra={
          <>
            <p>
              <b>Чесне обмеження.</b> Семафор і обидва бюджети живуть у пам’яті процесу. API запущено у двох процесах (api-1 і api-2), тож кожен вважає, що має весь
              ліміт, і разом вони можуть витратити вдвічі більше. Щоб рахувати точно, лічильник виносять у Redis, як зроблено для rate limit користувачів.
            </p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ліміт GitHub</th>
                  <th>Тип</th>
                  <th>Значення</th>
                  <th>Що робить клієнт</th>
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
                  <td>Поінтів на хвилину</td>
                  <td>secondary</td>
                  <td>900</td>
                  <td className="mono">WindowBudget(900, 1 хв)</td>
                </tr>
                <tr>
                  <td>Одночасних запитів</td>
                  <td>secondary</td>
                  <td>100</td>
                  <td className="mono">Semaphore(100)</td>
                </tr>
                <tr>
                  <td>Перевищили</td>
                  <td></td>
                  <td>429 або 403 з Retry-After</td>
                  <td>чекає стільки секунд, до 3 повторів</td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">
              Документація:{' '}
              <a href="https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api" target="_blank" rel="noreferrer">
                Rate limits for the REST API
              </a>
              .
            </p>
          </>
        }
      />
      <SemaphoreCard />

      <h2>Справжній імпорт</h2>
      <Topic
        what="Імпорт забирає публічні репозиторії користувача GitHub посторінково (по 100) і зберігає їх у таблицю github_repos. Якщо репозиторій уже є, запис оновлюється, а не дублюється (UPSERT по парі owner, name)."
        when="Подібний імпорт потрібен, коли дані з зовнішнього сервісу треба показувати швидко і без залежності від його доступності. Для разового перегляду зберігати копію не треба."
        how={
          <>
            Усі запити до GitHub йдуть через один клієнт з лімітами. Один імпорт коштує по запиту на кожні 100 репозиторіїв, максимум 10 запитів. Друга кнопка читає вже збережене
            з бази, без походу в GitHub.
          </>
        }
      />
      <ImportCard />
    </>
  );
}

function SemaphoreCard() {
  const [n, setN] = useState(500);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SimResult[]>([]);

  async function run(limit: number | null) {
    setBusy(true);
    const r = await simulate(n, limit);
    setResults((prev) => [{ label: limit === null ? 'Promise.all, без обмеження' : `семафор ${limit}`, ...r }, ...prev].slice(0, 6));
    setBusy(false);
  }

  return (
    <Card title="Симуляція: 500 запитів без обмеження і через семафор">
      <div className="prose">
        <p>
          Це симуляція в браузері, не справжні запити до GitHub: кожен "запит" триває {TASK_MS} мс. Дивись на peak, найбільше запитів у польоті одночасно. GitHub
          терпить {GITHUB_LIMIT}. Більше означає 403 від secondary ліміту.
        </p>
      </div>
      <div className="row">
        <label>
          запитів
          <select value={n} onChange={(e) => setN(Number(e.target.value))} disabled={busy}>
            {[50, 150, 500, 1000].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="danger" onClick={() => void run(null)} disabled={busy} data-testid="sim-all">
          Усі одразу
        </button>
        <button type="button" className="primary" onClick={() => void run(GITHUB_LIMIT)} disabled={busy} data-testid="sim-sem">
          Через семафор {GITHUB_LIMIT}
        </button>
      </div>
      {results.length > 0 && (
        <table className="tbl" data-testid="sim-results">
          <thead>
            <tr>
              <th>спосіб</th>
              <th>peak у польоті</th>
              <th>час</th>
              <th>що сказав би GitHub</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.label}</td>
                <td className="mono">{r.peak}</td>
                <td className="mono">{r.ms} мс</td>
                <td>{r.peak > GITHUB_LIMIT ? <span style={{ color: 'var(--err)' }}>403: secondary limit, ризик бану</span> : <span style={{ color: 'var(--ok)' }}>нормально</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PanelFooter
        paths={['src/modules/github/semaphore.ts (Semaphore, WindowBudget)', 'src/modules/github/github.client.ts (MAX_CONCURRENT, POINTS_PER_MINUTE, retry)', 'src/modules/github/semaphore.spec.ts']}
        tries={[
          'Підбери 1000 запитів: через семафор вони йдуть вп’ятеро довше за 150, а peak той самий 100.',
          'Запусти npx jest semaphore у корені проєкту і подивись, як тест перевіряє, що більше за ліміт одночасно не виконується.',
        ]}
      />
    </Card>
  );
}

function ImportCard() {
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
      setProblem('502 GITHUB_RATE_LIMITED: GitHub обмежив запити, і 3 повтори не допомогли. Без токена анонімний ліміт лише 60 запитів на годину на IP.');
    } else if (res.status === 502 && code === 'GITHUB_NOT_FOUND') {
      setProblem(`502 GITHUB_NOT_FOUND: користувача "${username}" на GitHub немає.`);
    } else if (res.status === 502) {
      setProblem(
        '502: GitHub не віддав репозиторії. Найчастіше причина в токені: GITHUB_TOKEN не заданий або невалідний, або з сервера немає виходу в GitHub. Це не помилка коду, а відсутня конфігурація.',
      );
    } else if (res.status === 0) {
      setProblem('API недоступний: перевір адресу в шапці.');
    }
  }

  async function loadRepos() {
    const res = await latency.track(apiCall('GET', `/github/repos/${username}`, { auth: false }));
    if (res.ok) setRepos(res.body as RepoRow[]);
  }

  return (
    <Card title="POST /github/import">
      <div className="prose">
        <p>
          Дивись на imported (скільки записів збережено) і на client: retries більше 0 означає, що GitHub відповів 429 або 403, і клієнт почекав Retry-After. Без
          GITHUB_TOKEN ліміт 60 запитів на годину на IP, тому після кількох імпортів великих акаунтів може прийти помилка ліміту: це нормально.
        </p>
      </div>
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
          <p>{problem}</p>
          <p>
            <b>Що зробити.</b> Створи на GitHub токен (Settings, Developer settings, Personal access tokens, fine-grained, без жодних прав: для публічних
            репозиторіїв вони не потрібні). Запиши його в <code>.env</code> бекенду як <code>GITHUB_TOKEN=...</code> і перезапусти API. Ліміт стане 5000 на
            годину. У docker compose змінну читає <code>.env</code> поруч із docker-compose.yml.
          </p>
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
      <PanelFooter
        paths={['src/modules/github/github.service.ts (importUser, UPSERT)', 'src/modules/github/github.controller.ts', 'src/modules/github/github-repo.entity.ts']}
        tries={[
          'Імпортуй два рази той самий username і порівняй imported: кількість рядків у таблиці не подвоюється, бо UPSERT.',
          'Постав свій GITHUB_TOKEN, перезапусти API і повтори: якщо 502 зник, причиною був токен.',
        ]}
      />
    </Card>
  );
}
