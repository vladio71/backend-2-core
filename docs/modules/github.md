# github: зовнішній API під його лімітами

## Що це
`POST /github/import { username }` тягне публічні репозиторії користувача (`GET /users/:username/repos?per_page=100`, посторінково) і робить UPSERT у `github_repos` по `(owner, name)`. Без `GITHUB_TOKEN` ходить анонімно, з токеном авторизовано. У тестах `GITHUB_API_URL` вказує на локальний HTTP-сервер, який на перший запит відповідає `429 Retry-After: 1`, далі `200`.

Ліміти GitHub (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):

| Ліміт | Тип | Значення | Що робимо |
|---|---|---|---|
| Запитів на годину | primary | 5000 з токеном, 60 без | `WindowBudget(5000 або 60, 1 год)` |
| Поінтів на хвилину для REST | secondary | 900 (GET = 1, POST/PATCH/PUT/DELETE = 5) | `WindowBudget(900, 1 хв)` |
| Одночасних запитів | secondary | 100 | `Semaphore(100)` |
| Відповідь при перевищенні | | 429 або 403 з `Retry-After` | чекаємо стільки секунд, повтор до 3 разів |

Primary ліміт це квота на годину, він повертається в заголовках `x-ratelimit-remaining`/`x-ratelimit-reset`. Secondary ліміти захищають GitHub від сплесків: навіть маючи 4000 запитів квоти, не можна відправити їх за секунду. Якщо `Retry-After` немає, GitHub радить чекати хоча б хвилину і збільшувати паузу.

## Чому так
`Promise.all(500 запитів)` отримає 403 secondary limit і, якщо продовжувати, тимчасовий бан. Семафор обмежує "у польоті", бюджети обмежують швидкість, retry з `Retry-After` обробляє випадки, коли ми все одно вперлися. Усе це 60 рядків без зовнішньої бібліотеки, бо суть проста: черга промісів і лічильники.

## Де в коді
- `src/modules/github/semaphore.ts`: `Semaphore`, `WindowBudget`.
- `src/modules/github/github.client.ts`: fetch, заголовки, retry.
- `src/modules/github/github.service.ts`: UPSERT.
- `src/modules/github/semaphore.spec.ts`, `test/e2e/github.e2e-spec.ts`.

## Спробуй сам
1. Читай `x-ratelimit-remaining` з відповіді і, коли воно < 10, затримуй наступний запит до `x-ratelimit-reset`.
2. Додай `GET /github/stats`: `inFlight`, `queued`, `retries` і залишок квоти.
