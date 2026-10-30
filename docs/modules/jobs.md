# jobs: черга, воркер, backpressure, батчинг

## Що це
Дві черги BullMQ: `reports` і `events`. Воркер це окремий процес `src/worker.ts` (`npm run start:worker`, у compose сервіс `worker` з того самого образу). API тільки кладе job-и.

### Звіти
- `POST /reports { failRate? }` -> `202 { id, status: "queued", statusUrl, eventsUrl }`. Рядок у `reports` створюється ДО `queue.add()`.
- `GET /reports/:id` -> `queued | active | completed | failed`, `progress`, `attempts`, `result` або `error`.
- `GET /reports/:id/events` -> SSE: той самий статус подіями.
- Воркер: 5 кроків по `REPORT_STEP_MS` (1 с), `job.updateProgress`, з імовірністю `failRate` кидає помилку. `attempts: 3`, `backoff: exponential 500ms`. Після третьої невдачі `failed` з текстом помилки в БД.
- Статус летить з воркера в API через Redis pub/sub (канал `devhub:report-events`), API роздає його SSE і WebSocket.

```
клієнт        API                    Redis (BullMQ)        воркер               БД
  |-- POST -->|                         |                     |                   |
  |           |-- INSERT reports ------------------------------------------------->|
  |           |-- add(job) ------------>|                     |                   |
  |<-- 202 ---|                         |--- job ------------>|                   |
  |           |                         |                     |-- UPDATE active ->|
  |           |<== pub report-events ===|<== publish =========|                   |
  |<-- SSE ---|                         |                     |   ...5 кроків...  |
  |<-- WS ----|                         |                     |-- UPDATE done --->|
```

### Backpressure
`POST /reports` повертає `429 { code: "QUEUE_FULL" }` з `Retry-After: 5`, якщо у черзі чекає більше `QUEUE_MAX_WAITING` job-ів. Тест ставить `QUEUE_MAX_WAITING=3`, зупиняє чергу (`queue.pause()`), кладе 3, четвертий отримує 429.

### Батчинг подій
`POST /events` кладе один job. Воркер черги `events` має `concurrency: 100`, і `BatchCollector` збирає job-и "у польоті" у пачку до 100 (або 50 мс очікування) і пише ОДНИМ `INSERT ... VALUES (...), (...), ...`. Проміс кожного job-у завершується разом із його пачкою, тому BullMQ бачить job виконаним тільки після запису в БД.

Виміряно (`npm run bench:batch`, середнє з 3 прогонів, локальний Postgres):

| | Час |
|---|---|
| 500 одиничних INSERT | 459 мс |
| 5 пачок по 100 рядків | 10 мс |
| Прискорення | x47 |

Різниця це 495 зайвих раундтрипів до бази. По мережі (а не localhost) кожен раундтрип ще дорожчий.

### Bull Board
`/queues`: стан черг, job-и, помилки, retry руками. У `development` відкритий, інакше потрібен JWT адміна (`?token=` або заголовок).

### Крон
`@nestjs/schedule`, `CreditsCron.releaseExpired()` щохвилини (див. `credits.md`). Живе у процесі API, не у воркері: інакше при двох воркерах він би виконувався двічі (у production крон теж треба або виносити в один процес, або брати лок у Redis).

## Чому так
Довга робота в HTTP-обробнику тримає з'єднання, пул, пам'ять; клієнт чекає 5 с і отримує таймаут від nginx. 202 + статус дозволяє клієнту відпустити запит. Окремий процес воркера: падіння job-у не кладе API, масштабуються незалежно. Рядок у БД перед enqueue: якщо Redis впаде між ними, лишиться запис `queued` без job-у, і це видно; навпаки гірше: воркер бере job, а рядка ще немає. Backpressure: обіцяти те, чого не виконаємо, гірше, ніж чесно сказати "пізніше".

## Де в коді
- `src/modules/jobs/queues.ts`: імена, типи даних job-ів.
- `src/modules/jobs/reports.service.ts`: INSERT перед add, `QUEUE_FULL`.
- `src/modules/jobs/reports.controller.ts`: 202, polling, SSE.
- `src/modules/jobs/reports.processor.ts`: кроки, retry, `@OnWorkerEvent('failed')`.
- `src/modules/jobs/batch-collector.ts`, `events.processor.ts`.
- `src/modules/jobs/report-events.service.ts`: Redis pub/sub.
- `src/modules/jobs/jobs.module.ts` (API), `jobs-worker.module.ts` (воркер), `src/worker.ts`, `src/worker.module.ts`.
- `scripts/bench-batch.ts`.
- `test/e2e/jobs.e2e-spec.ts`, `src/modules/jobs/batch-collector.spec.ts`.

## Спробуй сам
1. Додай `DELETE /reports/:id` для `queued` звітів: `queue.remove(id)` і статус `cancelled`. Що робити, якщо job уже `active`?
2. Постав `WORKER_CONCURRENCY=1` і створи 5 звітів поспіль. Подивись у Bull Board, як вони виконуються по одному. Потім `=5`.
3. Зміни `EVENTS_BATCH_WAIT_MS` на 1000 і подивись у логах воркера, як змінився розмір пачок при повільному потоці подій.

Попередня тема: [credits](credits.md) | Наступна тема: [live](live.md)
