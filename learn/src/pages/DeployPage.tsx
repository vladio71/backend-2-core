// Деплой: статична сторінка за docs/deploy.md і .github/workflows/deploy.yml. Кроки CI на сторінці "Тести і CI".
import { Link } from 'react-router-dom';
import { Card, Explain, PageTitle, WhereInCode } from '../components/common';

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
      <PageTitle title="Деплой" sub="Після зеленого CI на main: ssh на сервер, git pull і docker compose up -d --build" />
      <Explain>
        <p>
          <b>Як це працює.</b> Два workflow. CI запускається на кожен push і PR: піднімає Postgres і Redis як сервіси job-а і проганяє усі три рівні тестів.
        </p>
        <p>
          Деплой запускається тільки після успішного CI на main: заходить на сервер по ssh, робить <code>git pull --ff-only</code> і{' '}
          <code>docker compose up -d --build</code>. Compose піднімає postgres (pgvector), redis, migrate (міграції + сід), api-1, api-2, worker і nginx (round
          robin на обидва API).
        </p>
        <pre>{`push / PR  ->  CI (ci.yml)                          ->  Deploy (deploy.yml, тільки main, тільки якщо CI зелений)
               npm ci, lint, build, unit, int, e2e        ssh deploy@server: git pull, docker compose up -d --build`}</pre>
        <WhereInCode paths={['.github/workflows/ci.yml', '.github/workflows/deploy.yml', 'docker-compose.yml', 'nginx/']} />
      </Explain>

      <div className="card-grid">
        <Card title="Що робить CI перед деплоєм">
          <p>
            <code>ci.yml</code> на кожен push і PR: npm ci, lint, build, unit, int, e2e проти справжніх Postgres і Redis у job-і. Кроки по одному розібрані на
            сторінці <Link to="/tests">Тести і CI</Link>. <code>deploy.yml</code> чекає саме на цей workflow: червоний CI означає, що на сервер нічого не поїде.
          </p>
          <div className="muted small">Env у CI: NODE_ENV=test, DATABASE_URL на devhub_test, REDIS_URL db 1, QUEUE_MAX_WAITING=3, REPORT_STEP_MS=50.</div>
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
        <pre className="code">{`curl https://your-domain/health
open https://your-domain/reference
open https://your-domain/demo/live   (3 вкладки)
docker compose logs -f api-1 worker  (один requestId видно одразу в обох)`}</pre>
      </Card>
    </>
  );
}
