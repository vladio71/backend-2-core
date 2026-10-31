// Перевірка через Playwright: відкриває сторінки, клацає головні кнопки, перевіряє результат, зберігає скріншоти.
// Потрібні: запущений бекенд (API + воркер), запущений `npm run dev` (http://localhost:5173), пакет playwright з chromium.
// Запуск: node scripts/verify.mjs  (змінні: LEARN_URL, API_URL)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots');
const LEARN_URL = process.env.LEARN_URL ?? 'http://localhost:5173';
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
mkdirSync(SHOTS, { recursive: true });

const results = [];
function ok(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`OK   ${name}: ${detail}`);
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`FAIL ${name}: ${detail}`);
}
async function shot(page, name) {
  // Для повносторінкового скріншота шапка і меню не мають бути sticky, інакше вони "плавають" посеред картинки.
  await page.addStyleTag({ content: '.header, .sidebar { position: static !important; height: auto !important; }' });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}
async function waitApi(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="api-status"]')?.textContent?.startsWith('доступний'), null, { timeout: 15000 });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'light' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('PAGE ERROR', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE ERROR', msg.text());
});

const email = `learn${Date.now()}@example.com`;

try {
  // 1. Старт (шлях /start; / це схема проєкту): реєстрація нового користувача, логін seed-користувачем, refresh, повторне використання.
  await page.goto(`${LEARN_URL}/start`);
  await waitApi(page);
  await page.fill('[data-testid="email"]', email);
  await page.fill('[data-testid="displayName"]', 'Learn');
  await page.click('[data-testid="register"]');
  await page.waitForSelector('[data-testid="jwt-payload"]');
  const payload = await page.textContent('[data-testid="jwt-payload"]');
  if (payload?.includes(email)) ok('start.register', `JWT payload містить ${email}`);
  else fail('start.register', `payload: ${payload}`);
  await page.fill('[data-testid="email"]', 'olena@devhub.local');
  await page.click('[data-testid="login"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="auth-status"]')?.textContent?.includes('olena@devhub.local'));
  ok('start.login', 'залогінено як olena@devhub.local');
  const countdown = await page.textContent('[data-testid="countdown"]');
  if (countdown && /^\d+:\d\d$/.test(countdown)) ok('start.countdown', `до exp ${countdown}`);
  else fail('start.countdown', String(countdown));
  await page.click('[data-testid="refresh"]');
  await page.waitForSelector('[data-testid="reuse"]:not([disabled])');
  await page.click('[data-testid="reuse"]');
  await page.waitForSelector('[data-testid="reuse-result"]');
  const reuse = await page.textContent('[data-testid="reuse-result"]');
  if (reuse?.startsWith('401')) ok('start.reuse', 'старий refresh дав 401');
  else fail('start.reuse', String(reuse));
  await shot(page, '01-start');
  // Після відкликання сім'ї треба залогінитись знову.
  await page.click('[data-testid="login"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="latency"]') !== null);
  await page.waitForTimeout(300);

  // 2. Помилки
  await page.goto(`${LEARN_URL}/errors`);
  await waitApi(page);
  for (const code of ['400', '401', '404', '409', '422']) {
    await page.click(`[data-testid="err-${code}"]`);
    await page.waitForFunction((c) => document.querySelector('[data-testid="panel"] .badge')?.textContent === c, code, { timeout: 10000 });
  }
  const body = await page.textContent('[data-testid="response-body"]');
  if (body?.includes('requestId') && body.includes('INSUFFICIENT_CREDITS')) ok('errors.codes', '400/401/404/409/422 показані, тіло з requestId');
  else fail('errors.codes', String(body));
  await page.click('[data-testid="err-429"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="burst"] .dot').length === 12, null, { timeout: 20000 });
  const dots = await page.$$eval('[data-testid="burst"] .dot', (els) => els.map((e) => e.textContent));
  if (dots.includes('429')) ok('errors.429', `сплеск: ${dots.join(',')}`);
  else fail('errors.429', dots.join(','));
  await shot(page, '02-errors');

  // 3. Пагінація
  await page.goto(`${LEARN_URL}/pagination`);
  await waitApi(page);
  await page.click('[data-testid="load"]');
  await page.waitForSelector('[data-testid="posts-table"]');
  await page.click('[data-testid="next"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="panel"]')?.textContent?.includes('page=2'));
  ok('pagination.offset', 'сторінка 2 через page=2');
  await page.selectOption('[data-testid="mode"]', 'cursor');
  await page.click('[data-testid="load"]');
  await page.waitForSelector('[data-testid="posts-table"]');
  await page.click('[data-testid="next"]');
  await page.waitForSelector('[data-testid="decoded-cursor"]');
  const cursor = await page.textContent('[data-testid="decoded-cursor"]');
  if (cursor?.includes('"v"') && cursor.includes('"id"')) ok('pagination.cursor', `розкодований курсор ${cursor}`);
  else fail('pagination.cursor', String(cursor));
  await shot(page, '03-pagination');

  // 4. SQL і індекси
  await page.goto(`${LEARN_URL}/sql`);
  await waitApi(page);
  await page.click('[data-testid="report-load"]');
  await page.waitForSelector('[data-testid="report-chart"]');
  await page.click('[data-testid="nplusone-slow"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="count-slow"]')?.textContent !== '?');
  await page.click('[data-testid="nplusone-fast"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="count-fast"]')?.textContent !== '?');
  const slow = await page.textContent('[data-testid="count-slow"]');
  const fast = await page.textContent('[data-testid="count-fast"]');
  if (Number(slow) > Number(fast)) ok('sql.nplusone', `queryCount ${slow} проти ${fast}`);
  else fail('sql.nplusone', `${slow} / ${fast}`);
  await page.click('[data-testid="explain-seq"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="node-seq"]')?.textContent !== '?');
  await page.click('[data-testid="explain-idx"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="node-idx"]')?.textContent !== '?');
  const nodeSeq = await page.textContent('[data-testid="node-seq"]');
  const nodeIdx = await page.textContent('[data-testid="node-idx"]');
  if (nodeSeq?.includes('Seq Scan') && nodeIdx?.includes('Index')) ok('sql.explain', `${nodeSeq} проти ${nodeIdx}`);
  else fail('sql.explain', `${nodeSeq} / ${nodeIdx}`);
  await shot(page, '05-sql');

  // 5. Кеш
  await page.goto(`${LEARN_URL}/cache`);
  await waitApi(page);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="post-select"] option').length > 0);
  await page.click('[data-testid="stats"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="x-cache"]').length === 1);
  await page.click('[data-testid="stats"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="x-cache"]').length === 2);
  await page.click('[data-testid="patch"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="cache-history"] tbody tr').length === 3);
  await page.click('[data-testid="stats"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="x-cache"]').length === 3);
  const caches = await page.$$eval('[data-testid="x-cache"]', (els) => els.map((e) => e.textContent));
  if (caches.join(',') === 'MISS,HIT,MISS') ok('cache', `X-Cache: ${caches.join(' -> ')} (PATCH між другим і третім)`);
  else fail('cache', caches.join(','));
  await shot(page, '06-cache');

  // 6. Пул
  await page.goto(`${LEARN_URL}/pool`);
  await waitApi(page);
  await page.click('[data-testid="run"]');
  await page.waitForSelector('[data-testid="timeline"]', { timeout: 30000 });
  const waited = await page.textContent('[data-testid="waited-count"]');
  if (Number(waited) >= 10) ok('pool', `${waited} з 20 чекали на з'єднання (DB_POOL_MAX=10)`);
  else fail('pool', `waited=${waited}`);
  await shot(page, '12-pool');

  // 7. Кредити: логін admin (topup дозволений тільки admin), поповнення на 50, 20 паралельних reserve(10).
  await page.goto(`${LEARN_URL}/start`);
  await waitApi(page);
  await page.fill('[data-testid="email"]', 'admin@devhub.local');
  await page.click('[data-testid="login"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="auth-status"]')?.textContent?.includes('admin@devhub.local'));
  await page.goto(`${LEARN_URL}/credits`);
  await waitApi(page);
  await page.waitForSelector('[data-testid="balance-value"]');
  const readBalance = async () => Number((await page.textContent('[data-testid="balance-value"]'))?.match(/balance (\d+)/)?.[1]);
  const before = await readBalance();
  await page.click('[data-testid="topup"]');
  await page.waitForFunction((b) => Number(document.querySelector('[data-testid="balance-value"]')?.textContent?.match(/balance (\d+)/)?.[1]) === b + 50, before);
  const afterTopup = await readBalance();
  ok('credits.topup', `баланс ${before} -> ${afterTopup} після POST /credits/topup { amount: 50 }`);
  await page.click('[data-testid="reserve20"]');
  await page.waitForSelector('[data-testid="count-201"]');
  await page.waitForFunction((b) => Number(document.querySelector('[data-testid="balance-value"]')?.textContent?.match(/balance (\d+)/)?.[1]) < b, afterTopup);
  const c201 = Number(await page.textContent('[data-testid="count-201"]'));
  const c422 = Number(await page.textContent('[data-testid="count-422"]'));
  const finalBalance = Number(await page.textContent('[data-testid="final-balance"]'));
  const expected201 = Math.min(20, Math.floor(afterTopup / 10));
  if (c201 === expected201 && c201 + c422 === 20 && finalBalance === afterTopup - c201 * 10) {
    ok('credits.parallel', `баланс ${afterTopup}: 201: ${c201}, 422: ${c422}, баланс після ${finalBalance} (жодне списання не загублене)`);
  } else fail('credits.parallel', `очікував 201=${expected201}, отримав ${c201}/${c422}, баланс ${finalBalance}`);
  await shot(page, '09-credits');
  // Назад до olena для решти сторінок.
  await page.goto(`${LEARN_URL}/start`);
  await waitApi(page);
  await page.fill('[data-testid="email"]', 'olena@devhub.local');
  await page.click('[data-testid="login"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="auth-status"]')?.textContent?.includes('olena@devhub.local'));

  // 8. Rate limit
  await page.goto(`${LEARN_URL}/ratelimit`);
  await waitApi(page);
  await page.click('[data-testid="send15"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="shots"] tbody tr').length === 15, null, { timeout: 30000 });
  const statuses = await page.$$eval('[data-testid="shots"] tbody tr td:nth-child(3)', (els) => els.map((e) => e.textContent));
  const n429 = statuses.filter((s) => s === '429').length;
  if (n429 >= 4) ok('ratelimit', `статуси: ${statuses.join(',')}`);
  else fail('ratelimit', statuses.join(','));
  await shot(page, '13-ratelimit');

  // 9. GitHub (без токена і, можливо, без мережі: перевіряємо тільки, що сторінка обробляє відповідь)
  await page.goto(`${LEARN_URL}/github`);
  await waitApi(page);
  await page.click('[data-testid="import"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="panel"] .badge') !== null, null, { timeout: 60000 });
  const ghStatus = await page.textContent('[data-testid="panel"] .badge');
  ok('github', `POST /github/import -> ${ghStatus}`);
  await shot(page, '16-github');

  // 10. AI
  await page.goto(`${LEARN_URL}/ai`);
  await waitApi(page);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="post-select"] option').length > 0);
  await page.click('[data-testid="moderate"]');
  await page.waitForSelector('[data-testid="decision"]');
  const decision = await page.textContent('[data-testid="decision"]');
  ok('ai.moderate', decision?.replace(/\s+/g, ' ').slice(0, 120) ?? '');
  await page.click('[data-testid="similar"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="panel"]').length === 2);
  const simStatus = await page.textContent('[data-testid="panel"]:nth-of-type(2) .badge').catch(() => null);
  const simPanel = await page.$$eval('[data-testid="panel"] .badge', (els) => els.map((e) => e.textContent));
  const simProblem = await page.$('[data-testid="similar-problem"]');
  ok('ai.similar', `GET /posts/similar -> ${simPanel[1] ?? simStatus}${simProblem ? ' (показано пояснення PGVECTOR_UNAVAILABLE)' : ''}`);
  await shot(page, '17-ai');

  // 11. Черга: старт і три колонки до completed
  await page.goto(`${LEARN_URL}/queue`);
  await waitApi(page);
  await page.click('[data-testid="start-report"]');
  await page.waitForSelector('[data-testid="report-id"]');
  await page.waitForFunction(
    () => ['col-poll', 'col-sse', 'col-ws'].every((id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-status') === 'completed'),
    null,
    { timeout: 40000 },
  );
  const cols = await page.$$eval('.cols-3 .col', (els) => els.map((e) => e.textContent?.replace(/\s+/g, ' ')));
  ok('queue.three', cols.slice(0, 3).map((c) => c?.slice(0, 90)).join(' | '));
  await page.click('[data-testid="send-events"]');
  await page.waitForSelector('[data-testid="events-result"]', { timeout: 60000 });
  ok('queue.events', (await page.textContent('[data-testid="events-result"]')) ?? '');
  await shot(page, '10-queue');

  // 12. Живе: два контексти, малюємо в одному, інший отримує board:draw
  const context2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
  const page2 = await context2.newPage();
  // Другий контекст: окремий localStorage, тому логінимось там окремо.
  await page2.goto(`${LEARN_URL}/start`);
  await waitApi(page2);
  await page2.fill('[data-testid="email"]', 'taras@devhub.local');
  await page2.click('[data-testid="login"]');
  await page2.waitForFunction(() => document.querySelector('[data-testid="auth-status"]')?.textContent?.includes('taras@devhub.local'));
  await page.goto(`${LEARN_URL}/live`);
  await page2.goto(`${LEARN_URL}/live`);
  await page.waitForFunction(() => document.querySelector('[data-testid="ws-status"]')?.textContent === 'підключено');
  await page2.waitForFunction(() => document.querySelector('[data-testid="ws-status"]')?.textContent === 'підключено');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="presence"] li').length >= 2, null, { timeout: 10000 });
  const presence = await page.$$eval('[data-testid="presence"] li', (els) => els.map((e) => e.textContent?.trim()));
  ok('live.presence', `онлайн: ${presence.join(', ')}`);
  // Дошка може бути нижче в'юпорту (над нею текст), а миша клікає лише по видимому: спершу прокручуємо до неї.
  await page.locator('[data-testid="board"]').scrollIntoViewIfNeeded();
  const box = await page.locator('[data-testid="board"]').boundingBox();
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(box.x + 50 + i * 15, box.y + 50 + i * 8);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page2.waitForFunction(() => Number(document.querySelector('[data-testid="received"]')?.textContent) > 0, null, { timeout: 10000 });
  const sent = await page.textContent('[data-testid="sent"]');
  const received = await page2.textContent('[data-testid="received"]');
  ok('live.board', `вкладка 1 надіслала ${sent} пачок board:draw, вкладка 2 отримала ${received}`);
  await shot(page, '11-live');
  await shot(page2, '11-live-second-tab-dark');
  await context2.close();

  // 13. Безпека
  await page.goto(`${LEARN_URL}/security`);
  await waitApi(page);
  await page.click('[data-testid="unsafe"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="unsafe-sql"]')?.textContent !== '?');
  await page.click('[data-testid="safe"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="safe-sql"]')?.textContent !== '?');
  const unsafeRows = await page.textContent('[data-testid="unsafe-rows"]');
  const safeRows = await page.textContent('[data-testid="safe-rows"]');
  ok('security', `unsafe: ${unsafeRows?.slice(0, 40)}; safe: ${safeRows}`);
  await shot(page, '14-security');

  // 14. Деплой
  await page.goto(`${LEARN_URL}/deploy`);
  await page.waitForSelector('.checklist');
  ok('deploy', 'статична сторінка з чеклістами відкрилась');
  await shot(page, '18-deploy');

  // Нові сторінки (порядок тем 1..19, файли скріншотів = номер у меню мінус один).
  // 0. Схема проєкту: Excalidraw у режимі перегляду.
  await page.goto(`${LEARN_URL}/`);
  await page.waitForSelector('[data-testid="scheme-canvas"] canvas', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const canvases = await page.$$eval('[data-testid="scheme-canvas"] canvas', (els) => els.length);
  const schemeNav = await page.textContent('[data-testid="page-nav"]');
  if (canvases > 0 && schemeNav?.includes('1 / 19') && !(await page.$('[data-testid="nav-prev"]'))) ok('scheme', `${canvases} canvas, навігація 1 / 19 без "Попередня"`);
  else fail('scheme', `canvas=${canvases}, nav=${schemeNav}`);
  await shot(page, '00-scheme');

  // 5. Міграції, час, soft delete: POST, DELETE (204), GET (404), restore (201), GET (200), restore ще раз (409).
  await page.goto(`${LEARN_URL}/migrations`);
  await waitApi(page);
  await page.click('[data-testid="soft-delete-cycle"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="soft-delete-steps"] .step').length === 5, null, { timeout: 20000 });
  await page.click('[data-testid="restore-again"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="soft-delete-steps"] .step').length === 6, null, { timeout: 10000 });
  const softStatuses = await page.$$eval('[data-testid="soft-delete-steps"] .badge', (els) => els.map((e) => e.textContent));
  if (softStatuses.join(',') === '201,204,404,201,200,409') ok('migrations.softDelete', `статуси ${softStatuses.join(',')}`);
  else fail('migrations.softDelete', softStatuses.join(','));
  await shot(page, '04-migrations');

  // 8. Логи, request-id і health: /health по залежностях, свій X-Request-Id повертається назад.
  await page.goto(`${LEARN_URL}/logging`);
  await waitApi(page);
  await page.click('[data-testid="health"]');
  await page.waitForSelector('[data-testid="health-deps"]');
  const deps = await page.$$eval('[data-testid="health-deps"] .dep h3', (els) => els.map((e) => e.textContent));
  await page.fill('[data-testid="custom-request-id"]', 'learn-demo-42');
  await page.click('[data-testid="req-posts"]');
  await page.waitForSelector('[data-testid="request-ids"]');
  await page.click('[data-testid="req-404"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="request-ids"] tbody tr').length === 2);
  const ids = await page.$$eval('[data-testid="request-ids"] tbody tr td:nth-child(3)', (els) => els.map((e) => e.textContent));
  if (deps.includes('postgres') && deps.includes('redis') && ids.every((id) => id === 'learn-demo-42')) ok('logging', `health: ${deps.join(', ')}; X-Request-Id повернувся: ${ids.join(', ')}`);
  else fail('logging', `deps=${deps.join(',')} ids=${ids.join(',')}`);
  await shot(page, '07-logging');

  // 9. Тести і CI: статика.
  await page.goto(`${LEARN_URL}/tests`);
  await page.waitForSelector('h1');
  const testsText = await page.textContent('main');
  if (testsText?.includes('npm run test:e2e') && testsText.includes('test.todo') && testsText.includes('actions/checkout@v4')) ok('tests', 'три рівні, CI-кроки і test.todo на місці');
  else fail('tests', 'бракує тексту');
  await shot(page, '08-tests');

  // 16. Метрики, трейси, graceful shutdown: GET /metrics розібраний у таблицю.
  await page.goto(`${LEARN_URL}/observability`);
  await waitApi(page);
  await page.click('[data-testid="metrics-load"]');
  await page.waitForSelector('[data-testid="metrics-table"]', { timeout: 15000 });
  const metricNames = await page.$$eval('[data-testid="metrics-table"] tbody tr td:first-child', (els) => els.map((e) => e.textContent?.split('{')[0]));
  if (metricNames.includes('http_requests_total') && metricNames.includes('pg_pool_total')) ok('observability.metrics', `${metricNames.length} рядків: ${[...new Set(metricNames)].join(', ')}`);
  else fail('observability.metrics', metricNames.join(','));
  const prevT = await page.textContent('[data-testid="nav-prev"]');
  const nextT = await page.textContent('[data-testid="nav-next"]');
  if (prevT?.includes('Безпека') && nextT?.includes('GitHub')) ok('nav', `Попередня/Наступна: ${prevT.trim()} | ${nextT.trim()}`);
  else fail('nav', `${prevT} / ${nextT}`);
  await shot(page, '15-observability');
} catch (err) {
  fail('exception', err instanceof Error ? err.stack ?? err.message : String(err));
  await shot(page, 'error');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} OK, ${failed.length} FAIL (API ${API_URL})`);
process.exit(failed.length ? 1 : 0);
