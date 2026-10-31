# migrations: схема тільки через міграції

## Що це
Три міграції, написані руками:

1. `1700000000001-InitSchema`: усі таблиці, індекси, CHECK.
2. `1700000000002-AddPostEmbedding`: `CREATE EXTENSION vector` і колонка `posts.embedding vector(384)`. Якщо розширення немає і це не production, пропускається з попередженням.
3. `1700000000003-AddEventsUserCreatedIndex`: складений індекс `events(user_id, created_at)`. Окрема, щоб її можна було відкотити на 200 000 рядків і порівняти плани (див. `queries.md`).

Команди:

```
npm run migration:run       # накотити все нове
npm run migration:revert    # відкотити ОДНУ останню
npm run migration:show      # що накочено, що ні
npm run migration:generate src/migrations/NazvaZminy   # згенерувати з різниці entity vs БД (перевір очима!)
```

`synchronize: false` у `data-source-options.ts`.

## Чому так
`synchronize: true` порівнює сутності з БД і сам застосовує різницю. Перейменував поле `title` на `heading`? TypeORM зробить `DROP COLUMN title, ADD COLUMN heading`. Дані зникли. Міграція це код у git: її читають на review, проганяють на staging, відкочують, якщо щось пішло не так. `CREATE INDEX` на великій таблиці блокує записи; у production роблять `CREATE INDEX CONCURRENTLY` поза транзакцією (TypeORM: `transaction: false` для цієї міграції).

## Де в коді
- `src/migrations/*.ts` і `src/migrations/index.ts` (список).
- `src/data-source.ts`: DataSource для CLI.
- `src/modules/database/data-source-options.ts`: спільні опції для CLI і застосунку.
- `src/entities.ts`: список сутностей. Його передають у `DatabaseModule.forRoot(entities)` і у CLI, щоб `database` не імпортував feature-модулі.
- `test/int/migrations.int-spec.ts`: revert прибирає індекс, run повертає.

## Спробуй сам
1. Додай поле `slug text` у `posts`: зміни entity, виконай `migration:generate`, прочитай згенерований SQL, накоти, відкоти.
2. Зроби міграцію, яка заповнює `slug` з `title` для існуючих рядків (UPDATE у `up()`, нічого в `down()`). Подумай, чому down тут порожній.

Попередня тема: [posts](posts.md) | Наступна тема: [time](time.md)
