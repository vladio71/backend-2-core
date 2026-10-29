# Деплой

CI (`.github/workflows/ci.yml`): на push і PR: `npm ci`, lint, build, unit, int, e2e з сервісами `pgvector/pgvector:pg16` і `redis:7`.

Deploy (`.github/workflows/deploy.yml`): після успішного CI на `main`: ssh на сервер, `git pull`, `docker compose up -d --build`. Секрети репозиторію: `SSH_HOST`, `SSH_USER`, `SSH_KEY` (приватний ключ, публічний у `~/.ssh/authorized_keys` на сервері), необов'язково `APP_DIR`.

## 1. Будь-який Ubuntu VPS

1. Сервер: Ubuntu 22.04 або 24.04, 2 GB RAM мінімум (Postgres + Redis + 2 API + worker + nginx).
2. Користувач і ключ:
   ```
   adduser deploy && usermod -aG sudo deploy
   mkdir -p /home/deploy/.ssh && cat your_key.pub >> /home/deploy/.ssh/authorized_keys
   chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
   ```
3. Docker:
   ```
   curl -fsSL https://get.docker.com | sh
   usermod -aG docker deploy
   ```
   Перелогінься, перевір `docker compose version`.
4. Код:
   ```
   git clone https://github.com/<you>/devhub-core.git ~/devhub && cd ~/devhub
   cp .env.example .env
   ```
   У `.env` постав `JWT_SECRET` (`openssl rand -hex 32`), `NODE_ENV=production`, `CORS_ORIGINS=https://your-domain`. Compose бере `JWT_SECRET`, `GITHUB_TOKEN`, `OPENAI_API_KEY` з оточення або `.env` поруч із `docker-compose.yml`.
5. Перший запуск: `docker compose up -d --build`. Сервіс `migrate` накотить міграції і сід, потім стартують API. Перевір `curl localhost:8080/health`.
6. Firewall: `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable`. Порти 5432 і 6379 у compose прокинуті на хост для зручності; на сервері прибери ці `ports:` або обмеж `127.0.0.1:5432:5432`.
7. HTTPS: простіший шлях, окремий nginx на хості перед compose-nginx:
   ```
   apt install -y nginx certbot python3-certbot-nginx
   ```
   Конфіг `/etc/nginx/sites-available/devhub`:
   ```
   server {
     server_name your-domain;
     location / {
       proxy_pass http://127.0.0.1:8080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_buffering off;
       proxy_read_timeout 3600s;
     }
   }
   ```
   `ln -s` у `sites-enabled`, `nginx -t && systemctl reload nginx`, потім `certbot --nginx -d your-domain`. Certbot сам додасть 443 і редірект з 80. Оновлення сертифіката автоматичне (`systemctl list-timers | grep certbot`).
8. Secrets у GitHub: `SSH_HOST` (ip), `SSH_USER` (`deploy`), `SSH_KEY` (вміст приватного ключа). Push у `main` зробить деплой.

## 2. AWS EC2 (free plan 2026)

Увага: новий AWS-акаунт потребує верифікації картки і може чекати схвалення до доби. Доки акаунт не схвалено, усе працює локально через `docker compose`; нічого в проєкті не залежить від AWS.

1. Консоль EC2 -> Launch instance. Ubuntu 24.04, тип з free plan (на 2026 рік це `t3.micro` або `t4g.small`; `t4g` це ARM, образ `node:22-alpine` і `pgvector/pgvector:pg16` мають arm64-версії). 1 GB RAM замало для всіх сервісів разом; у `docker-compose.yml` можна тимчасово прибрати `api-2` або додати swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`.
2. Key pair: створи, скачай `.pem`. Security group: inbound `22` (тільки твій IP), `80`, `443` з будь-де. Порти 5432/6379 НЕ відкривати.
3. Elastic IP (безкоштовний, поки прив'язаний до запущеного інстансу) -> прив'яжи до інстансу, щоб IP не мінявся після перезапуску.
4. `ssh -i key.pem ubuntu@<elastic-ip>`. Далі кроки 3-7 з розділу VPS (Docker, clone, `.env`, `docker compose up -d --build`, ufw не обов'язковий, бо є security group; nginx + certbot так само).
5. DNS: A-запис домену на Elastic IP, потім `certbot --nginx -d your-domain`.
6. GitHub secrets: `SSH_HOST` = Elastic IP, `SSH_USER` = `ubuntu`, `SSH_KEY` = вміст `.pem`.
7. Що стежити: free plan обмежений годинами на місяць і трафіком; `Billing -> Budgets` постав alert на 1 USD.

## Перевірка після деплою
```
curl https://your-domain/health
open https://your-domain/reference
open https://your-domain/demo/live   (3 вкладки)
```
Логи: `docker compose logs -f api-1 worker`. Один `requestId` можна грепнути одразу в обох.
