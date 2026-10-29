# credits: песимістичний лок

## Що це
- `GET /credits/me`: баланс і сума активних резервацій.
- `POST /credits/topup` (admin): `INSERT ... ON CONFLICT DO UPDATE`.
- `POST /credits/reserve { amount }`: списує з балансу, створює резервацію на 10 хв.
- `POST /credits/reservations/:id/confirm | release`.
- Крон щохвилини (`CreditsCron`) повертає кредити з протермінованих резервацій.
- `CHECK (balance >= 0)` у БД.

e2e-тест: 20 паралельних `reserve(10)` на балансі 50 дають рівно 5 відповідей 201 і 15 відповідей 422, баланс 0.

## Чому так
Без локу (гонка):

```
T1: SELECT balance -> 50        T2: SELECT balance -> 50
T1: 50 >= 10, ok                T2: 50 >= 10, ok
T1: UPDATE balance = 40         T2: UPDATE balance = 40    <- одне списання загублене
```

З `SELECT ... FOR UPDATE` (`lock: { mode: 'pessimistic_write' }` у TypeORM):

```
T1: SELECT ... FOR UPDATE -> 50 (рядок заблоковано)
T2: SELECT ... FOR UPDATE ...   (чекає)
T1: UPDATE balance = 40; COMMIT
T2: ... -> 40 (бачить уже оновлене)
T2: 40 >= 10, ok; UPDATE balance = 30
```

Лок живе до кінця транзакції, тому все, що між `SELECT FOR UPDATE` і `COMMIT`, має бути коротким і без зовнішніх викликів (див. `pool.md`). `CHECK` у БД: остання лінія оборони, якщо хтось напише `UPDATE` без локу. Тест на це є.

Порядок локів. `release` і `expireStale` беруть спочатку резервацію, потім баланс. Якщо десь інде взяти навпаки (баланс, потім резервацію), дві транзакції можуть чекати одна одну вічно: deadlock. Postgres його помітить і вб'є одну з них, але це вже помилка в коді. Правило: один порядок скрізь.

## Де в коді
- `src/modules/credits/credits.service.ts`: `reserve()` з коментарем про гонку, `returnToBalance()` про порядок локів.
- `src/modules/credits/credits.cron.ts`: `@Cron(EVERY_MINUTE)`.
- `src/migrations/1700000000001-InitSchema.ts`: `credit_balances_balance_non_negative`.
- `test/e2e/credits.e2e-spec.ts`.

## Спробуй сам
1. Прибери `lock` у `reserve()` і запусти `test/e2e/credits.e2e-spec.ts`. Скільки разів із 10 прогонів тест упаде? Поверни лок.
2. Реалізуй оптимістичну версію: колонка `version`, `UPDATE ... SET balance = balance - $1, version = version + 1 WHERE user_id = $2 AND version = $3`, при 0 оновлених рядків повтор. Порівняй кількість 422 у тому ж тесті.
