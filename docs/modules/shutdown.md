# graceful shutdown

## Що це
На `SIGTERM` процес не вмирає миттєво, а закривається по кроках:

```
SIGTERM
  |
  v
API: HTTP-сервер перестає приймати нові з'єднання (app.close)
  |   відкриті запити дороблюються
  v
модулі: onModuleDestroy / onApplicationShutdown
  |   LiveGateway: відписка від подій, зупинка heartbeat
  |   ReportEventsService: quit підписника Redis
  |   TypeORM: закриття пулу з'єднань
  |   RedisModule: quit клієнта
  v
exit
```

У воркері те саме, але перший крок інший: `@nestjs/bullmq` викликає `worker.close()`, який чекає завершення поточного job-у і не бере нових. Перевірено в пісочниці: SIGTERM на 2-й секунді 5-секундного звіту, воркер вийшов через 3.6 с, звіт у БД `completed`.

## Чому так
Без цього при деплої половина запитів отримає "connection reset", а job, що виконувався, лишиться в `active` назавжди (BullMQ поверне його в чергу тільки після `stalledInterval`). `docker compose` шле SIGTERM і чекає `stop_grace_period` (у воркера 30 с), потім SIGKILL.

## Де в коді
- `src/app-setup.ts`: `app.enableShutdownHooks()`.
- `src/worker.ts`: те саме для `createApplicationContext`.
- `src/modules/redis/redis.module.ts`: `onApplicationShutdown`.
- `src/modules/jobs/events.processor.ts`: `onModuleDestroy` робить `collector.drain()`, щоб недописана пачка подій потрапила в БД.
- `docker-compose.yml`: `stop_grace_period: 30s` у `worker`.

## Спробуй сам
1. Запусти воркер, створи звіт, надішли `kill -TERM <pid>` на 2-й секунді. Подивись лог: job дороблюється, потім "Закриваю з'єднання з Redis".
2. Постав `REPORT_STEP_MS=10000` і `stop_grace_period: 5s`. Що станеться з job-ом після SIGKILL? Знайди його в Bull Board.
