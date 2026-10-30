# queries: сирий SQL, N+1, індекси, кеш

## Що це

### Сирий SQL: `GET /reports/posts-per-day`
JOIN users, GROUP BY `date_trunc('day', created_at)`, віконна функція `sum(count(*)) OVER (PARTITION BY автор ORDER BY день)` дає накопичений підсумок. SQL прокоментований рядок за рядком у `posts-per-day.controller.ts`.

### N+1: `GET /demo/n-plus-one?fixed=false|true`
Відповідь містить `queryCount`, порахований TypeORM-логером. Виміряно на 30 постах:

| | queryCount |
|---|---|
| `fixed=false` (цикл, `findOne` автора на кожен пост) | 31 |
| `fixed=true` (`relations: { author: true }`, LEFT JOIN) | 2 |

Чому 2, а не 1: TypeORM з `take` + `relations` спочатку вибирає id сторінки, потім робить JOIN по цих id. Це нормально.

### Індекси: `GET /demo/explain?indexed=false|true`
`EXPLAIN (ANALYZE, FORMAT JSON)` для `WHERE user_id = $1 AND created_at >= now() - 30 days` на 200 000 рядків `events`. `indexed=false` вимикає індексні сканування через `SET LOCAL` у транзакції (індекс лишається, планувальник його не використовує). Виміряно в пісочниці (94 рядки з 200 000 підходять під фільтр):

| | Node Type | Index Name | Execution Time |
|---|---|---|---|
| без індексу | Seq Scan | нема | 22.8 мс (в іншому прогоні 35.0 мс) |
| з індексом | Bitmap Index Scan / Index Only Scan | `events_user_id_created_at_idx` | 0.2 мс / 0.09 мс |

Різниця в 100+ разів на таблиці, що влазить у пам'ять. На диску різниця більша. Другий спосіб побачити те саме: `npm run migration:revert` (прибирає індекс по-справжньому), `GET /demo/explain?indexed=true` покаже Seq Scan, `npm run migration:run` поверне.

Порядок колонок в індексі: спочатку рівність (`user_id = ?`), потім діапазон (`created_at >= ?`). Індекс `(created_at, user_id)` для цього запиту гірший.

### Кеш: `GET /posts/:id/stats`
Агрегат по кількох таблицях (у коді ще `pg_sleep(0.2)`, щоб було видно, що він дорогий). Результат у Redis з `EX 60`. Заголовок `X-Cache: HIT|MISS`. `PATCH`, `DELETE`, `publish` цього поста роблять `DEL post:stats:<id>`.

| | TTL | Інвалідація |
|---|---|---|
| Свіжість даних | до 60 с застарілі | свіжі одразу після запису |
| Що треба пам'ятати | нічого | кожне місце, де пишеться пост |
| Якщо забули | дані оновляться самі через 60 с | застарілі назавжди |
| Разом | TTL як страховка + інвалідація для свіжості | |

## Чому так
ORM ховає SQL, але не прибирає його. N+1 не видно у коді (цикл виглядає невинно), видно тільки по кількості запитів. Індекс не "пришвидшує базу", він міняє план: Seq Scan читає всю таблицю, Index Scan іде по дереву до потрібних рядків. `EXPLAIN ANALYZE` це єдиний спосіб побачити, що реально сталося.

## Де в коді
- `src/modules/queries/posts-per-day.controller.ts`.
- `src/modules/queries/n-plus-one.controller.ts` + `src/modules/database/query-counter.ts`.
- `src/modules/queries/explain.controller.ts` + `src/migrations/1700000000003-AddEventsUserCreatedIndex.ts`.
- `src/modules/queries/post-stats-cache.service.ts`, `stats.controller.ts`; інвалідація в `src/modules/posts/posts.service.ts`.
- `test/int/sql.int-spec.ts`: running_total, EXPLAIN з індексом і без, UTC.

## Спробуй сам
1. Зміни індекс на `(created_at, user_id)` у міграції, накоти і порівняй `EXPLAIN`. Поверни назад.
2. Додай у `posts-per-day` ще одну віконну функцію: `rank() OVER (PARTITION BY day ORDER BY likes DESC)`, найактивніший автор дня.
3. Прибери `invalidate()` з `update()` і напиши тест, який це ловить (HIT зі старими `likes`).

Попередня тема: [time](time.md) | Наступна тема: [logging](logging.md)
