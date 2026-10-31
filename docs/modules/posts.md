# posts: CRUD, валідація, пагінація, soft delete, транзакція

## Що це
- Глибока валідація DTO: `meta.seo.title` перевіряється через `@ValidateNested` + `@Type`. `likes: "42"` стає `42` через `@Type(() => Number)`. Невідоме поле на будь-якому рівні дає 400 з текстом `property hacker should not exist`.
- `GET /posts`: фільтри `q`, `tags` (`tagsMode=any|all`), `authorId`, `status`, `dateFrom`/`dateTo`; сортування `sort=createdAt|title|likes`, `dir=asc|desc`; пагінація offset (`page`, `pageSize`, у відповіді `total`) або cursor (`mode=cursor`, `cursor=`, у відповіді `nextCursor`).
- `DELETE /posts/:id` ставить `deleted_at`, `POST /posts/:id/restore` прибирає.
- `POST /posts/:id/publish`: статус поста і рядок у `activity` в одній транзакції.

| | Offset | Cursor |
|---|---|---|
| Запит | `?page=3&pageSize=10` | `?mode=cursor&pageSize=10&cursor=eyJ2...` |
| SQL | `ORDER BY ... LIMIT 10 OFFSET 20` | `WHERE (created_at, id) < ($v, $id) ORDER BY ... LIMIT 11` |
| Дає `total` і "сторінка 7 з 40" | так | ні |
| Стабільний при вставках між запитами | ні (рядки зсуваються, дублікати або пропуски) | так |
| Вартість сторінки N | O(N * pageSize): читає і викидає | O(pageSize) |
| Коли | адмінки, таблиці з номерами сторінок, малі таблиці | стрічки, нескінченний скрол, великі таблиці, API для мобільних |

Курсор це base64 від `{ "v": <значення сортування>, "id": <id> }` останнього елемента. `id` потрібен, бо значення сортування можуть збігатися (два пости з 5 лайками).

Час у курсорі це текст із повною точністю Postgres (`2030-01-01T00:00:00.123456Z`, мікросекунди), який БД віддає через `to_char(...)`. Якщо брати `post.createdAt` (JS `Date`), мікросекунди губляться: пости з тією самою мілісекундою при `DESC` пропускаються, при `ASC` повторюються. Курсор валідується проти поля сортування (`createdAt` це дата ISO-8601 UTC, `likes` ціле, `title` рядок, `id` це uuid). Пошкоджений курсор і курсор не під те поле (`sort=likes` з датою) однаково дають `400 BAD_CURSOR` (раніше пошкоджений давав 409, а курсор зі сміттям у `v` падав у 500).

## Чому так
`whitelist + forbidNonWhitelisted`: клієнт не може підкинути поле `role` або `authorId` і сподіватися, що воно збережеться. Soft delete: видалене лишається у звітах, можна відновити, зовнішні ключі не ламаються; мінус: кожен запит має пам'ятати про `deleted_at IS NULL` (TypeORM робить це сам через `@DeleteDateColumn`, сирий SQL ні). Транзакція в `publish`: статус міняє один атомарний `UPDATE ... WHERE id = $1 AND status = 'draft'` (`affected = 0` це 409), тому два паралельні publish не створять два рядки в `activity`. Без транзакції при падінні другого `INSERT` пост буде `published` без запису в журналі, і ніхто не дізнається. У транзакції треба використовувати `manager`, а не `this.posts`: репозиторій поза `manager` піде окремим з'єднанням і не відкотиться.

## Де в коді
- `src/modules/posts/dto/create-post.dto.ts`, `list-posts.dto.ts`.
- `src/modules/posts/posts.service.ts`: `list()` з обома пагінаціями, `publish()` з транзакцією і параметром `failActivity` для тесту.
- `src/app-setup.ts`: налаштування `ValidationPipe`.
- `test/e2e/posts.e2e-spec.ts`: "падіння другого запису відкочує перший".

## Спробуй сам
1. Додай сортування `sort=publishedAt`. Що робити з `null` у курсорі? Підказка: `NULLS LAST` і значення-заглушка.
2. Напиши тест: вставити новий пост МІЖ двома запитами сторінок. Offset дасть дублікат, cursor ні.

Попередня тема: [errors](errors.md) | Наступна тема: [migrations](migrations.md)
