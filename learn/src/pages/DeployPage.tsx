// Деплой: статична сторінка за docs/deploy.md і .github/workflows/deploy.yml. Кроки CI розібрані на сторінці "Тести і CI".
import { Link } from 'react-router-dom';
import { Card, PageTitle } from '../components/common';
import { PanelFooter, Topic } from '../components/TopicParts';

const DEPLOY_DOC = 'https://github.com/vladio71/backend-2-core/blob/main/docs/deploy.md';

const VPS_STEPS: Array<[string, string]> = [
  ['Сервер і Docker', 'Ubuntu 22.04 або 24.04, 2 GB RAM мінімум. Користувач deploy з твоїм публічним ключем у ~/.ssh/authorized_keys, потім curl -fsSL https://get.docker.com | sh'],
  ['Код і .env', 'git clone, cp .env.example .env. У .env: JWT_SECRET (openssl rand -hex 32), NODE_ENV=production, CORS_ORIGINS=https://your-domain'],
  ['Перший запуск', 'docker compose up -d --build. Сервіс migrate накотить міграції і сід, потім стартують API. Перевір: curl localhost:8080/health'],
  ['Firewall', 'ufw allow 22, 80, 443. Порти 5432 і 6379 на сервері прибери з compose або обмеж до 127.0.0.1'],
  ['HTTPS', 'nginx на хості перед compose-nginx (proxy_pass на 127.0.0.1:8080, заголовки Upgrade для WebSocket, proxy_buffering off для SSE), потім certbot --nginx -d your-domain'],
  ['Secrets у GitHub', 'SSH_HOST, SSH_USER, SSH_KEY (приватний ключ), за потреби APP_DIR. Після цього кожен push у main сам деплоїть'],
];

export function DeployPage() {
  return (
    <>
      <PageTitle title="Деплой" sub="Зелений CI на main, потім ssh на сервер, git pull і docker compose up -d --build" />

      <h2>CI і деплой</h2>
      <Topic
        what="Два workflow у GitHub Actions. CI перевіряє код. Деплой викочує його на сервер."
        when="CI потрібен на кожен push і PR, навіть у навчальному проєкті. Автодеплой корисний, коли сервер один і хочеться, щоб main завжди був живий. Для кількох середовищ і відкату він примітивний: там беруть реєстр образів і оркестратор."
        how={
          <>
            <b>CI</b> на кожен push і PR піднімає Postgres і Redis як сервіси job-а і проганяє lint, build та три рівні тестів. Кроки по одному розібрані на сторінці{' '}
            <Link to="/tests">Тести і CI</Link>. <b>Деплой</b> запускається лише після успішного CI на main: ssh на сервер, <code>git pull --ff-only</code>,{' '}
            <code>docker compose up -d --build</code>. Червоний CI означає, що на сервер нічого не поїде.
          </>
        }
      />
      <Card title="Що відбувається після push у main">
        <pre className="code">{`push / PR  ->  CI (ci.yml)                          ->  Deploy (deploy.yml, лише main, лише якщо CI зелений)
               npm ci, lint, build, unit, int, e2e        ssh deploy@server: git pull, docker compose up -d --build`}</pre>
        <div className="muted small" style={{ marginTop: 8 }}>
          Compose піднімає postgres (з pgvector), redis, migrate (міграції і сід), api-1, api-2, worker і nginx, який роздає запити на обидва API по черзі.
        </div>
        <PanelFooter
          paths={['.github/workflows/ci.yml', '.github/workflows/deploy.yml', 'docker-compose.yml', 'nginx/']}
          tries={['Відкрий ci.yml і знайди, чим deploy.yml відрізняється: яка подія його запускає (workflow_run після CI).']}
        />
      </Card>

      <h2>Шість кроків на VPS</h2>
      <Topic
        what="Один звичайний Ubuntu-сервер, на якому живе весь стенд: база, Redis, два API, воркер і nginx."
        when="Підходить для навчання, пет-проєкту і невеликих сервісів. Коли навантаження росте, базу виносять в окремий керований сервіс, а API масштабують вже не в одному compose."
        how="Той самий docker-compose.yml, що й локально. Різниця лише в .env і в тому, що перед compose-nginx стоїть nginx із сертифікатом."
      />
      <Card title="Чекліст">
        <ul className="checklist">
          {VPS_STEPS.map(([step, what], index) => (
            <li key={step}>
              <span>
                <b>
                  {index + 1}. {step}
                </b>
                <br />
                <span className="muted small">{what}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="muted small" style={{ marginTop: 8 }}>
          Повні команди і конфіг nginx:{' '}
          <a href={DEPLOY_DOC} target="_blank" rel="noreferrer">
            docs/deploy.md
          </a>
          .
        </div>
        <PanelFooter
          paths={['docs/deploy.md (повні команди)', 'docker-compose.yml', '.env.example']}
          tries={['Після деплою відкрий /reference і /health на своєму домені, а в docker compose logs -f api-1 worker знайди один requestId в обох сервісах.']}
        />
      </Card>

      <h2>AWS EC2</h2>
      <Topic
        what="Той самий VPS, але на AWS: інстанс EC2 з Ubuntu."
        when="Потрібен, лише якщо вже є AWS-акаунт. Нічого в проєкті від AWS не залежить, і весь стенд працює локально через docker compose."
        how="Free plan: новий акаунт проходить перевірку картки і може чекати схвалення до доби. Доки акаунт не схвалено, працюй локально."
      />
      <Card title="Що змінюється на AWS">
        <ul>
          <li>Ubuntu 24.04, t3.micro або t4g.small (ARM, образи мають arm64-версії). 1 GB RAM замало: прибери api-2 з compose або додай swap 2 GB.</li>
          <li>Security group: 22 тільки з твого IP, 80 і 443 звідусіль, 5432 і 6379 не відкривай. Elastic IP, щоб адреса не мінялась після перезапуску.</li>
          <li>Далі ті ж шість кроків, лише SSH_USER = ubuntu, а SSH_KEY = вміст .pem. У Billing постав Budget з alert на 1 USD.</li>
        </ul>
        <PanelFooter paths={['docs/deploy.md (розділ 2, AWS EC2)']} tries={['Перед створенням інстансу постав Budget на 1 USD: це єдине, що вбереже від несподіваного рахунку.']} />
      </Card>
    </>
  );
}
