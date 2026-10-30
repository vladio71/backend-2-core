# Спостережуваність: логи, метрики, трейси

## Три інструменти

| Інструмент | На яке питання відповідає | Де в devhub | Де дивитись |
|---|---|---|---|
| Логи | що сталося з одним конкретним запитом | `AppLogger`, JSON на рядок з `requestId` ([docs/modules/logging.md](modules/logging.md)) | Loki через Grafana, або `docker compose logs api-1` |
| Метрики | скільки, як швидко, скільки помилок за час (не один запит, а всі разом) | `src/modules/metrics`, prom-client, `GET /metrics` | Prometheus, дашборд у Grafana |
| Трейси | де саме всередині одного запиту витрачено час (SQL, Redis, воркер) | OpenTelemetry ([docs/tracing.md](tracing.md)) | Jaeger |

Логи і трейси описують один запит. Метрики описують усі запити за хвилину одним числом. Тому починати з метрик (бачиш, ЩО не так), а далі йти в трейс і логи (бачиш, ЧОМУ).

## Як запустити

```
docker compose --profile observability up --build
```

Профіль додає чотири контейнери до звичайного стенду: `prometheus`, `loki`, `promtail`, `grafana`. Без `--profile observability` вони не стартують, звичайний `docker compose up --build` працює як раніше.

Що відкрити:

- http://localhost:3001: Grafana (логін `admin` / `admin`, без логіну теж можна дивитись). Дашборд `devhub` у списку Dashboards.
- http://localhost:9090: Prometheus. Вкладка Graph, у поле запиту `http_requests_total`, Execute: сирі числа без дашборда.
- http://localhost:16686: Jaeger, трейси (як і без профілю).
- http://localhost:3000/metrics не відкриється, бо API не публікує порт назовні: `docker compose exec api-1 wget -qO- localhost:3000/metrics`. Воркер: `docker compose exec worker wget -qO- localhost:9464/metrics`.

Без Docker: API віддає `GET /metrics` на своєму порту (`curl localhost:3000/metrics`), воркер на `METRICS_PORT` (типово `curl localhost:9464/metrics`). Prometheus і Grafana при цьому треба піднімати окремо, тому для навчання простіше профіль.

## Що таке /metrics

Текст, один рядок на число:

```
http_requests_total{method="GET",route="/posts",status="200"} 42
http_request_duration_seconds_bucket{le="0.1",method="GET",route="/posts"} 40
pg_pool_waiting 0
bullmq_queue_jobs{queue="reports",state="waiting"} 3
```

Prometheus раз на 5 с забирає цей текст з `api-1`, `api-2` і `worker` і запам'ятовує з часом (pull: ми нічого не шлемо, він сам приходить). Три типи чисел:

- **Counter** (`_total`): тільки росте. Саме число нецікаве, цікава швидкість росту: `rate(http_requests_total[1m])` = запитів за секунду.
- **Gauge**: поточне значення, може рости і падати: `pg_pool_waiting`, `http_requests_in_flight`, `bullmq_queue_jobs`.
- **Histogram**: скільки запитів вклалося у 5 мс, 10 мс, ..., 10 с (`_bucket{le=...}`). З нього Grafana рахує p50 і p95.

Label `route` це шаблон маршруту (`/posts/:id`), а не сирий URL: інакше кожен id був би окремою серією. `/metrics` і `/health` не рахуються, бо їх смикають Prometheus і healthcheck, а не користувачі.

Що є: `http_requests_total{method,route,status}`, `http_request_duration_seconds{method,route}`, `http_requests_in_flight`, `pg_pool_total` / `pg_pool_idle` / `pg_pool_waiting` (ті самі числа, що у `GET /demo/pool/stats`), `bullmq_queue_jobs{queue,state}` (оновлюється раз на 5 с з Redis), `reports_processed_total{status}` (лише воркер), плюс стандартні `process_*` і `nodejs_*` (пам'ять, CPU, event loop).

Де в коді: `src/modules/metrics/metrics.service.ts` (усі метрики), `metrics.middleware.ts` (рахує HTTP), `metrics.controller.ts` (`GET /metrics` у API), `metrics-http-server.ts` (сервер у воркері), `src/modules/jobs/reports.processor.ts` (`reports_processed_total`). Конфіги: `observability/prometheus.yml`, `observability/promtail.yml`, `observability/grafana/`.

## Прохід: знайди повільний ендпоінт

1. Зробити трафік: `curl "localhost:8080/demo/pool/slow?seconds=2&n=20"` два-три рази і кілька `curl localhost:8080/posts`.
2. Grafana, дашборд `devhub`, панель **p95 по маршрутах**: лінія `/demo/pool/slow` на 4 с, `/posts` на мілісекундах. Поруч **Пул Postgres**: `waiting` підскочив до 10. Це відповідь на "ЩО повільне": один маршрут, і він чекає на пул.
3. Jaeger: Service `api-1` (або `api-2`), Operation `GET /demo/pool/slow`, Find Traces, відкрити трейс. 20 пар `pg-pool.connect` і `pg.query:SELECT`, у другої десятки `pg-pool.connect` триває 2 с. Це відповідь на "ДЕ всередині запиту": не SQL повільний, а очікування з'єднання (детально у [docs/tracing.md](tracing.md), прохід 2).
4. Логи того самого запиту: у відповіді `curl -i` є заголовок `X-Request-Id`. У Grafana вгорі дашборда поле `requestId`, вставити значення: панель **Логи api-1** показує лише рядки цього запиту (`GET /demo/pool/slow 200 4031ms`). Якщо запит пішов на `api-2`, у запиті панелі змінити `service="api-1"` на `api-2`. Те саме без Grafana: `docker compose logs api-1 | grep <requestId>`.

Ланцюжок завжди той самий: дашборд (p95, помилки, черга) -> Jaeger (трейс) -> Loki (логи за requestId).

## На які числа дивитись і коли турбуватись

| Панель | Норма для devhub | Турбуватись, коли | Що це зазвичай означає |
|---|---|---|---|
| p95 затримки | десятки мс (`/posts`, `/auth/*`), `/demo/pool/slow` навмисно секунди | p95 понад 500 мс на звичайних маршрутах | повільний SQL без індексу, N+1, очікування пулу, зовнішній API всередині запиту. Далі: Jaeger |
| Помилки 5xx | 0 % | понад 1 % запитів | впав код або залежність (Postgres, Redis). Далі: логи `level=error` за requestId |
| 429 | з'являються, коли спрацьовує token bucket (`POST /posts` 11-й за 10 с) або `QUEUE_FULL` | не турбуватись: ліміт працює як задумано. Турбуватись лише, якщо 429 ловлять звичайні користувачі при звичайному трафіку: ліміт замалий | клієнт шле забагато, або `RATE_LIMIT_CAPACITY` / `QUEUE_MAX_WAITING` треба переглянути |
| Пул: waiting | 0 | більше 0 довше кількох секунд (короткий пік на `/demo/pool/slow` це норма) | `DB_POOL_MAX` замалий або хтось тримає з'єднання: довга транзакція, HTTP-виклик усередині транзакції ([docs/modules/pool.md](modules/pool.md)) |
| Пул: idle | близько total у спокої | idle = 0 постійно при total = max | усі з'єднання зайняті весь час, API на межі |
| Черга: waiting | 0 або короткі піки | росте і не спадає | воркер не встигає (`WORKER_CONCURRENCY` замалий), воркер упав, або job-и падають і йдуть у retry (`delayed` теж росте) |
| Черга: failed | 0 | росте | дивитись Bull Board `/queues`, текст помилки у job-і, логи воркера за requestId |
| Звіти failed | 0 при `failRate: 0` | failed при `failRate: 0` | справжня помилка у воркері, не імітація |
| Пам'ять Node: heap used | стабільно коливається | росте годинами і не падає | витік: слухачі, кеш без ліміту, незакриті з'єднання |
| RPS | скільки є | різко впав до 0 при живому трафіку | API не приймає запити: `docker compose ps`, `/health` |

Порядок, коли щось не так: подивитись RPS і помилки (чи взагалі живі), потім p95 (чи повільно), потім пул і чергу (чому повільно), потім трейс і логи конкретного запиту.

## Типові питання

- **Prometheus показує target DOWN.** http://localhost:9090/targets: якщо `api-1:3000` червоний, API ще не піднявся або впав; `worker:9464` червоний, значить воркер стартував без `MetricsWorkerModule` або `METRICS_PORT` інший.
- **На дашборді No data.** Трафіку ще не було, або дашборд дивиться на останні 15 хв до старту. Зробити кілька запитів і почекати 5-10 с (scrape раз на 5 с).
- **Панель логів порожня.** Promtail потребує `/var/run/docker.sock`; на Mac і Windows з Docker Desktop це працює, на rootless Docker шлях інший. Перевірити: `docker compose logs promtail`.
- **Чи це замінює Jaeger?** Ні. Grafana має джерело даних Jaeger (Explore -> Jaeger), але дашборд показує метрики і логи; трейси зручніше дивитись у Jaeger UI.

Попередня тема: [security](modules/security.md) | Наступна тема: [трейсинг](tracing.md)
