# ratelimit: token bucket у Redis

## Що це
Власний token bucket: 10 запитів за 10 с на користувача (або IP для анонімних), застосований до `POST /posts`. Заголовки `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; при відмові 429 з `Retry-After`. Для порівняння `GET /demo/throttled` обмежений готовим `@nestjs/throttler` (fixed window 10/10 с).

```
Token bucket (ємність 10, +1 токен/с):            Fixed window (10 за вікно 10 с):

токени   10 |*                                     лічильник 10 |         *
            |  *                 *                              |        * *
          5 |    *   *   *  *                                 5 |       *   *
            |      * * * *  *   *                               |      *     *
          0 +------------------------> час                    0 +--*-*-------*--> час
            0   2   4   6   8  10  12                             0  2  4  6  8 10 12
         сплеск з 10 запитів у t=0 проходить,            10 запитів у t=9.9 і ще 10 у t=10.1
         далі рівно 1 запит/с; відмова лише              проходять усі (20 за 0.2 с), бо вікно
         коли відро порожнє                              скинулось на межі
```

## Чому так
Token bucket пропускає короткий сплеск (ємність відра) і далі обмежує середню швидкість (поповнення). Fixed window простіший, але на межі вікон пропускає подвійний ліміт. Атомарність: "прочитати, порахувати, записати" трьома командами з Node дає гонку між двома одночасними запитами; Lua-скрипт виконується в Redis як одна операція. Redis, а не пам'ять процесу: два інстанси API мають спільний лічильник.

## Де в коді
- `src/modules/ratelimit/token-bucket.service.ts`: Lua-скрипт з коментарями.
- `src/modules/ratelimit/token-bucket.guard.ts`: заголовки і 429.
- `src/modules/ratelimit/throttler-demo.controller.ts`.
- `src/modules/posts/posts.controller.ts`: `@UseGuards(JwtAuthGuard, TokenBucketGuard)` на `POST`.
- `src/modules/ratelimit/token-bucket.service.spec.ts` (фейковий Redis), `test/e2e/posts.e2e-spec.ts` ("11-й POST").

## Спробуй сам
1. Зроби вартість запиту залежною від розміру тіла: `cost = 1 + Math.floor(body.length / 1000)`.
2. Реалізуй sliding window log на `ZADD`/`ZREMRANGEBYSCORE`/`ZCARD` у `MULTI` і повісь на `GET /demo/sliding`. Порівняй поведінку на межі вікна з обома існуючими.
