// Міграції, час, soft delete: статика за docs/modules/migrations.md і time.md плюс живий цикл
// POST /posts -> DELETE -> GET (404) -> POST /restore -> GET (200).
import { useState } from 'react';
import { apiCall, ApiExchange } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, StatusBadge } from '../components/Panel';
import { Card, NeedAuth, PageTitle } from '../components/common';
import { Concept, PanelNotes } from '../components/topic';

interface Step {
  label: string;
  expect: string;
  exchange: ApiExchange;
}

const MIGRATIONS: Array<[string, string]> = [
  ['1700000000001-InitSchema', 'усі таблиці, індекси, CHECK'],
  ['1700000000002-AddPostEmbedding', 'CREATE EXTENSION vector і колонка posts.embedding vector(384); без розширення поза production пропускається'],
  ['1700000000003-AddEventsUserCreatedIndex', 'складений індекс events(user_id, created_at); окрема, щоб відкотити на 200 000 рядків і порівняти плани'],
];

const COMMANDS: Array<[string, string]> = [
  ['npm run migration:show', 'що накочено, що ні'],
  ['npm run migration:run', 'накотити все нове'],
  ['npm run migration:revert', 'відкотити ОДНУ останню'],
  ['npm run migration:generate src/migrations/NazvaZminy', 'згенерувати з різниці entity проти БД; читати очима перед коммітом'],
];

interface TimeSample {
  iso: string;
  title: string;
}

export function MigrationsPage() {
  const auth = useAuth();
  const latency = useLatency();
  const timeLatency = useLatency();
  const [steps, setSteps] = useState<Step[]>([]);
  const [postId, setPostId] = useState<string | null>(null);
  const [sample, setSample] = useState<TimeSample | null>(null);

  function push(label: string, expect: string, exchange: ApiExchange) {
    // Повторний клік по тому самому кроку (наприклад, "restore ще раз") оновлює рядок, а не додає новий.
    setSteps((prev) => {
      const index = prev.findIndex((step) => step.label === label);
      if (index === -1) return [...prev, { label, expect, exchange }];
      const next = prev.slice();
      next[index] = { label, expect, exchange };
      return next;
    });
    return exchange;
  }

  async function createPost(): Promise<string | null> {
    const res = push(
      'POST /posts',
      '201, пост створено',
      await latency.track(
        apiCall('POST', '/posts', {
          body: { title: `Soft delete demo ${new Date().toLocaleTimeString('uk-UA')}`, body: "Цей пост буде м'яко видалений і відновлений.", tags: ['demo'] },
        }),
      ),
    );
    if (!res.ok) return null;
    const id = (res.body as { id: string }).id;
    setPostId(id);
    return id;
  }

  // Повертає id поста, з яким працювали, або null, якщо якийсь крок не вдався.
  async function runCycle(): Promise<string | null> {
    setSteps([]);
    const id = await createPost();
    if (!id) return null;
    const del = push('DELETE /posts/:id', '204, у рядку deleted_at = now()', await latency.track(apiCall('DELETE', `/posts/${id}`)));
    if (!del.ok) return null;
    push('GET /posts/:id після DELETE', '404: find() не бачить рядків з deleted_at', await latency.track(apiCall('GET', `/posts/${id}`, { auth: false })));
    const restore = push('POST /posts/:id/restore', '201, deleted_at = NULL', await latency.track(apiCall('POST', `/posts/${id}/restore`)));
    if (!restore.ok) return null;
    push('GET /posts/:id після restore', '200, пост знову є', await latency.track(apiCall('GET', `/posts/${id}`, { auth: false })));
    return id;
  }

  // Якщо цикл ще не запускали, кнопка запускає його сама, а потім повторює restore.
  async function restoreAgain() {
    const id = postId ?? (await runCycle());
    if (!id) return;
    push('POST /posts/:id/restore ще раз', '409 NOT_DELETED: пост не видалений', await latency.track(apiCall('POST', `/posts/${id}/restore`)));
  }

  async function loadTime() {
    const res = await timeLatency.track(apiCall('GET', '/posts', { query: { pageSize: 1 }, auth: false }));
    if (!res.ok) return;
    const item = (res.body as { items: Array<{ title: string; createdAt: string }> }).items[0];
    if (item) setSample({ iso: item.createdAt, title: item.title });
  }

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sampleDate = sample ? new Date(sample.iso) : null;

  return (
    <>
      <PageTitle title="Міграції, час, soft delete" sub="Схема тільки через міграції, усі дати в UTC, видалення як deleted_at замість DELETE" />

      <Concept
        what={
          <>
            <p>
              Міграція це файл, який описує одну зміну схеми бази: «додай колонку», «створи індекс». У ньому дві функції: up робить зміну, down її скасовує. Файли
              йдуть за номером, а Postgres тримає таблицю migrations зі списком уже накочених, тому migration:run виконує тільки нові.
            </p>
            <p>
              Автосинхронізація (synchronize) схеми вимкнена. Вона порівнює сутності з базою і сама застосовує різницю: перейменував поле title на heading, і TypeORM
              зробить DROP COLUMN title, ADD COLUMN heading. Дані зникли без жодного попередження. Міграцію ж читають на review, проганяють на staging, і вона
              однакова на кожному середовищі.
            </p>
            <p>
              Down потрібен, щоб відкотити невдалий деплой однією командою. Він не завжди можливий: стерту колонку з даними не повернути. Тоді down порожній або
              кидає помилку, а виправляють новою міграцією вперед.
            </p>
          </>
        }
        when={
          <>
            <p>
              Міграції потрібні, щойно є база з даними, яку не можна знести: прод або навіть другий розробник у команді. Не потрібні для прототипу чи скрипта, де
              базу дешевше створити заново.
            </p>
            <p>
              Дві звички. Міграцію, що вже поїхала на staging чи прод, не редагують: помилку виправляє наступна. А індекс на великій таблиці блокує записи, тому в
              production його створюють з CONCURRENTLY поза транзакцією.
            </p>
          </>
        }
        how={
          <p>
            Три файли в src/migrations, список нижче. У налаштуваннях synchronize: false і migrationsRun: false, тобто застосунок сам нічого не накочує: це окрема
            команда на деплої. Ті самі налаштування бере CLI міграцій, тому застосунок і міграції не розходяться.
          </p>
        }
      />

      <div className="card-grid">
        <Card title="Три міграції">
          <ul className="checklist">
            {MIGRATIONS.map(([name, what]) => (
              <li key={name}>
                <span>
                  <span className="mono">{name}</span>
                  <br />
                  <span className="muted small">{what}</span>
                </span>
              </li>
            ))}
          </ul>
          <PanelNotes
            where={['src/migrations/index.ts (список у порядку виконання)', 'src/migrations/1700000000003-AddEventsUserCreatedIndex.ts (up і down)']}
            tryItems={[
              <>Відкрий 0003 і знайди up та down: вони дзеркальні, один створює індекс, інший прибирає.</>,
              <>Додай поле slug у post.entity.ts, виконай migration:generate і прочитай згенерований SQL до того, як його накочувати.</>,
            ]}
          />
        </Card>
        <Card title="Що запускати">
          <table className="tbl">
            <tbody>
              {COMMANDS.map(([cmd, what]) => (
                <tr key={cmd}>
                  <td className="mono">{cmd}</td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <PanelNotes
            where={['src/data-source.ts (DataSource для CLI)', 'package.json (скрипти migration:*)']}
            tryItems={[
              <>
                <code>npm run migration:revert</code>, потім <code>GET /demo/explain?indexed=true</code> на сторінці SQL дасть Seq Scan, бо індексу вже немає.
              </>,
              <>
                <code>npm run migration:run</code> повертає індекс.
              </>,
            ]}
          />
        </Card>
      </div>

      <Concept
        what={
          <p>
            Момент часу (коли створено пост) треба зберігати так, щоб він означав одне й те саме в Києві, у Франкфурті і на сервері. Для цього колонки мають тип
            timestamptz, сесія Postgres працює в UTC, а в JSON дата йде ISO-рядком із Z на кінці: 2026-10-29T18:46:50.496Z.
          </p>
        }
        when={
          <p>
            Для моментів «коли це сталося» (створено, оплачено, прочитано) завжди timestamptz. Тип без зони підходить тільки для «настінного годинника», не
            прив'язаного до місця: «магазин відчиняється о 09:00». Інакше запис 2026-03-29 02:30 нічого не каже: у якому місті і в якому поясі? А цієї години в
            Європі переходять на літній час, і такого моменту може взагалі не існувати.
          </p>
        }
        how={
          <p>
            У міграціях усі колонки *_at мають timestamptz, а до пулу з'єднань додано TimeZone=UTC. api-1 у Києві, api-2 у Франкфурті і воркер де завгодно бачать
            однакові рядки. У локальний час переводить фронтенд, бо тільки він знає зону користувача. Інтеграційний тест перевіряє, що тип усіх *_at саме такий.
          </p>
        }
      />

      <Card title="Час: що віддає сервер і що бачиш ти" testId="card-time">
        <div className="prose">
          <p>Кнопка бере останній пост і показує його createdAt так, як він прийшов, і так, як його покаже браузер у твоєму поясі.</p>
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={() => void loadTime()} disabled={timeLatency.busy} data-testid="time-load">
            GET /posts?pageSize=1
          </button>
        </div>
        {sample && sampleDate && (
          <table className="tbl" data-testid="time-sample">
            <tbody>
              <tr>
                <td>сервер віддав (UTC, Z)</td>
                <td className="mono">{sample.iso}</td>
              </tr>
              <tr>
                <td>твій пояс</td>
                <td className="mono">{zone}</td>
              </tr>
              <tr>
                <td>браузер показує</td>
                <td className="mono">{sampleDate.toLocaleString('uk-UA', { timeZoneName: 'short' })}</td>
              </tr>
            </tbody>
          </table>
        )}
        <Panel exchange={timeLatency.exchange} busy={timeLatency.busy} />
        <PanelNotes
          where={['src/migrations/1700000000001-InitSchema.ts (timestamptz скрізь)', 'src/modules/database/data-source-options.ts (TimeZone=UTC)']}
          tryItems={[
            <>У DevTools відкрий Sensors, обери інший часовий пояс, перезавантаж сторінку і натисни кнопку: рядок з сервера той самий, змінився лише локальний.</>,
            <>
              У psql виконай <code>SHOW timezone</code> у сесії застосунку і в окремій: застосунок бачить UTC завдяки налаштуванню пулу.
            </>,
          ]}
        />
      </Card>

      <Concept
        what={
          <p>
            Soft delete: DELETE не стирає рядок, а ставить deleted_at = now(). Для звичайних запитів пост зник зі списку і з GET, але в таблиці він є, і його можна
            повернути.
          </p>
        }
        when={
          <>
            <p>
              Підходить, коли видалене треба вміти повернути (кошик, випадковий клік) або воно потрібне у звітах і аудиті, або на рядок посилаються інші таблиці.
            </p>
            <p>
              Не підходить для персональних даних, які користувач просить стерти: рядок мусить зникнути по-справжньому. Не потрібен для логів, сесій, токенів і
              кешів: вони лише роздувають таблицю. І є пастка з унікальними полями: видалений рядок досі займає унікальний email, тому новий користувач з тим самим
              email впаде. Крім того, кожен запит мусить пам'ятати про фільтр, а в сирому SQL ніхто за тебе цього не зробить.
            </p>
          </>
        }
        how={
          <p>
            У сутності Post колонка з @DeleteDateColumn. Звичайні find() і QueryBuilder самі додають WHERE deleted_at IS NULL. Побачити видалені можна через
            withDeleted() або сирим SQL. restore() скидає deleted_at, а на не видаленому посту відповідає 409 NOT_DELETED. Сирі запити (звіти, кеш статистики)
            пишуть умову deleted_at IS NULL руками.
          </p>
        }
      />

      <Card title="Видалити і відновити пост">
        <div className="prose">
          <p>
            Кнопка сама створює пост і проганяє п'ять кроків: видалити, прочитати (очікуємо 404), відновити, прочитати знову (очікуємо 200 з тим самим id).
            Другий restore поспіль має дати 409: пост уже не видалений.
          </p>
        </div>
        <NeedAuth>POST, DELETE і restore потребують токена автора.</NeedAuth>
        <div className="row">
          <button type="button" className="primary" data-testid="soft-delete-cycle" disabled={latency.busy || !auth.tokens} onClick={() => void runCycle()}>
            Створити, DELETE, GET, restore, GET
          </button>
          <button type="button" data-testid="restore-again" disabled={latency.busy || !auth.tokens} onClick={() => void restoreAgain()}>
            restore ще раз (409)
          </button>
          <button type="button" onClick={() => setSteps([])} disabled={steps.length === 0}>
            Очистити
          </button>
        </div>
        {steps.length > 0 && (
          <div className="steps" data-testid="soft-delete-steps">
            {steps.map((s, i) => (
              <div className="step" key={i}>
                <span className="step-num">{i + 1}</span>
                <span>
                  <span className="mono">{s.label}</span> <span className="muted small">{s.expect}</span>
                </span>
                <span>
                  <StatusBadge status={s.exchange.status} /> <span className="muted small mono">{s.exchange.durationMs} мс</span>
                </span>
              </div>
            ))}
          </div>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelNotes
          where={['src/modules/posts/post.entity.ts (@DeleteDateColumn deleted_at)', 'src/modules/posts/posts.service.ts (softDelete, restore)']}
          tryItems={[
            <>
              Після циклу виконай у psql <code>select title, deleted_at from posts where title like 'Soft delete demo%'</code>: рядки на місці, deleted_at знову NULL.
            </>,
            <>Натисни «restore ще раз» одразу на свіжій сторінці: кнопка сама проганяє цикл, а потім дає 409.</>,
          ]}
        />
      </Card>
    </>
  );
}
