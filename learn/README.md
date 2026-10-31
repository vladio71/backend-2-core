# devhub learn: навчальний фронтенд до бекенду

Один застосунок на Vite + React 18 + TypeScript, без UI-кітів. Одна сторінка на тему бекенду `devhub`: коротке пояснення, як це працює на сервері, і жива панель, що робить справжні запити до API і показує запит (метод, шлях, параметри, заголовки), відповідь (статус, тіло, важливі заголовки) і час у мс.

Для кого: фронтенд-розробник, який хоче зрозуміти, що відбувається за кожним ендпоінтом, клацаючи кнопки, а не читаючи код.

## Запуск

Потрібен запущений бекенд (`docker compose up` у корені проєкту, або `npm run dev` + `npm run dev:worker` без Docker).

```
cd learn
npm install
npm run dev          # http://localhost:5173
```

Базова адреса API береться з `VITE_API_URL` (скопіюй `.env.example` у `.env`). Типово `http://localhost:8080` (nginx з docker compose). Якщо ця адреса не відповідає, застосунок сам пробує `http://localhost:3000` (API без Docker). Адресу можна змінити в шапці сторінки, вона зберігається в localStorage.

Бекенд має дозволити origin `http://localhost:5173` у `CORS_ORIGINS` (є типово) і віддавати нестандартні заголовки через `exposedHeaders` (`X-Cache`, `X-RateLimit-*`, `Retry-After`, `X-Request-Id`), інакше браузер їх не покаже.

Інші команди:

```
npm run build        # tsc --noEmit + vite build у dist/
npm run lint         # eslint src
npm run verify       # Playwright: проходить усі сторінки, клацає кнопки, пише screenshots/*.png
                     # (потрібні запущені бекенд і dev-сервер, пакет playwright з chromium: npm i -D playwright && npx playwright install chromium)
```

Користувачі з сіду: `admin@devhub.local`, `olena@devhub.local`, `taras@devhub.local`, `iryna@devhub.local`, пароль `password123`. Admin потрібен для поповнення кредитів.

## Сторінки

Порядок навчальний і такий самий, як у README бекенду ("Карта модулів") і в посиланнях "Попередня тема / Наступна тема" у docs/. Внизу кожної сторінки є "Попередня / Наступна" (компонент `PageNav`, порядок береться з `pages/index.ts`).

| # | Сторінка | Що показує |
|---|---|---|
| 1 | Схема проєкту | docs/architecture.excalidraw у Excalidraw тільки для перегляду (зум, панорамування), вписана за шириною; prebuild копіює файл у public/ |
| 2 | Старт | реєстрація і логін, JWT розкодований (header, payload) і відлік до exp, refresh з ротацією, повторне використання старого refresh дає 401 |
| 3 | Конфіг і формат помилок | як застосунок падає на старті з ясним текстом (zod); кнопки на 400, 401, 403, 404, 409, 422, 429; одна форма JSON з requestId; таблиця "коли який код" |
| 4 | Пагінація, сортування, фільтри | q, tags, tagsMode, sort, dir, pageSize; offset проти cursor, точний query string, розкодований курсор |
| 5 | Міграції, час, soft delete | три міграції і команди migration:*, timestamptz і UTC; живий цикл POST, DELETE (204), GET (404), restore (201), GET (200), повторний restore (409) |
| 6 | SQL, N+1 і індекси | звіт posts-per-day (SVG-графік), N+1 (31 запит проти 2), EXPLAIN (Seq Scan проти Index Scan з порівнянням часу) |
| 7 | Кеш | GET /posts/:id/stats з X-Cache HIT/MISS і часом, PATCH інвалідовує кеш |
| 8 | Логи, request-id і health | GET /health по кожній залежності, свій X-Request-Id у запиті повертається у відповіді, як грепнути один запит у логах API і воркера |
| 9 | Тести і CI | три рівні тестів з прикладом на кожен (unit, int, e2e), кроки ci.yml, завдання "напиши сам" з your-turn.e2e-spec.ts |
| 10 | Кредити і локи | баланс, topup (admin), 20 паралельних reserve(10) з підрахунком 201/422, confirm і release резервацій |
| 11 | Черга і воркер: polling, SSE, WebSocket | POST /reports (202) і три спостерігачі одного job-а (polling, SSE, WebSocket) з ціною в запитах; стан черги; flood до QUEUE_FULL; 300 подій для батчингу |
| 12 | Живе: presence і дошка | presence, спільна дошка на canvas (board:draw пачками по 16 мс, board:history, board:clear); відкрий у 3 вкладках |
| 13 | Пул з'єднань | /demo/pool/slow з таймлайном кожного запиту (очікування і робота), графік total/idle/waiting з /demo/pool/stats кожні 500 мс |
| 14 | Rate limit | 15 x POST /posts, статус і X-RateLimit-* кожного, Retry-After при 429, графік токенів у відрі |
| 15 | Безпека | SQL-ін'єкція safe проти unsafe (тільки в development), що ще робить бекенд: helmet, CORS, bcrypt |
| 16 | Метрики, трейси, graceful shutdown | GET /metrics з API, розібраний у таблицю (http_requests_total, pg_pool_*, bullmq_queue_jobs...), трейс через API і воркер, кроки SIGTERM; посилання на Grafana :3001 і Jaeger :16686 |
| 17 | Зовнішнє API (GitHub) | POST /github/import, таблиця лімітів GitHub, зрозумілі повідомлення при 502 |
| 18 | AI: LLM і вектори | модерація поста ({ action, reason, attempts }), system prompt, пошук схожих постів і пояснення 422 PGVECTOR_UNAVAILABLE |
| 19 | Деплой | чекліст деплою на VPS і EC2, перевірка після деплою; кроки CI на сторінці "Тести і CI" |

## Структура

```
src/
  api/client.ts      apiCall: обгортка над fetch, повертає ApiExchange (запит, відповідь, тривалість)
  api/baseUrl.ts     базова адреса API, перевірка /health, запасний :3000
  api/auth.ts        токени в пам'яті + localStorage, decodeJwt
  api/live.ts        socket.io-клієнт до /live
  hooks/useLatency.ts  тримає останній обмін для панелі
  components/        Layout (шапка, меню, PageNav), Panel (Запит / Відповідь / Час), SchemeCanvas (Excalidraw), спільні дрібниці, BarChart на SVG
  pages/             одна сторінка на тему, список у pages/index.ts
  styles.css         CSS-змінні, світла і темна тема через prefers-color-scheme
public/architecture.excalidraw  копія docs/architecture.excalidraw, яку робить `npm run scheme` (predev/prebuild); не комітиться
scripts/verify.mjs   перевірка через Playwright
```
