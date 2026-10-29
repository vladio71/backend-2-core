# health: GET /health

## Що це
`GET /health` робить `SELECT 1` у Postgres і `PING` у Redis, повертає статус і затримку кожної залежності. Якщо щось лежить, код відповіді 503.

```json
{ "status": "ok", "instance": "api-1", "uptimeSeconds": 42, "dependencies": { "postgres": { "status": "up", "latencyMs": 2 }, "redis": { "status": "up", "latencyMs": 1 } } }
```

## Чому так
Балансувальник, Docker healthcheck і Kubernetes дивляться саме сюди: 503 означає "не слати трафік на цей інстанс". Статус по кожній залежності окремо потрібен людині о третій ночі: одразу видно, що впав Redis, а не "щось".

## Де в коді
- `src/modules/health/health.controller.ts`.
- `docker-compose.yml`: `healthcheck` у `api-1` і `api-2`; nginx стартує тільки після `service_healthy`.

## Спробуй сам
1. Додай перевірку черги: `queue.getWaitingCount()` і статус `degraded`, якщо чекає більше `QUEUE_MAX_WAITING`.
2. Зупини Redis (`docker compose stop redis`) і подивись відповідь `/health` та що робить nginx.
