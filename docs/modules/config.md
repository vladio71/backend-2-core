# config: змінні оточення через zod

## Що це
Усі змінні оточення читаються один раз при старті і перевіряються zod-схемою. Далі код працює з типізованим об'єктом `AppConfig`, а не з `process.env.X`, який може бути `undefined`.

Якщо бракує `DATABASE_URL` або `JWT_SECRET`, процес не стартує і друкує:

```
Застосунок не може стартувати: помилки у змінних оточення.
  DATABASE_URL: Invalid input: expected string, received undefined. Підказка: Рядок підключення до PostgreSQL, напр. postgres://devhub:devhub@localhost:5432/devhub
  JWT_SECRET: Invalid input: expected string, received undefined. Підказка: Секрет для підпису JWT, мінімум 16 символів. Згенеруй: openssl rand -hex 32
Див. .env.example у корені проєкту.
```

## Чому так
Помилка конфігурації має впасти на старті, а не в третьому запиті через годину. `z.coerce.number()` перетворює `"10"` у `10`, тому `DB_POOL_MAX=10` з env стає числом і далі ніхто не робить `Number(...)` по коду. Значення за замовчуванням живуть в одному місці, а не розкидані по сервісах.

## Де в коді
- `src/modules/config/config.schema.ts`: схема і тип `AppConfig`.
- `src/modules/config/config.module.ts`: `loadConfig()`, глобальний провайдер `APP_CONFIG`.
- `src/modules/config/config.spec.ts`: unit-тест на помилку і на перетворення типів.
- `.env.example`: усі змінні з коментарями.

Приклад використання в сервісі:

```ts
constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
// this.config.DB_POOL_MAX: number
```

## Спробуй сам
1. Прибери `JWT_SECRET` з `.env` і запусти `npm run dev`. Прочитай повідомлення. Поверни назад.
2. Додай змінну `MAX_POST_TAGS` (число, типово 10) у схему і використай її у `CreatePostDto` замість `@ArrayMaxSize(10)`.
