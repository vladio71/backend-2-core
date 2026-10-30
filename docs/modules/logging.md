# logging: requestId на кожному рядку

## Що це
Middleware бере `X-Request-Id` із запиту (або генерує uuid), повертає його у відповіді тим самим заголовком і кладе в `AsyncLocalStorage`. Логер друкує JSON, у кожному рядку є `requestId`:

```
{"time":"2026-10-29T18:46:50.496Z","level":"info","context":"ReportsProcessor","requestId":"demo-req-1","instance":"worker","msg":"Звіт ddd5... : спроба 1, старт"}
```

Цей рядок з воркера. Job несе `requestId` у `job.data`, процесор загортає роботу в `runWithRequestId()`, тому логи HTTP-запиту і job-у, який він створив, мають один id.

## Чому так
Передавати `requestId` через аргументи кожної функції незручно і всі забувають. `AsyncLocalStorage` робить це автоматично для всього ланцюжка `await`. JSON замість тексту: у production логи читає машина (`grep requestId=...` або запит у Loki/CloudWatch).

## Де в коді
- `src/modules/logging/request-context.ts`: `runWithRequestId`, `getRequestId`.
- `src/modules/logging/request-id.middleware.ts`: заголовок, лог `METHOD url status ms`.
- `src/modules/logging/app-logger.ts`: логер; рівень через `LOG_LEVEL` (у тестах типово `warn`).
- `src/modules/jobs/reports.processor.ts`: `runWithRequestId(job.data.requestId, ...)`.
- `src/modules/logging/app-logger.spec.ts`.

## Спробуй сам
1. Додай у `RequestIdMiddleware` ще й `userId` у контекст (після `JwtAuthGuard` він є у `request.user`). Підказка: guard виконується після middleware, тому доведеться писати в контекст з guard-а.
2. Зроби `EventsProcessor` так, щоб у лозі "Записано пачку подій" був список `requestId` усіх job-ів пачки.

Попередня тема: [queries](queries.md) | Наступна тема: [health](health.md)
