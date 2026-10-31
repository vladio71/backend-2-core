// Кредити: гонка на балансі (з локом і без) та резервація hold/capture. Кожна панель сама готує собі стан через POST /credits/demo/reset.
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, StatusBadge } from '../components/Panel';
import { PanelFooter, Topic } from '../components/TopicParts';
import { Card, NeedAuth, PageTitle } from '../components/common';

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

interface RaceResult {
  unsafe: boolean;
  statuses: number[];
  before: number;
  after: number;
  ms: number;
}

interface Step {
  label: string;
  request: string;
  status: number;
  note: string;
  balance: number | null;
  reserved: number | null;
}

const RACE_SQL = `-- (a) атомарний UPDATE: одна команда, лок бере сам Postgres
UPDATE credit_balances SET balance = balance - 10 WHERE user_id = $1 AND balance >= 10;
-- 0 змінених рядків = не вистачило, віддаємо 422

-- (b) SELECT ... FOR UPDATE: рядок наш до COMMIT, між читанням і записом можна робити що завгодно
BEGIN;
SELECT balance FROM credit_balances WHERE user_id = $1 FOR UPDATE;
-- ...перевірки, INSERT резервації...
UPDATE credit_balances SET balance = $2 WHERE user_id = $1;
COMMIT;

-- (c) оптимістична версія: нічого не блокуємо, але перевіряємо, що рядок не змінився
UPDATE credit_balances SET balance = $2, version = version + 1 WHERE user_id = $1 AND version = $3;
-- 0 змінених рядків = хтось устиг раніше, перечитай і повтори`;

const RACE_DIAGRAM = `Без локу (так зроблено unsafe):             З SELECT ... FOR UPDATE:
T1: SELECT balance -> 100                  T1: SELECT ... FOR UPDATE -> 100 (рядок заблоковано)
T2: SELECT balance -> 100                  T2: SELECT ... FOR UPDATE ...   (чекає)
T1: UPDATE balance = 90                    T1: UPDATE balance = 90; COMMIT
T2: UPDATE balance = 90  <- списання T1    T2: -> 90, 90 >= 10 ok; UPDATE balance = 80
                            загублено`;

export function CreditsPage() {
  const auth = useAuth();
  const latency = useLatency();
  const [busy, setBusy] = useState(false);
  const [safe, setSafe] = useState<RaceResult | null>(null);
  const [unsafe, setUnsafe] = useState<RaceResult | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [held, setHeld] = useState<{ reservation: Reservation; balance: Balance } | null>(null);

  async function reset(): Promise<number> {
    const res = await latency.track(apiCall('POST', '/credits/demo/reset'));
    return res.ok ? (res.body as Balance).balance : 0;
  }

  async function race(isUnsafe: boolean) {
    setBusy(true);
    try {
      const before = await reset();
      const t0 = performance.now();
      // Усі 20 стартують одночасно: Promise.all, без await у циклі.
      const results = await Promise.all(
        Array.from({ length: 20 }, () => apiCall('POST', '/credits/reserve', { query: isUnsafe ? { unsafe: 'true' } : undefined, body: { amount: 10 } })),
      );
      const ms = Math.round(performance.now() - t0);
      const me = await latency.track(apiCall('GET', '/credits/me'));
      const result: RaceResult = { unsafe: isUnsafe, statuses: results.map((r) => r.status), before, after: me.ok ? (me.body as Balance).balance : -1, ms };
      if (isUnsafe) setUnsafe(result);
      else setSafe(result);
    } finally {
      setBusy(false);
    }
  }

  async function me(): Promise<Balance | null> {
    const res = await latency.track(apiCall('GET', '/credits/me'));
    return res.ok ? (res.body as Balance) : null;
  }

  // Кроки: reset, reserve(10), потім confirm або release, потім повторна дія (очікуємо 409).
  async function hold(action: 'confirm' | 'release' | 'wait') {
    setBusy(true);
    setSteps([]);
    setHeld(null);
    const list: Step[] = [];
    const push = (step: Step) => {
      list.push(step);
      setSteps([...list]);
    };
    try {
      const resetRes = await latency.track(apiCall('POST', '/credits/demo/reset'));
      const start = resetRes.body as Balance;
      push({ label: 'Старт', request: 'POST /credits/demo/reset', status: resetRes.status, note: 'баланс 100, активних резервацій немає', balance: start.balance, reserved: start.reserved });
      const reserveRes = await latency.track(apiCall('POST', '/credits/reserve', { body: { amount: 10 } }));
      if (!reserveRes.ok || !isReservation(reserveRes.body)) return;
      const reservation = reserveRes.body;
      const afterReserve = await me();
      push({
        label: 'Утримання',
        request: 'POST /credits/reserve { amount: 10 }',
        status: reserveRes.status,
        note: `резервація ${reservation.id.slice(0, 8)} у статусі ${reservation.status}`,
        balance: afterReserve?.balance ?? null,
        reserved: afterReserve?.reserved ?? null,
      });
      if (action === 'wait') {
        if (afterReserve) setHeld({ reservation, balance: afterReserve });
        return;
      }
      const first = await latency.track(apiCall('POST', `/credits/reservations/${reservation.id}/${action}`));
      const afterFirst = await me();
      push({
        label: action === 'confirm' ? 'Capture' : 'Повернення',
        request: `POST /credits/reservations/:id/${action}`,
        status: first.status,
        note: action === 'confirm' ? 'утримання стало списанням, кредити не повертаються' : 'утримання знято, 10 кредитів знову на балансі',
        balance: afterFirst?.balance ?? null,
        reserved: afterFirst?.reserved ?? null,
      });
      const other = action === 'confirm' ? 'release' : 'confirm';
      const second = await latency.track(apiCall('POST', `/credits/reservations/${reservation.id}/${other}`));
      const afterSecond = await me();
      push({
        label: 'Повторна дія',
        request: `POST /credits/reservations/:id/${other}`,
        status: second.status,
        note: 'з не-reserved статусу виходу немає: 409 RESERVATION_NOT_ACTIVE',
        balance: afterSecond?.balance ?? null,
        reserved: afterSecond?.reserved ?? null,
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshHeld() {
    const balance = await me();
    if (balance && held) setHeld({ ...held, balance });
  }

  const disabled = !auth.tokens || busy;

  return (
    <>
      <PageTitle title="Кредити: гонка і резервація" sub="Один рядок з грошима, 20 одночасних списань, три способи зробити правильно" />

      <Topic
        what={
          <>
            Баланс це один рядок у таблиці. Двоє клієнтів одночасно читають 100, обоє вирішують «вистачає», обоє пишуть 90. Одне списання зникло, гроші
            з'явились нізвідки. Це lost update. Він проходить без жодної помилки, тому його важко помітити.
          </>
        }
        when={
          <>
            Потрібно скрізь, де рішення залежить від прочитаного значення: «спиши, якщо вистачає». Не потрібно для читання і для INSERT нового рядка.
            Ідемпотентність (ключ запиту) тут не допомагає: вона про повтор того самого запиту, а в нас 20 різних. Це дві окремі проблеми, і зазвичай
            потрібні обидві.
          </>
        }
        how={
          <>
            Є три способи зробити це правильно, вони нижче. Для чистого списання (a) краще за (b): менше коду, менше часу під локом, нічого не забути. У цьому проєкті
            про вибір (b) у цьому проєкті сказано нижче.
          </>
        }
        extra={
          <>
            <ul>
              <li>
                <b>(a) Атомарний UPDATE</b> з умовою в WHERE і перевіркою кількості змінених рядків. Найдешевший, лок живе одну команду. Достатній, коли це один
                рядок і одна умова.
              </li>
              <li>
                <b>(b) SELECT ... FOR UPDATE</b> у транзакції. Потрібен, коли між читанням і записом є ще кроки: перевірки по кількох таблицях, розрахунок у коді,
                кілька рядків для зміни.
              </li>
              <li>
                <b>(c) Оптимістична версія</b> з колонкою version. Потрібна, коли конфлікти рідкісні, а «транзакція» триває хвилини: користувач редагує форму.
              </li>
            </ul>
            <pre>{RACE_SQL}</pre>
            <p>
              Чесно про цей проєкт: reserve зроблено через (b), бо в тій самій транзакції ще вставляється рядок резервації, і лок дає простий порядок дій. Для самого
              списання вистачило б (a), а (b) тут ще й як наочний приклад. CHECK (balance &gt;= 0) у БД лишається останньою лінією оборони. Але CHECK ловить тільки мінус. Втрачене списання лишає баланс додатним, тому
              нижче він мовчить.
            </p>
            <pre>{RACE_DIAGRAM}</pre>
          </>
        }
      />

      <Card title="Гонка: 20 паралельних reserve(10) на балансі 100">
        <div className="prose">
          <p>
            Кожна кнопка спочатку скидає твій баланс до 100 і закриває твої активні резервації, потім шле 20 запитів одночасно. Кнопку можна тиснути скільки
            завгодно разів. Правильно: рівно 10 відповідей 201, 10 відповідей 422, баланс 0. Погано: більше 10 відповідей 201 і баланс, який впав менше, ніж
            ми обіцяли.
          </p>
        </div>
        <NeedAuth />
        <div className="row">
          <button type="button" className="primary" onClick={() => void race(false)} disabled={disabled} data-testid="reserve20">
            20 паралельних reserve з локом
          </button>
          <button type="button" className="danger" onClick={() => void race(true)} disabled={disabled} data-testid="reserve20-unsafe">
            20 паралельних reserve без лока
          </button>
        </div>
        <div className="cols-3" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <RaceColumn title="З локом (FOR UPDATE)" result={safe} prefix="" />
          <RaceColumn title="Без лока (?unsafe=true)" result={unsafe} prefix="unsafe-" />
        </div>
        <PanelFooter
          paths={[
            'src/modules/credits/credits.service.ts (reserve: FOR UPDATE; reserveUnsafe: наївна версія для демо)',
            'src/modules/credits/credits.controller.ts (?unsafe=true і demo/reset)',
            'src/migrations/1700000000001-InitSchema.ts (CHECK)',
          ]}
          tries={[
            <>
              Перепиши reserve() на (a): UPDATE ... SET balance = balance - $2 WHERE user_id = $1 AND balance &gt;= $2 і перевірка кількості змінених рядків. Кнопка з
              локом має дати ті самі 10 / 10 / 0.
            </>,
            <>
              Прибери lock у reserve() і запусти test/e2e/credits.e2e-spec.ts кілька разів поспіль: чи падає тест щоразу?
            </>,
          ]}
        />
      </Card>

      <Topic
        what={
          <>
            Резервація це утримання, як холд на картці в готелі. Кредити зникають з доступного балансу одразу, але остаточно не списані. Далі або confirm
            (робота зроблена, утримання стає списанням), або release (не вийшло, кредити повертаються).
          </>
        }
        when={
          <>
            Потрібно, коли між «хочу» і «зробив» є довга або ненадійна операція: запит до LLM, платіж, генерація звіту. Не потрібно, коли операція миттєва і
            йде в тій самій транзакції: тоді просто спиши.
          </>
        }
        how={
          <>
            Статуси: reserved, потім confirmed, released або expired. Вихід є тільки з reserved, будь-яка інша дія дає 409. Клієнт міг зникнути, тому крон
            щохвилини повертає кредити з резервацій, яким уже минуло 10 хв (RESERVATION_TTL_MS). confirm і release беруть лок на резервацію, тому подвійний
            клік безпечний. Порядок локів скрізь однаковий: спочатку резервація, потім баланс. Інакше два запити можуть вічно чекати один одного.
          </>
        }
      />

      <Card title="Hold і capture: одна резервація від початку до кінця">
        <div className="prose">
          <p>
            Кожна кнопка скидає стан, резервує 10 кредитів і проводить резервацію до кінця. Дивись на колонки balance і reserved: після резервації 90 і 10,
            після confirm 90 і 0 (гроші списані), після release 100 і 0 (гроші повернулись). Остання стрічка щоразу 409: з фінального статусу назад дороги немає.
          </p>
        </div>
        <NeedAuth />
        <div className="row">
          <button type="button" className="primary" onClick={() => void hold('confirm')} disabled={disabled} data-testid="hold-confirm">
            reset, reserve(10), confirm
          </button>
          <button type="button" onClick={() => void hold('release')} disabled={disabled} data-testid="hold-release">
            reset, reserve(10), release
          </button>
          <button type="button" onClick={() => void hold('wait')} disabled={disabled} data-testid="hold-wait">
            reset, reserve(10) і не чіпати
          </button>
        </div>
        {steps.length > 0 && (
          <table className="tbl" data-testid="hold-steps">
            <thead>
              <tr>
                <th>Крок</th>
                <th>Запит</th>
                <th>Статус</th>
                <th>balance</th>
                <th>reserved</th>
                <th>Що сталось</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.label}>
                  <td>{s.label}</td>
                  <td className="mono small">{s.request}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="mono">{s.balance ?? '-'}</td>
                  <td className="mono">{s.reserved ?? '-'}</td>
                  <td className="small">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {held && (
          <div className="note" data-testid="hold-held">
            Резервація {held.reservation.id.slice(0, 8)} висить до {new Date(held.reservation.expiresAt).toLocaleTimeString('uk-UA')}. Зараз balance{' '}
            <b className="mono">{held.balance.balance}</b>, reserved <b className="mono">{held.balance.reserved}</b>. Коли час мине і крон спрацює, reserved стане 0, а balance
            100.{' '}
            <button type="button" onClick={() => void refreshHeld()} disabled={busy}>
              GET /credits/me
            </button>
          </div>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelFooter
          paths={[
            'src/modules/credits/credits.service.ts (confirm, release, expireStale, порядок локів у returnToBalance)',
            'src/modules/credits/credits.cron.ts (щохвилини)',
            'src/modules/credits/credit-reservation.entity.ts (статуси)',
          ]}
          tries={[
            <>
              Зміни RESERVATION_TTL_MS на 20 секунд і перезапусти API. Натисни «reserve(10) і не чіпати», за хвилину натисни GET /credits/me: крон поверне
              кредити, у логах API буде «Протерміновано резервацій: 1».
            </>,
            <>
              Поміняй порядок локів у returnToBalance (спочатку баланс, потім резервація) і запусти release та expireStale паралельно: шукай deadlock у логах Postgres.
            </>,
          ]}
        />
      </Card>
    </>
  );
}

function RaceColumn({ title, result, prefix }: { title: string; result: RaceResult | null; prefix: string }) {
  if (!result) {
    return (
      <div className="col">
        <h3>{title}</h3>
        <div className="muted small">ще не запускали</div>
      </div>
    );
  }
  const count = (status: number) => result.statuses.filter((s) => s === status).length;
  const c201 = count(201);
  const c422 = count(422);
  const c500 = count(500);
  const other = result.statuses.length - c201 - c422 - c500;
  const expectedDrop = c201 * 10;
  const actualDrop = result.before - result.after;
  const correct = actualDrop === expectedDrop && c201 <= 10;
  return (
    <div className="col" data-testid={`${prefix}race`}>
      <h3>{title}</h3>
      <div className="dots">
        {result.statuses.map((s, i) => (
          <span key={i} className={`dot s${Math.floor(s / 100)}`}>
            {s}
          </span>
        ))}
      </div>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="pill">
          201 <b className="mono" data-testid={`${prefix}count-201`}>{c201}</b>
        </span>
        <span className="pill">
          422 <b className="mono" data-testid={`${prefix}count-422`}>{c422}</b>
        </span>
        <span className="pill">
          500 <b className="mono" data-testid={`${prefix}count-500`}>{c500}</b>
        </span>
        {other > 0 && <span className="pill">інші {other}</span>}
      </div>
      <div className="small">
        Баланс було {result.before}, став <b className="big" data-testid={`${prefix}final-balance`}>{result.after}</b>
      </div>
      <div className="small">
        Обіцяно списати: {c201} x 10 = <b className="mono">{expectedDrop}</b>. Справді списано: <b className="mono">{actualDrop}</b>. Усі 20 за {result.ms} мс.
      </div>
      {correct ? (
        <div className="note ok">Збігається: жодне списання не загубилось, баланс не пішов у мінус.</div>
      ) : (
        <div className="note err">
          Не збігається: {c201} успішних резервацій, а баланс упав лише на {actualDrop}. Різниця {expectedDrop - actualDrop} кредитів з'явилась нізвідки, а CHECK
          мовчить, бо баланс лишився додатним.
        </div>
      )}
    </div>
  );
}
