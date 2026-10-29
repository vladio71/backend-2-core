# Тести: три рівні

| Рівень | Що перевіряє | Що підміняємо | Швидкість | Команда |
|---|---|---|---|---|
| Unit (`src/**/*.spec.ts`) | логіку одного класу | репозиторії, Redis, LLM фейками | мс | `npm test` |
| Integration (`test/int/*.int-spec.ts`) | SQL, міграції, репозиторії | нічого: справжній Postgres | секунди | `npm run test:int` |
| e2e (`test/e2e/*.e2e-spec.ts`) | весь застосунок через HTTP/WS | тільки зовнішні API (GitHub mock, Fake LLM) | десятки секунд | `npm run test:e2e` |

## Unit
`PostsService` з `jest.fn()` замість репозиторію: перевіряємо, що чужий пост дає `FORBIDDEN`, а адмін проходить. `TokenBucketService` з фейковим Redis, який виконує "Lua" у JS: перевіряємо арифметику відра. `ModerationService` з `FakeLlmProvider`: approve/reject/retry/502. Жодної мережі, жодної бази. Якщо unit-тест вимагає Postgres, це вже не unit.

## Integration
`resetDatabase()` робить `DROP SCHEMA public CASCADE` і накочує міграції заново. Далі сирий SQL або репозиторій проти справжньої бази: `EXPLAIN` з індексом і без, `running_total` у віконній функції, `revert` міграції, тип `timestamptz`, UTC-сесія. Тут не піднімається Nest.

## e2e
`createTestApp()` піднімає `AppModule` (і за потреби `JobsWorkerModule`, щоб воркер працював у тому самому процесі) з тими самими пайпами і фільтром, що у `main.ts`, на випадковому порту. Запити через `supertest`, WebSocket через `socket.io-client`, SSE через `http.get`. Кожен файл має чисту БД і чистий Redis (db 1).

Що є в e2e: ротація refresh і виявлення повторного використання, 400 з назвою поля, offset і cursor, транзакція publish з імітацією падіння, кеш HIT/MISS/інвалідація, 11-й запит 429, 20 паралельних резервацій, звіт до completed, SSE, 3 спроби і failed, QUEUE_FULL, батчинг 250 подій, presence/board/progress по WebSocket, GitHub 429 -> retry.

## Запуск локально
Потрібні Postgres і Redis. `.env.test` читається автоматично (`node --env-file-if-exists=.env.test`). Мінімум:

```
DATABASE_URL=postgres://devhub:devhub@localhost:5432/devhub_test
REDIS_URL=redis://localhost:6379/1
JWT_SECRET=test-secret-0123456789abcdef
QUEUE_MAX_WAITING=3
REPORT_STEP_MS=50
```

Тестова база окрема від робочої і щоразу перестворюється (`DROP SCHEMA`). З docker compose: `docker compose exec postgres createdb -U devhub devhub_test`. Змінні з оточення мають пріоритет над `.env.test`, тому можна запускати як `DATABASE_URL=... npm run test:e2e`.

`PGVECTOR=1` вмикає тест similar-пошуку (потрібен образ `pgvector/pgvector:pg16`).

## Твоє завдання
`test/e2e/your-turn.e2e-spec.ts` містить два `test.todo`. Заповни їх:

1. Чужий пост не редагується (403), адмін може (200). Скелет: `registerUser` двічі, `POST /posts` першим, `PATCH` другим, `UPDATE users SET role='admin'` + логін, `PATCH` знову.
2. Soft delete ховає пост зі списку, але рядок лишається з `deleted_at`.

Підказки: `t.http()`, `bearer(user)`, `t.dataSource.query(...)`. Подивись сусідні файли.
