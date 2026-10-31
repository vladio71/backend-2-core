// Кредити і локи: баланс, topup (admin), 20 паралельних reserve(10), confirm/release резервацій.
import { useCallback, useEffect, useState } from 'react';
import { apiCall, ApiExchange } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, Explain, NeedAuth, PageTitle, WhereInCode } from '../components/common';

interface Balance {
  userId: string;
  balance: number;
  reserved: number;
}

interface Reservation {
  id: string;
  amount: number;
  status: string;
  expiresAt: string;
}

function isReservation(body: unknown): body is Reservation {
  return typeof body === 'object' && body !== null && 'id' in body && 'amount' in body && 'status' in body;
}

export function CreditsPage() {
  const auth = useAuth();
  const latency = useLatency();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [topupUser, setTopupUser] = useState('');
  const [topupAmount, setTopupAmount] = useState(50);
  const [parallel, setParallel] = useState<ApiExchange[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [parallelMs, setParallelMs] = useState<number | null>(null);

  const loadBalance = useCallback(async () => {
    const res = await latency.track(apiCall('GET', '/credits/me'));
    if (res.ok) setBalance(res.body as Balance);
  }, [latency.track]);

  useEffect(() => {
    if (auth.user) setTopupUser((current) => current || auth.user?.id || '');
    if (auth.tokens) void loadBalance();
  }, [auth.user, auth.tokens, loadBalance]);

  async function topup() {
    const res = await latency.track(apiCall('POST', '/credits/topup', { body: { userId: topupUser, amount: topupAmount } }));
    if (res.ok && topupUser === auth.user?.id) await loadBalance();
  }

  async function reserve20() {
    setParallel([]);
    setParallelMs(null);
    const t0 = performance.now();
    // Усі 20 стартують одночасно: Promise.all, без await у циклі.
    const results = await Promise.all(Array.from({ length: 20 }, () => apiCall('POST', '/credits/reserve', { body: { amount: 10 } })));
    setParallelMs(Math.round(performance.now() - t0));
    setParallel(results);
    const created = results.map((r) => r.body).filter(isReservation);
    setReservations((prev) => [...created, ...prev]);
    await loadBalance();
  }

  async function reserveOne() {
    const res = await latency.track(apiCall('POST', '/credits/reserve', { body: { amount: 10 } }));
    if (res.ok && isReservation(res.body)) setReservations((prev) => [res.body as Reservation, ...prev]);
    await loadBalance();
  }

  async function act(id: string, action: 'confirm' | 'release') {
    const res = await latency.track(apiCall('POST', `/credits/reservations/${id}/${action}`));
    if (res.ok && isReservation(res.body)) {
      const updated = res.body;
      setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, status: updated.status } : r)));
    }
    await loadBalance();
  }

  const count201 = parallel.filter((r) => r.status === 201).length;
  const count422 = parallel.filter((r) => r.status === 422).length;
  const countOther = parallel.length - count201 - count422;

  return (
    <>
      <PageTitle title="Кредити і локи" sub="SELECT ... FOR UPDATE: 20 паралельних списань без втрат" />
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> Резервація у транзакції бере рядок балансу з <code>SELECT ... FOR UPDATE</code>, перевіряє, списує і створює
          резервацію на 10 хв. Друга транзакція на тому самому рядку чекає COMMIT першої і бачить уже оновлений баланс.
        </p>
        <p>
          Обмеження <code>CHECK (balance &gt;= 0)</code> у БД: остання лінія оборони, якщо лок десь забули.
        </p>
        <pre>{`Без локу (гонка):                          З SELECT ... FOR UPDATE:
T1: SELECT balance -> 50                   T1: SELECT ... FOR UPDATE -> 50 (рядок заблоковано)
T2: SELECT balance -> 50                   T2: SELECT ... FOR UPDATE ...   (чекає)
T1: UPDATE balance = 40                    T1: UPDATE balance = 40; COMMIT
T2: UPDATE balance = 40  <- загублено      T2: ... -> 40, 40 >= 10 ok; UPDATE balance = 30`}</pre>
        <p>
          Лок живе до кінця транзакції, тому все між SELECT FOR UPDATE і COMMIT має бути коротким і без зовнішніх викликів. Порядок локів скрізь один (спочатку
          резервація, потім баланс), інакше deadlock.
        </p>
        <p>Крон щохвилини повертає кредити з протермінованих резервацій.</p>
        <WhereInCode paths={['src/modules/credits/credits.service.ts (lock: pessimistic_write)', 'credits.cron.ts', 'credit-balance.entity.ts (CHECK)']} />
      </Explain>

      <Card title="Баланс і поповнення">
        <div className="prose">
          <p>
            Баланс користувача і поповнення. GET /credits/me показує поточний баланс; topup може робити тільки admin, тому звичайний користувач отримає тут 403,
            і це правильна поведінка.
          </p>
        </div>
        <NeedAuth>Сід дає olena/taras/iryna по 100 кредитів; новий користувач без балансу отримає 404 на reserve, поки admin не зробить topup.</NeedAuth>
        <div className="row">
          <button type="button" onClick={() => void loadBalance()} disabled={!auth.tokens || latency.busy} data-testid="balance">
            GET /credits/me
          </button>
          {balance && (
            <span className="pill" data-testid="balance-value">
              balance <b className="mono">{balance.balance}</b>, reserved <b className="mono">{balance.reserved}</b>
            </span>
          )}
        </div>
        <div className="row">
          <label>
            userId (для topup)
            <input className="mono" style={{ width: 330 }} value={topupUser} onChange={(e) => setTopupUser(e.target.value)} />
          </label>
          <label>
            amount
            <input type="number" min={1} value={topupAmount} onChange={(e) => setTopupAmount(Number(e.target.value) || 1)} />
          </label>
          <button type="button" onClick={() => void topup()} disabled={!auth.tokens || latency.busy} data-testid="topup">
            POST /credits/topup (admin)
          </button>
          {auth.user && auth.user.role !== 'admin' && <span className="muted small">ти не admin: буде 403, це теж корисно побачити</span>}
        </div>
      </Card>

      <Card title="20 паралельних reserve(10)">
        <div className="prose">
          <p>
            Головна перевірка сторінки: гонка. Одночасно летять 20 резервацій по 10. Правильна відповідь: стільки 201, скільки десяток уміщається в баланс
            (10 при балансі 100), решта 422 INSUFFICIENT_CREDITS, і баланс після цього рівно 0. Якби локу не було, частина транзакцій прочитала б однаковий
            баланс: 201 було б більше, а баланс пішов би в мінус.
          </p>
          <p>Якщо баланс уже витрачений, спочатку topup від admin або почекай 10 хв: крон поверне кредити з протермінованих резервацій.</p>
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={() => void reserve20()} disabled={!auth.tokens || latency.busy} data-testid="reserve20">
            20 x POST /credits/reserve {'{ amount: 10 }'} одночасно
          </button>
          <button type="button" onClick={() => void reserveOne()} disabled={!auth.tokens || latency.busy}>
            1 x reserve(10)
          </button>
        </div>
        {parallel.length > 0 && (
          <>
            <div className="dots" data-testid="parallel-dots">
              {parallel.map((r, i) => (
                <span key={i} className={`dot s${Math.floor(r.status / 100)}`} title={`${r.status} за ${r.durationMs} мс`}>
                  {r.status}
                </span>
              ))}
            </div>
            <div className="cols-3">
              <div className="col">
                <h3>201 created</h3>
                <div className="big" data-testid="count-201">
                  {count201}
                </div>
              </div>
              <div className="col">
                <h3>422 INSUFFICIENT_CREDITS</h3>
                <div className="big" data-testid="count-422">
                  {count422}
                </div>
                {countOther > 0 && <div className="muted small">інші: {countOther}</div>}
              </div>
              <div className="col">
                <h3>Баланс після</h3>
                <div className="big" data-testid="final-balance">
                  {balance?.balance ?? '?'}
                </div>
                <div className="muted small">усі 20 за {parallelMs} мс</div>
              </div>
            </div>
            <div className="note ok">Сума списаного = 201 x 10 = {count201 * 10}. Жодне списання не загубилось і баланс не пішов у мінус: це і є лок.</div>
          </>
        )}
      </Card>

      {reservations.length > 0 && (
        <Card title="Резервації">
          <table className="tbl" data-testid="reservations">
            <thead>
              <tr>
                <th>id</th>
                <th>amount</th>
                <th>status</th>
                <th>expiresAt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reservations.slice(0, 12).map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id.slice(0, 8)}</td>
                  <td className="mono">{r.amount}</td>
                  <td>{r.status}</td>
                  <td className="mono">{r.expiresAt?.slice(11, 19)}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => void act(r.id, 'confirm')}
                      disabled={r.status !== 'reserved' || latency.busy}
                      style={{ marginRight: 6 }}
                    >
                      confirm
                    </button>
                    <button type="button" onClick={() => void act(r.id, 'release')} disabled={r.status !== 'reserved' || latency.busy}>
                      release
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Останній запит">
        <Panel exchange={latency.exchange} busy={latency.busy} />
      </Card>
    </>
  );
}
