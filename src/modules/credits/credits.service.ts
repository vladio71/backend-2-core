// Що це: баланс кредитів і резервації. Серце: reserve() з SELECT ... FOR UPDATE.
// Чому: без блокування 20 паралельних reserve(10) на балансі 50 читають "50" одночасно,
// кожен вирішує "вистачає", і баланс іде в мінус (або рятує тільки CHECK, але з 500-ми).
// Хто викликає: CreditsController, CreditsCron (expireStale).
import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreditBalance } from './credit-balance.entity';
import { CreditReservation, ReservationStatus } from './credit-reservation.entity';
import { ConflictError, NotFoundError, UnprocessableError } from '../errors/domain-errors';
import { AppLogger } from '../logging/app-logger';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';

export const RESERVATION_TTL_MS = 10 * 60 * 1000;
// Баланс, до якого демо-скидання повертає користувача (сторінка "Кредити").
export const DEMO_BALANCE = 100;

export interface BalanceView {
  userId: string;
  balance: number;
  reserved: number;
}

@Injectable()
export class CreditsService {
  private readonly logger = new AppLogger('CreditsService');

  constructor(
    @InjectRepository(CreditBalance) private readonly balances: Repository<CreditBalance>,
    @InjectRepository(CreditReservation) private readonly reservations: Repository<CreditReservation>,
    private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getBalance(userId: string): Promise<BalanceView> {
    const row = await this.balances.findOne({ where: { userId } });
    const reserved: { sum: string | null } | undefined = await this.reservations
      .createQueryBuilder('r')
      .select('coalesce(sum(r.amount), 0)', 'sum')
      .where('r.user_id = :userId AND r.status = :status', { userId, status: 'reserved' })
      .getRawOne();
    return { userId, balance: row?.balance ?? 0, reserved: Number(reserved?.sum ?? 0) };
  }

  // Адмін поповнює. UPSERT: INSERT ... ON CONFLICT (user_id) DO UPDATE.
  async topup(userId: string, amount: number): Promise<BalanceView> {
    await this.dataSource.query(
      `INSERT INTO credit_balances (user_id, balance) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET balance = credit_balances.balance + EXCLUDED.balance, updated_at = now()`,
      [userId, amount],
    );
    return this.getBalance(userId);
  }

  async reserve(userId: string, amount: number): Promise<CreditReservation> {
    return this.dataSource.transaction(async (manager) => {
      // Песимістичний лок: SELECT ... FOR UPDATE. Друга транзакція на цьому ж рядку ЧЕКАЄ тут,
      // поки перша не зробить COMMIT/ROLLBACK. Тому вона побачить уже зменшений баланс.
      //
      // Без локу (гонка):
      //   T1: SELECT balance -> 50        T2: SELECT balance -> 50
      //   T1: 50 >= 10, ok                T2: 50 >= 10, ok
      //   T1: UPDATE balance = 40         T2: UPDATE balance = 40   <- загублене списання
      // Рядка балансу може ще не бути (новий користувач без поповнень): створюємо з нулем, щоб відповідь була
      // "недостатньо кредитів" (422), а не "не знайдено" (404). ON CONFLICT DO NOTHING безпечний при гонці.
      await manager.query(`INSERT INTO credit_balances (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`, [userId]);
      const balance = await manager.findOne(CreditBalance, { where: { userId }, lock: { mode: 'pessimistic_write' } });
      if (!balance) throw new NotFoundError('CreditBalance', userId);
      if (balance.balance < amount) {
        throw new UnprocessableError('INSUFFICIENT_CREDITS', `Недостатньо кредитів: є ${balance.balance}, потрібно ${amount}`, {
          balance: balance.balance,
          amount,
        });
      }
      await manager.update(CreditBalance, { userId }, { balance: balance.balance - amount });
      const reservation = manager.create(CreditReservation, {
        userId,
        amount,
        status: 'reserved',
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      });
      return manager.save(reservation);
    });
  }

  // ТІЛЬКИ ДЛЯ ДЕМО (сторінка "Кредити"): те саме reserve, але наївно, без локу.
  // SELECT balance, перевірка в JS, UPDATE balance = <число, пораховане в JS>. Транзакція є, а ізоляції від сусідів немає:
  // в READ COMMITTED кожна транзакція бачить "50", кожна пише "40", і чотири списання з п'яти губляться.
  // CHECK (balance >= 0) тут НЕ допомагає: втрачене списання лишає баланс додатним, тож БД нічого не помічає.
  // У production цей шлях вимкнений.
  async reserveUnsafe(userId: string, amount: number): Promise<CreditReservation> {
    this.assertDemoAllowed();
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`INSERT INTO credit_balances (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`, [userId]);
      const rows: Array<{ balance: number }> = await manager.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [userId]);
      const current = rows[0].balance;
      if (current < amount) {
        throw new UnprocessableError('INSUFFICIENT_CREDITS', `Недостатньо кредитів: є ${current}, потрібно ${amount}`, { balance: current, amount });
      }
      await manager.query(`UPDATE credit_balances SET balance = $2, updated_at = now() WHERE user_id = $1`, [userId, current - amount]);
      const reservation = manager.create(CreditReservation, {
        userId,
        amount,
        status: 'reserved',
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      });
      return manager.save(reservation);
    });
  }

  // ТІЛЬКИ ДЛЯ ДЕМО: повернути користувача до відомого стану. Баланс = 100, активні резервації закриваємо (released).
  // Кредити назад не додаємо: баланс і так виставляється числом.
  async demoReset(userId: string): Promise<BalanceView> {
    this.assertDemoAllowed();
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO credit_balances (user_id, balance) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now()`,
        [userId, DEMO_BALANCE],
      );
      await manager.query(`UPDATE credit_reservations SET status = 'released' WHERE user_id = $1 AND status = 'reserved'`, [userId]);
    });
    return this.getBalance(userId);
  }

  private assertDemoAllowed(): void {
    if (this.config.NODE_ENV === 'production') throw new NotFoundError('Route', 'demo');
  }

  // Підтвердити: кредити списані остаточно. Повернути нічого не треба, тільки змінити статус.
  async confirm(userId: string, reservationId: string): Promise<CreditReservation> {
    return this.dataSource.transaction(async (manager) => {
      const r = await this.lockReservation(manager, userId, reservationId);
      if (r.status !== 'reserved') throw new ConflictError('RESERVATION_NOT_ACTIVE', `Резервація у статусі ${r.status}`);
      r.status = 'confirmed';
      return manager.save(r);
    });
  }

  // Відпустити: повернути кредити на баланс.
  async release(userId: string, reservationId: string): Promise<CreditReservation> {
    return this.dataSource.transaction(async (manager) => {
      const r = await this.lockReservation(manager, userId, reservationId);
      if (r.status !== 'reserved') throw new ConflictError('RESERVATION_NOT_ACTIVE', `Резервація у статусі ${r.status}`);
      await this.returnToBalance(manager, r, 'released');
      return r;
    });
  }

  // Викликається кроном щохвилини: усі "reserved" з простроченим expires_at повертаємо на баланс.
  // Вибираємо в SQL лише прострочені (expires_at <= now()), а не всі активні: інакше щохвилини читали б усю таблицю.
  // Одна зламана резервація не зупиняє решту: помилку логуємо і йдемо далі, її підхопить наступний запуск.
  async expireStale(): Promise<number> {
    const stale = await this.reservations
      .createQueryBuilder('r')
      .where('r.status = :status AND r.expires_at <= now()', { status: 'reserved' as ReservationStatus })
      .getMany();
    let count = 0;
    for (const r of stale) {
      try {
        await this.dataSource.transaction(async (manager) => {
          // Лок на рядку резервації + повторна перевірка статусу: якщо її вже підтвердили, відпустили або
          // протермінував інший екземпляр API (крон біжить в api-1 і api-2), ми побачимо не "reserved" і нічого не робимо.
          const locked = await this.lockReservation(manager, r.userId, r.id);
          if (locked.status !== 'reserved') return;
          await this.returnToBalance(manager, locked, 'expired');
          count += 1;
        });
      } catch (err) {
        this.logger.error(`Не вдалося протермінувати резервацію ${r.id}`, err);
      }
    }
    if (count > 0) this.logger.info(`Протерміновано резервацій: ${count}`);
    return count;
  }

  private async lockReservation(manager: EntityManager, userId: string, id: string): Promise<CreditReservation> {
    const r = await manager.findOne(CreditReservation, { where: { id, userId }, lock: { mode: 'pessimistic_write' } });
    if (!r) throw new NotFoundError('CreditReservation', id);
    return r;
  }

  // Порядок локів однаковий скрізь: спочатку резервація, потім баланс. Якщо в одному місці брати
  // баланс -> резервацію, а в іншому резервацію -> баланс, два запити можуть чекати один одного (deadlock).
  private async returnToBalance(manager: EntityManager, r: CreditReservation, status: ReservationStatus): Promise<void> {
    await manager.findOne(CreditBalance, { where: { userId: r.userId }, lock: { mode: 'pessimistic_write' } });
    await manager.increment(CreditBalance, { userId: r.userId }, 'balance', r.amount);
    r.status = status;
    await manager.save(r);
  }
}
