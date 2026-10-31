# errors: одна форма помилки

## Що це
Будь-яка помилка повертається в одній формі:

```json
{ "statusCode": 404, "code": "NOT_FOUND", "message": "Post 3f2... не знайдено", "details": { "entity": "Post", "id": "3f2..." }, "requestId": "7c1b..." }
```

Сервіси кидають доменні класи (`NotFoundError`, `ConflictError`, ...), а глобальний фільтр перекладає їх у HTTP-код. Помилки валідації від `ValidationPipe` теж проходять через фільтр: `code: VALIDATION_ERROR`, у `details` список повідомлень з назвами полів.

## Чому так
Фронтенд пише одну функцію обробки помилок. Сервіс не знає про HTTP: `throw new NotFoundError('Post', id)` можна викликати і з воркера, і з крону. Невідомі помилки (баги) стають `500 INTERNAL_ERROR` без тексту винятку назовні, а повний stack іде в лог з `requestId`.

Коли який код:

| Код | Коли | Приклад у проєкті |
|---|---|---|
| 400 | Тіло або query не проходять валідацію | невідоме поле в `POST /posts`; `BAD_CURSOR` (`BadRequestError`) для пошкодженого курсора |
| 401 | Немає або невалідний токен | `GET /auth/me` без Bearer |
| 403 | Користувач відомий, але права не ті | user викликає `POST /credits/topup` |
| 404 | Об'єкта немає (або він м'яко видалений) | `GET /posts/:id` після DELETE |
| 409 | Конфлікт стану | email зайнятий, пост уже опублікований |
| 422 | Запит валідний, але бізнес-правило не дозволяє | `INSUFFICIENT_CREDITS` |
| 429 | Ліміт | token bucket, `QUEUE_FULL` |
| 500 | Наш баг | будь-який необроблений виняток |
| 502 | Зовнішній сервіс відповів сміттям | `LLM_BAD_OUTPUT`, `GITHUB_RATE_LIMITED` |

## Де в коді
- `src/modules/errors/domain-errors.ts`: класи помилок.
- `src/modules/errors/http-exception.filter.ts`: мапінг на коди, формування JSON, логування.
- `src/app-setup.ts`: `app.useGlobalFilters(new AllExceptionsFilter())`.
- `test/e2e/foundation.e2e-spec.ts`: 404 і 400 у єдиній формі.

## Спробуй сам
1. Додай `GoneError` (410) і використай його в `GET /posts/:id`, коли пост м'яко видалений, замість 404. Онови таблицю.
2. Зроби так, щоб у `production` поле `details` для 500 не віддавалось, а в `development` містило `stack`.

Попередня тема: [config](config.md) | Наступна тема: [posts](posts.md)
