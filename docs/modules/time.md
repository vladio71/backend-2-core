# time: усе в UTC

## Що це
Усі колонки дат мають тип `timestamptz`, сесія Postgres працює з `TimeZone=UTC` (параметр `options: '-c TimeZone=UTC'` у `extra` TypeORM), контейнер Postgres теж у UTC. У JSON дати віддаються як ISO-рядки з `Z`.

## Чому так
`timestamp` (без зони) зберігає "настінний годинник": `2026-03-29 02:30` без інформації, де саме це було. `timestamptz` зберігає момент часу і при читанні переводить у зону сесії. Якщо сесія в UTC, усі процеси (api-1 в Києві, api-2 у Франкфурті, воркер де завгодно) бачать однакові рядки. Перевід у локальний час робить фронтенд, бо тільки він знає зону користувача. Звіт `posts-per-day` групує по `date_trunc('day', created_at)` у UTC: межа дня для всіх однакова.

## Де в коді
- `src/modules/database/data-source-options.ts`: `options: '-c TimeZone=UTC'`.
- `src/migrations/1700000000001-InitSchema.ts`: `timestamptz` скрізь.
- `test/int/migrations.int-spec.ts`: тест, що всі колонки `*_at` мають тип `timestamp with time zone`.
- `test/int/sql.int-spec.ts`: `SHOW TimeZone` повертає `UTC`.

## Спробуй сам
1. У psql виконай `SET TimeZone='Europe/Kyiv'; SELECT created_at FROM posts LIMIT 1;` і порівняй з `UTC`. Рядок у БД той самий.
2. Додай у `posts-per-day` параметр `tz` і групуй по `date_trunc('day', created_at AT TIME ZONE $tz)`. Перевір, що межа дня змістилась.
