# pool: чому API стає повільним

## Що це
- `GET /demo/pool/stats`: `max`, `total`, `idle`, `waiting` з `pg.Pool` (TypeORM тримає його у `driver.master`).
- `GET /demo/pool/slow?seconds=1&n=20` (потрібен Bearer-токен; межі `seconds` 1..5 і `n` 1..30, бо анонімний виклик міг би зайняти весь пул і покласти `/health`): 20 паралельних `SELECT pg_sleep(1)`. Виміряно з `DB_POOL_MAX=10`:

```
запит  1..10: waitedForConnection ~20 мс,  total ~1020 мс
запит 11..20: waitedForConnection ~1020 мс, total ~2030 мс
wallClockMs: 2034
```

Запити 11-20 чекали, поки перші 10 звільнять з'єднання. Це і є черга пулу.

## Чому так
Postgres створює процес на кожне з'єднання. `max_connections` (типово 100) це межа всього сервера. Пул у застосунку тримає `max` з'єднань відкритими і видає їх запитам по черзі. Коли всі зайняті, новий запит чекає `connectionTimeoutMillis` (`DB_ACQUIRE_TIMEOUT_MS`), потім помилка. Сума `DB_POOL_MAX` усіх процесів (api-1 + api-2 + worker + міграції + psql) має бути менша за `max_connections`.

Три класичні помилки:

1. Довга транзакція. `BEGIN`, потім 3 секунди обчислень у Node, потім `COMMIT`. З'єднання зайняте весь час, хоча Postgres нічого не робить.
2. Зовнішній HTTP-виклик всередині транзакції. `BEGIN`, `fetch('https://api.stripe.com')` на 2 секунди, `COMMIT`. Те саме, плюс якщо Stripe завис, завис і пул. Правильно: виклик зовні, транзакція коротка, статус оновлюється окремим запитом.
3. Пул завеликий. `max: 100` на кожному з 5 процесів = 500 > `max_connections`. Частина процесів не зможе підключитися взагалі. Більший пул не дає більше паралелізму, ніж є ядер у Postgres.

## Де в коді
- `src/modules/pool/pool.controller.ts`.
- `src/modules/database/data-source-options.ts`: `extra.max`, `connectionTimeoutMillis`.
- `.env.example`: `DB_POOL_MAX`, `DB_ACQUIRE_TIMEOUT_MS`.

## Спробуй сам
1. Постав `DB_POOL_MAX=3`, перезапусти, виклич `slow?seconds=1&n=9`. Намалюй, скільки "хвиль" вийшло.
2. Постав `DB_ACQUIRE_TIMEOUT_MS=500` і `n=20`: що повертає API для запитів, які не дочекались? Зроби для цієї помилки нормальний 503 у фільтрі.

Попередня тема: [live](live.md) | Наступна тема: [ratelimit](ratelimit.md)
