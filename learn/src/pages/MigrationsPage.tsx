// Міграції, час, soft delete: статика за docs/modules/migrations.md і time.md плюс живий цикл
// POST /posts -> DELETE -> GET (404) -> POST /restore -> GET (200).
import { useState } from 'react';
import { apiCall, ApiExchange } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, StatusBadge } from '../components/Panel';
import { Card, Explain, NeedAuth, PageTitle } from '../components/common';

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

const CODE_PLACES: Array<[string, string]> = [
  ['src/migrations/*.ts, src/migrations/index.ts', 'самі міграції і їх список'],
  ['src/modules/database/data-source-options.ts', "synchronize: false, options: '-c TimeZone=UTC'"],
  ['src/migrations/1700000000001-InitSchema.ts', 'timestamptz скрізь, deleted_at у posts'],
  ['src/modules/posts/post.entity.ts', '@DeleteDateColumn deleted_at: find() сам додає WHERE deleted_at IS NULL'],
  ['src/modules/posts/posts.service.ts', 'softDelete() і restore(); restore на не видаленому дає 409 NOT_DELETED'],
  ['test/int/migrations.int-spec.ts', 'revert прибирає індекс, run повертає; усі *_at мають тип timestamp with time zone'],
];

export function MigrationsPage() {
  const auth = useAuth();
  const latency = useLatency();
  const [steps, setSteps] = useState<Step[]>([]);
  const [postId, setPostId] = useState<string | null>(null);

  function push(label: string, expect: string, exchange: ApiExchange) {
    setSteps((prev) => [...prev, { label, expect, exchange }]);
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

  async function runCycle() {
    setSteps([]);
    const id = await createPost();
    if (!id) return;
    const del = push('DELETE /posts/:id', '204, у рядку deleted_at = now()', await latency.track(apiCall('DELETE', `/posts/${id}`)));
    if (!del.ok) return;
    push('GET /posts/:id', '404: find() не бачить рядків з deleted_at', await latency.track(apiCall('GET', `/posts/${id}`, { auth: false })));
    const restore = push('POST /posts/:id/restore', '201, deleted_at = NULL', await latency.track(apiCall('POST', `/posts/${id}/restore`)));
    if (!restore.ok) return;
    push('GET /posts/:id', '200, пост знову є', await latency.track(apiCall('GET', `/posts/${id}`, { auth: false })));
  }

  async function restoreAgain() {
    if (!postId) return;
    push('POST /posts/:id/restore ще раз', '409 NOT_DELETED: пост не видалений', await latency.track(apiCall('POST', `/posts/${postId}/restore`)));
  }

  return (
    <>
      <PageTitle title="Міграції, час, soft delete" sub="Схема тільки через міграції, усі дати в UTC, видалення як deleted_at замість DELETE" />
      <Explain>
        <p>
          <b>Міграції.</b> <code>synchronize: true</code> порівнює сутності з базою і сам застосовує різницю: перейменував поле <code>title</code> на{' '}
          <code>heading</code>, TypeORM зробить <code>DROP COLUMN title, ADD COLUMN heading</code>, дані зникли. Тому схема змінюється тільки файлами у{' '}
          <code>src/migrations/</code>: їх читають на review, проганяють на staging, відкочують, якщо щось пішло не так. <code>CREATE INDEX</code> на великій
          таблиці блокує записи; у production роблять <code>CREATE INDEX CONCURRENTLY</code> поза транзакцією.
        </p>
        <p>
          <b>Час.</b> Усі колонки дат мають тип <code>timestamptz</code>, сесія Postgres працює з <code>TimeZone=UTC</code>, у JSON дати йдуть ISO-рядком з{' '}
          <code>Z</code>. <code>timestamp</code> без зони зберігає "настінний годинник" (<code>2026-03-29 02:30</code>) без інформації, де це було;{' '}
          <code>timestamptz</code> зберігає момент часу. api-1 у Києві, api-2 у Франкфурті і воркер де завгодно бачать однакові рядки, а в локальний час
          переводить фронтенд, бо тільки він знає зону користувача.
        </p>
        <p>
          <b>Soft delete.</b> <code>DELETE /posts/:id</code> не видаляє рядок, а ставить <code>deleted_at = now()</code>. <code>@DeleteDateColumn</code> у
          TypeORM сам додає <code>WHERE deleted_at IS NULL</code> до кожного <code>find()</code>, тому пост зникає зі списку і з <code>GET</code>, але лишається
          у звітах і його можна повернути через <code>POST /posts/:id/restore</code>. Побачити видалені: <code>withDeleted()</code> або сирий SQL.
        </p>
      </Explain>

      <Card title="Спробувати: видалити і відновити пост">
        <NeedAuth>POST, DELETE і restore потребують токена автора.</NeedAuth>
        <div className="row">
          <button type="button" className="primary" data-testid="soft-delete-cycle" disabled={latency.busy || !auth.tokens} onClick={() => void runCycle()}>
            Створити, DELETE, GET, restore, GET
          </button>
          <button type="button" data-testid="restore-again" disabled={latency.busy || !auth.tokens || !postId} onClick={() => void restoreAgain()}>
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
      </Card>

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
          <div className="muted small" style={{ marginTop: 8 }}>
            Спробуй: <code>npm run migration:revert</code>, потім <code>GET /demo/explain?indexed=true</code> на сторінці SQL дасть Seq Scan, бо індексу вже
            немає. <code>npm run migration:run</code> повертає.
          </div>
        </Card>
      </div>

      <Card title="Де в коді">
        <table className="tbl">
          <tbody>
            {CODE_PLACES.map(([file, what]) => (
              <tr key={file}>
                <td className="mono">{file}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
