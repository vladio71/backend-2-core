# auth: JWT access + refresh з ротацією

## Що це
- `POST /auth/register`, `POST /auth/login`: bcrypt (cost 10), у відповіді `accessToken` (JWT, 15 хв) і `refreshToken` (32 випадкові байти).
- `GET /auth/me`: потребує `Authorization: Bearer <accessToken>`.
- `POST /auth/refresh`: видає нову пару, старий refresh позначається використаним.
- `POST /auth/logout`: відкликає всю сім'ю refresh-токенів.
- Ролі `user | admin`: `@Roles('admin')` + `RolesGuard`.

```
клієнт                         API                              БД
  |-- POST /auth/login -------->|                                 |
  |                             |-- bcrypt.compare -------------->|
  |<-- access(15m) + refresh ---|-- INSERT refresh_tokens(hash) ->|
  |                             |                                 |
  |-- GET /posts  Bearer access>|  verify підпис, без БД          |
  |<-- 200 --------------------|                                 |
  |                             |                                 |
  | ... 15 хв минуло, 401 ...   |                                 |
  |-- POST /auth/refresh ------>|-- SELECT by hash -------------->|
  |                             |   used_at IS NULL? ok           |
  |                             |-- UPDATE used_at = now() ------>|
  |<-- новий access + refresh --|-- INSERT новий (та сама сім'я)->|
  |                             |                                 |
  |-- refresh СТАРИМ токеном -->|   used_at NOT NULL: крадіжка!   |
  |<-- 401 ---------------------|-- UPDATE revoked_at WHERE family|
```

## Чому так
Access-токен перевіряється тільки підписом, без запиту до БД: дешево, але його не можна відкликати, тому він живе 15 хв. Refresh живе довго, тому зберігається в БД (тільки sha256-хеш: витік бази не дає токенів) і його можна відкликати. Ротація: кожен refresh спалює попередній. Якщо спалений токен прийшов знову, його хтось вкрав: відкликаємо всю сім'ю, обом доведеться логінитись. Логін з неправильним паролем і з неіснуючим email дають однакову 401: не підказуємо, які email існують.

## Де в коді
- `src/modules/auth/auth.service.ts`: уся логіка, коментар про сім'ї.
- `src/modules/auth/jwt.service.ts`: `sign`/`verify` через `jsonwebtoken`.
- `src/modules/auth/jwt-auth.guard.ts`, `src/modules/auth/roles.ts`: guard-и, `@CurrentUser()`.
- `src/modules/auth/refresh-token.entity.ts`.
- `test/e2e/auth.e2e-spec.ts`: ротація, повторне використання, ролі.

## Спробуй сам
1. Додай `GET /auth/sessions`: список активних refresh-токенів користувача (без хешів: id, createdAt, expiresAt) і `DELETE /auth/sessions/:id`.
2. Зроби так, щоб `JWT_ACCESS_TTL_SECONDS=1`, і напиши e2e-тест: після `sleep(1500)` `GET /auth/me` дає 401, а після refresh знову 200.

Наступна тема: [config](config.md)
