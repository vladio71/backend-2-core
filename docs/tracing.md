# Трейсинг: OpenTelemetry і Jaeger

## Що це

Логи відповідають на питання "що сталося", трейс відповідає на питання "де пройшов час". Один HTTP-запит у devhub проходить через express, кілька SQL-запитів, Redis, іноді через чергу у воркер в іншому процесі. Трейс збирає все це в одне дерево з таймінгами.

- **Trace (трейс)**: один наскрізний шлях однієї операції, наприклад `POST /reports` від приходу запиту до завершення звіту у воркері. Має `traceId`.
- **Span (спан)**: один крок усередині трейсу з початком, кінцем і атрибутами: `POST /reports` (весь запит), `pg.query:INSERT` (один SQL), `evalsha` (одна команда Redis), `report.step 3` (третій крок звіту). У кожного span-у є батько, тому вони складаються в дерево.

Схематично трейс одного звіту:

```
POST /reports                               26 мс   (api-1)
  middleware - jsonParser                    1 мс
  request handler - /reports                23 мс
    evalsha                                  4 мс   getWaitingCount у Redis
    pg.query:INSERT                          2 мс   рядок у reports
    evalsha                                  2 мс   queue.add
    reports.generate                       1052 мс   (worker, інший процес, той самий traceId)
      pg.query:UPDATE                        3 мс   status = active
      report.step 1                        201 мс
      report.step 2                        201 мс
      ...
      publish                                0.4 мс  подія у Redis pub/sub
```

Як це зроблено:

- `src/tracing.ts`: перший `import` у `main.ts` і `worker.ts`. Вмикає `NodeSDK` з авто-інструментаціями `http`, `express`, `pg`, `ioredis` і OTLP/HTTP-експортер. Без `OTEL_EXPORTER_OTLP_ENDPOINT` файл нічого не робить, а всі виклики `@opentelemetry/api` у коді стають no-op.
- `src/modules/jobs/reports.service.ts`: перед `queue.add` кладе у дані job-у `traceparent` (W3C Trace Context, рядок виду `00-<traceId>-<spanId>-01`).
- `src/modules/jobs/reports.processor.ts`: читає `traceparent` з job-у, відкриває span `reports.generate` як дочірній до span-у запиту, плюс по span-у на кожен крок звіту. Так трейс "перестрибує" з процесу API у процес воркера через Redis.
- Невдалий експорт (Jaeger не піднятий, неправильний endpoint) пишеться у stderr один раз і не впливає на роботу API.

## Як запустити

```
docker compose up --build
```

Compose піднімає `jaeger` (образ `jaegertracing/jaeger:2.22.0`, all-in-one, дані в пам'яті) і передає `api-1`, `api-2`, `worker` змінну `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`. Jaeger UI: http://localhost:16686.

Без Docker для застосунку: підняти лише Jaeger (`docker compose up jaeger`) і у `.env` поставити `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`. Ім'я сервісу в Jaeger береться з `INSTANCE_NAME` (`api-1`, `api-2`, `worker`) або з `OTEL_SERVICE_NAME`.

Span-и йдуть у Jaeger пачками кожні 5 секунд, тому трейс з'являється в UI із затримкою до 5 с.

## Jaeger UI за 30 секунд

1. Зліва вгорі **Service**: обрати `api-1` (або `worker`).
2. **Operation**: обрати конкретний ендпоінт, наприклад `POST /reports`, або лишити `all`.
3. **Find Traces**. Справа список трейсів, у кожного тривалість і кількість span-ів. Клік по трейсу відкриває дерево.
4. У дереві кожен рядок це span, горизонтальна смужка показує, коли він почався і скільки тривав відносно батька. Клік по рядку розкриває атрибути (`db.statement` для SQL, `http.status_code` для HTTP) і помилки.
5. Поля **Min Duration** / **Max Duration** фільтрують трейси за тривалістю: `Min Duration = 2s` показує лише повільні.

## Прохід 1: знайти повільний крок у POST /reports

1. Залогінитись і створити звіт:

   ```
   TOKEN=$(curl -s -X POST localhost:8080/auth/login -H 'content-type: application/json' \
     -d '{"email":"olena@devhub.local","password":"password123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).tokens.accessToken')
   curl -s -X POST localhost:8080/reports -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"failRate":0}'
   ```

2. Почекати, поки звіт завершиться (5 кроків по `REPORT_STEP_MS`, типово 5 с), ще 5 с на експорт.
3. У Jaeger: Service `api-1` (або `api-2`, nginx міг віддати запит другому інстансу), Operation `POST /reports`, Find Traces, відкрити найновіший трейс.
4. Сам HTTP-запит коротенький (десятки мілісекунд), бо API лише кладе job у чергу і відповідає 202. Але нижче в тому самому дереві є span `reports.generate` сервісу `worker`: це вже інший процес, а трейс один, бо `traceparent` проїхав через Redis у даних job-у.
5. Розкрити `reports.generate`: п'ять span-ів `report.step 1..5` по ~1000 мс кожен. Це і є "повільний крок": робота звіту, а не БД і не Redis (span-и `pg.query:UPDATE` і `publish` поруч тривають по 1-3 мс).
6. Для контрасту створити звіт з `{"failRate":0.5}`: у Jaeger трейс матиме червоний span `reports.generate` з помилкою `Імітація збою на кроці N` і другий `reports.generate` (`job.attempt: 2`) після retry з backoff.

Що змінювати, щоб побачити різницю: `REPORT_STEP_MS=200` у `.env` робить кроки по 200 мс; `WORKER_CONCURRENCY=1` і три звіти поспіль покажуть, що третій `reports.generate` починається лише після завершення першого.

## Прохід 2: побачити чергу пулу з'єднань у /demo/pool/slow

`GET /demo/pool/slow?seconds=2&n=20` запускає 20 паралельних `SELECT pg_sleep(2)` при пулі на `DB_POOL_MAX=10` з'єднань. Запити 11-20 чекають, поки звільниться з'єднання.

1. Виконати:

   ```
   curl -s "localhost:8080/demo/pool/slow?seconds=2&n=20"
   ```

   У відповіді `timings[]`: у перших 10 `waitedForConnectionMs` близько 0, у решти близько 2000.

2. У Jaeger: Service `api-1`, Operation `GET /demo/pool/slow`, Find Traces, відкрити трейс. Тривалість усього запиту близько 4 с.
3. У дереві 20 пар span-ів `pg-pool.connect` і `pg.query:SELECT`. Перші 10 `pg-pool.connect` тривають менше мілісекунди і одразу починають `pg.query:SELECT` (2 с). Наступні 10 `pg-pool.connect` тривають ~2 с: це і є очікування у черзі пулу, і лише після них стартує їхній `pg.query:SELECT`.
4. Горизонтальні смужки складаються у дві "сходинки": перша десятка запитів у 0-2 с, друга у 2-4 с. Це візуальна відповідь на питання "чому 20 запитів по 2 с зайняли 4 с": не база повільна, а з'єднань 10.
5. Повторити з `n=10`: усі `pg-pool.connect` короткі, запит триває 2 с. Повторити з `DB_POOL_MAX=20` у `.env`: те саме для `n=20`.

Для порівняння `GET /demo/pool/stats` показує ті самі числа (`waiting`), але лише в момент виклику; трейс показує їх у часі.

## Типові питання

- **Трейсів немає.** Перевірити, що у логах API при старті є рядок `[tracing] увімкнено, span-и йдуть на ...`. Якщо немає, змінна `OTEL_EXPORTER_OTLP_ENDPOINT` порожня. Якщо є, але Jaeger порожній: у stderr буде `[tracing] не вдалося відправити span-и ...` з причиною (неправильний host, Jaeger не піднятий).
- **Трейс запиту є, а span-у воркера немає.** Воркер стартував без `OTEL_EXPORTER_OTLP_ENDPOINT`, або job створили не через `POST /reports` (наприклад, вручну з Bull Board: там `traceparent` немає, і воркер відкриє новий окремий трейс).
- **Чому не всі Redis-команди видно.** Інструментація `ioredis` створює span лише всередині іншого активного span-у (`requireParentSpan`). Фонове опитування черги воркером (BullMQ `bzpopmin` кожні кілька секунд) до жодного запиту не належить і в трейси не потрапляє, це навмисно.
- **У тестах трейсинг заважає?** Ні: `.env.test` не містить `OTEL_EXPORTER_OTLP_ENDPOINT`, SDK не стартує, `propagation.inject` лишає `traceparent` порожнім.

Попередня тема: [спостережуваність](observability.md) | Наступна тема: [shutdown](modules/shutdown.md)
