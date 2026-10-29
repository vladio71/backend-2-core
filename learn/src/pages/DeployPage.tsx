// Деплой і CI: статична сторінка за docs/deploy.md і .github/workflows/ci.yml.
import { Card, Explain, PageTitle } from '../components/common';

const CI_STEPS: Array<[string, string]> = [
  ['actions/checkout@v4, setup-node 22 з кешем npm', 'код і Node'],
  ['сервіси: pgvector/pgvector:pg16 і redis:7 з health-check', 'справжні Postgres і Redis у job-і, не моки'],
  ['npm ci', 'залежності точно за package-lock'],
  ['npm run lint', 'eslint src test scripts'],
  ['npm run build', 'tsc, помилки типів падають тут'],
  ['npm test', 'unit, без БД (jest)'],
  ['npm run test:int', 'міграції і SQL проти справжнього Postgres'],
  ['npm run test:e2e', 'увесь застосунок через HTTP і WebSocket, воркер in-process; PGVECTOR=1 вмикає тест similar'],
];

const VPS_STEPS: Array<[string, string]> = [
  ['Сервер', 'Ubuntu 22.04 або 24.04, 2 GB RAM мінімум (Postgres + Redis + 2 API + worker + nginx)'],
  ['Користувач і ключ', 'adduser deploy, публічний ключ у ~/.ssh/authorized_keys'],
  ['Docker', 'curl -fsSL https://get.docker.com | sh, usermod -aG docker deploy'],
  ['Код', 'git clone у ~/devhub, cp .env.example .env: JWT_SECRET (openssl rand -hex 32), NODE_ENV=production, CORS_ORIGINS=https://your-domain'],
  ['Перший запуск', 'docker compose up -d --build: сервіс migrate накотить міграції і сід, потім стартують API; curl localhost:8080/health'],
  ['Firewall', 'ufw allow 22, 80, 443; порти 5432 і 6379 на сервері прибрати з compose або обмежити 127.0.0.1'],
  [
    'HTTPS',
    'nginx на хості перед compose-nginx з proxy_pass на 127.0.0.1:8080, Upgrade-заголовки для WebSocket, proxy_buffering off для SSE; certbot --nginx -d your-domain',
  ],
  ['Secrets у GitHub', "SSH_HOST, SSH_USER, SSH_KEY (приватний ключ), необов'язково APP_DIR. Push у main зробить деплой"],
];

export function DeployPage() {
  return (
    <>
      <PageTitle title="Деплой і CI" sub="GitHub Actions: lint, build, unit, int, e2e; потім ssh і docker compose up на сервері" />
      <Explain>
        <p>
          <b>Як це працює.</b> Два workflow. <code>ci.yml</code> запускається на кожен push і PR: піднімає Postgres і Redis як сервіси job-а і проганяє усі три
          рівні тестів. <code>deploy.yml</code> запускається тільки після успішного CI на <code>main</code>: заходить на сервер по ssh, робить{' '}
          <code>git pull --ff-only</code> і <code>docker compose up -d --build --remove-orphans</code>. Compose піднімає postgres (pgvector), redis, migrate
          (міграції + сід), api-1, api-2, worker, nginx (round robin на обидва API).
        </p>
        <pre>{`push / PR  ->  CI (ci.yml)                          ->  Deploy (deploy.yml, тільки main, тільки якщо CI зелений)
               npm ci, lint, build, unit, int, e2e        ssh deploy@server: git pull, docker compose up -d --build`}</pre>
      </Explain>

      <div className="card-grid">
        <Card title="CI: кроки (.github/workflows/ci.yml)">
          <ul className="checklist">
            {CI_STEPS.map(([step, why]) => (
              <li key={step}>
                <span>
                  <span className="mono">{step}</span>
                  <br />
                  <span className="muted small">{why}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="muted small" style={{ marginTop: 8 }}>
            Env у CI: NODE_ENV=test, DATABASE_URL на devhub_test, REDIS_URL db 1, QUEUE_MAX_WAITING=3, REPORT_STEP_MS=50 (щоб звіт тривав 250 мс, а не 5 с).
          </div>
        </Card>

        <Card title="Деплой на VPS: чекліст (docs/deploy.md)">
          <ul className="checklist">
            {VPS_STEPS.map(([step, what]) => (
              <li key={step}>
                <span>
                  <b>{step}</b>
                  <br />
                  <span className="muted small">{what}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="AWS EC2 (free plan) і перевірка після деплою">
        <ul>
          <li>
            Ubuntu 24.04 на t3.micro або t4g.small (ARM: образи node:22-alpine і pgvector мають arm64-версії). 1 GB RAM замало: прибрати api-2 або додати swap 2
            GB.
          </li>
          <li>Security group: 22 тільки з твого IP, 80 і 443 звідусіль, 5432 і 6379 НЕ відкривати. Elastic IP, щоб адреса не мінялась після перезапуску.</li>
          <li>Далі ті самі кроки, що для VPS; SSH_USER = ubuntu, SSH_KEY = вміст .pem. Billing, Budgets: alert на 1 USD.</li>
        </ul>
        <pre className="mono" style={{ background: 'var(--bg-code)', padding: 10, borderRadius: 6 }}>{`curl https://your-domain/health
open https://your-domain/reference
open https://your-domain/demo/live   (3 вкладки)
docker compose logs -f api-1 worker  (один requestId видно одразу в обох)`}</pre>
      </Card>
    </>
  );
}
