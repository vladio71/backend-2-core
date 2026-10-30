# security

## Що це
- `helmet()` ставить безпечні заголовки (`X-Content-Type-Options`, `Strict-Transport-Security`, ...). CSP вимкнено, бо Scalar і демо-сторінка вантажать скрипти з CDN; у своєму фронтенді вмикайте.
- CORS: список origin-ів з `CORS_ORIGINS`.
- bcrypt з `BCRYPT_COST=10` (2^10 раундів, приблизно 50-100 мс на хеш). Збільшуйте, коли залізо швидшає; 12 для production з запасом. Вартість робить перебір дорогим: 100 мс на спробу = 10 паролів/с на ядро.
- `GET /demo/sql-injection` існує ТІЛЬКИ при `NODE_ENV=development` (`SecurityModule.forEnv`: у production контролера немає в застосунку взагалі).

Payload `' OR 1=1 --`:

| | SQL | Результат |
|---|---|---|
| `?safe=false&q=' OR 1=1 --` | `SELECT id, email FROM users WHERE email = '' OR 1=1 --'` | усі користувачі |
| `?safe=true&q=' OR 1=1 --` | `SELECT id, email FROM users WHERE email = $1` з `$1 = "' OR 1=1 --"` | порожньо |

Параметр ніколи не стає частиною SQL: Postgres отримує текст запиту і значення окремо.

## Чому так
- Ніколи md5/sha1/sha256 для паролів: вони швидкі (мільярди на секунду на GPU) і без солі однакові паролі дають однакові хеші. bcrypt повільний навмисно і має сіль усередині.
- Ніколи не логувати токени, паролі, refresh-токени, `Authorization`: логи живуть довго, їх читають багато людей, вони потрапляють у сторонні системи. У цьому проєкті логер пише тільки метод, url, статус і час.
- Refresh-токени зберігаються як sha256 (тут хеш доречний: токен випадковий і довгий, перебір безглуздий), щоб витік БД не давав сесій.
- `whitelist + forbidNonWhitelisted`: клієнт не підкине `role: "admin"` у реєстрацію.
- Однакова 401 для "немає користувача" і "не той пароль".

## Де в коді
- `src/main.ts`: helmet, CORS.
- `src/modules/security/sql-injection.controller.ts`, `security.module.ts`.
- `src/modules/auth/auth.service.ts`: bcrypt, sha256 для refresh.
- `.env.example`: `BCRYPT_COST`, `CORS_ORIGINS`.

## Спробуй сам
1. Виміряй `bcrypt.hash` з cost 10, 12, 14 на своїй машині (`console.time`). Обери значення для production.
2. Знайди в `posts-per-day.controller.ts` параметр `days` і спробуй передати `days=1; DROP TABLE posts`. Чому не спрацює? (Підказка: `ParseIntPipe` і `$1`.)

Попередня тема: [ratelimit](ratelimit.md) | Наступна тема: [спостережуваність](../observability.md)
