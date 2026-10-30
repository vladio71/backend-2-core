// SQL і індекси: три картки з власними панелями: звіт posts-per-day (SVG), N+1 (лічильник запитів), EXPLAIN (Seq Scan проти Index Scan).
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { BarChart, Card, Explain, PageTitle } from '../components/common';

interface PerDayRow {
  day: string;
  authorName: string;
  posts: number;
  likes: number;
  runningTotal: number;
}

interface NPlusOneResponse {
  fixed: boolean;
  postsReturned: number;
  queryCount: number;
  queries: string[];
}

interface ExplainResponse {
  indexed: boolean;
  rowsMatched: number;
  nodeType: string;
  indexName: string | null;
  planningTimeMs: number;
  executionTimeMs: number;
}

export function SqlPage() {
  const report = useLatency();
  const nplus = useLatency();
  const explain = useLatency();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<PerDayRow[]>([]);
  const [slow, setSlow] = useState<NPlusOneResponse | null>(null);
  const [fast, setFast] = useState<NPlusOneResponse | null>(null);
  const [seq, setSeq] = useState<ExplainResponse | null>(null);
  const [idx, setIdx] = useState<ExplainResponse | null>(null);

  async function loadReport() {
    const res = await report.track(apiCall('GET', '/reports/posts-per-day', { query: { days }, auth: false }));
    if (res.ok) setRows(res.body as PerDayRow[]);
  }

  async function runNPlusOne(fixed: boolean) {
    const res = await nplus.track(apiCall('GET', '/demo/n-plus-one', { query: { fixed }, auth: false }));
    if (!res.ok) return;
    if (fixed) setFast(res.body as NPlusOneResponse);
    else setSlow(res.body as NPlusOneResponse);
  }

  async function runExplain(indexed: boolean) {
    const res = await explain.track(apiCall('GET', '/demo/explain', { query: { indexed }, auth: false }));
    if (!res.ok) return;
    if (indexed) setIdx(res.body as ExplainResponse);
    else setSeq(res.body as ExplainResponse);
  }

  // Звіт по днях: сума постів усіх авторів за день.
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.day.slice(0, 10), (perDay.get(r.day.slice(0, 10)) ?? 0) + r.posts);
  const bars = Array.from(perDay.entries()).map(([day, posts]) => ({ label: day.slice(5), value: posts, title: `${day}: ${posts} постів` }));

  const maxExec = Math.max(seq?.executionTimeMs ?? 0, idx?.executionTimeMs ?? 0, 0.001);

  return (
    <>
      <PageTitle title="SQL, N+1 і індекси" sub="Сирий SQL з віконною функцією, N+1 з лічильником, EXPLAIN до і після індексу" />
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> ORM ховає SQL, але не прибирає його. N+1 не видно у коді (цикл виглядає невинно), видно тільки по кількості запитів,
          тому бекенд рахує їх TypeORM-логером і віддає <code>queryCount</code>. Індекс не "пришвидшує базу", він міняє план: Seq Scan читає всю таблицю, Index
          Scan іде по дереву до потрібних рядків. <code>EXPLAIN (ANALYZE, FORMAT JSON)</code> це єдиний спосіб побачити, що реально сталося.
        </p>
        <p>
          <code>?indexed=false</code> не видаляє індекс, а вимикає індексні сканування через <code>SET LOCAL enable_indexscan = off</code> у транзакції. Таблиця{' '}
          <code>events</code> має 200 000 рядків, фільтр <code>WHERE user_id = $1 AND created_at &gt;= now() - 30 days</code>. Порядок колонок в індексі:
          спочатку рівність (<code>user_id</code>), потім діапазон (<code>created_at</code>).
        </p>
      </Explain>

      <Card title="Звіт posts-per-day: JOIN, GROUP BY, віконна функція" testId="card-report">
        <p className="small muted">
          <code>sum(count(*)) OVER (PARTITION BY автор ORDER BY день)</code> дає накопичений підсумок <code>runningTotal</code> без другого запиту.
        </p>
        <div className="row">
          <label>
            days
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} />
          </label>
          <button type="button" className="primary" onClick={() => void loadReport()} disabled={report.busy} data-testid="report-load">
            GET /reports/posts-per-day
          </button>
        </div>
        {bars.length > 0 && (
          <div data-testid="report-chart">
            <BarChart items={bars} height={150} />
            <table className="tbl small" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>day</th>
                  <th>author</th>
                  <th>posts</th>
                  <th>likes</th>
                  <th>runningTotal</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.day.slice(0, 10)}</td>
                    <td>{r.authorName}</td>
                    <td className="mono">{r.posts}</td>
                    <td className="mono">{r.likes}</td>
                    <td className="mono">{r.runningTotal}</td>
                  </tr>
                ))}
                {rows.length > 8 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      ... ще {rows.length - 8} рядків у відповіді
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <Panel exchange={report.exchange} busy={report.busy} />
      </Card>

      <Card title="N+1: цикл з findOne проти relations" testId="card-nplusone">
        <div className="row">
          <button type="button" className="danger" onClick={() => void runNPlusOne(false)} disabled={nplus.busy} data-testid="nplusone-slow">
            fixed=false (цикл, findOne автора на кожен пост)
          </button>
          <button type="button" className="primary" onClick={() => void runNPlusOne(true)} disabled={nplus.busy} data-testid="nplusone-fast">
            fixed=true (relations, LEFT JOIN)
          </button>
        </div>
        <div className="cols-3">
          <div className="col">
            <h3>fixed=false</h3>
            <div className="big" data-testid="count-slow">
              {slow ? slow.queryCount : '?'}
            </div>
            <div className="muted small">запитів на {slow?.postsReturned ?? '?'} постів</div>
          </div>
          <div className="col">
            <h3>fixed=true</h3>
            <div className="big" data-testid="count-fast">
              {fast ? fast.queryCount : '?'}
            </div>
            <div className="muted small">запитів на {fast?.postsReturned ?? '?'} постів</div>
          </div>
          <div className="col">
            <h3>Чому 2, а не 1</h3>
            <div className="small">
              TypeORM з <code>take</code> + <code>relations</code> спочатку вибирає id сторінки, потім робить JOIN по цих id. Це нормально.
            </div>
          </div>
        </div>
        {(slow || fast) && (
          <BarChart
            items={[
              { label: 'fixed=false', value: slow?.queryCount ?? 0, color: 'var(--bar-alt)' },
              { label: 'fixed=true', value: fast?.queryCount ?? 0 },
            ]}
            height={110}
          />
        )}
        <Panel exchange={nplus.exchange} busy={nplus.busy} />
      </Card>

      <Card title="EXPLAIN: без індексу і з індексом" testId="card-explain">
        <div className="row">
          <button type="button" className="danger" onClick={() => void runExplain(false)} disabled={explain.busy} data-testid="explain-seq">
            indexed=false (Seq Scan)
          </button>
          <button type="button" className="primary" onClick={() => void runExplain(true)} disabled={explain.busy} data-testid="explain-idx">
            indexed=true (Index Scan)
          </button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>Node Type</th>
              <th>Index Name</th>
              <th>Execution Time</th>
              <th>Planning Time</th>
              <th>rows</th>
              <th style={{ width: '30%' }}>час (відносно)</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['indexed=false', seq],
              ['indexed=true', idx],
            ].map(([label, r]) => {
              const row = r as ExplainResponse | null;
              return (
                <tr key={String(label)}>
                  <td className="mono">{String(label)}</td>
                  <td className="mono" data-testid={label === 'indexed=false' ? 'node-seq' : 'node-idx'}>
                    {row?.nodeType ?? '?'}
                  </td>
                  <td className="mono">{row ? (row.indexName ?? 'нема') : '?'}</td>
                  <td className="mono">{row ? `${row.executionTimeMs} мс` : '?'}</td>
                  <td className="mono">{row ? `${row.planningTimeMs} мс` : '?'}</td>
                  <td className="mono">{row?.rowsMatched ?? '?'}</td>
                  <td>
                    {row && (
                      <div className="timeline-bar">
                        <span className="work" style={{ left: 0, width: `${Math.max(1, (row.executionTimeMs / maxExec) * 100)}%` }} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {seq && idx && (
          <div className="note ok">
            Індекс швидший у {Math.round(seq.executionTimeMs / Math.max(0.001, idx.executionTimeMs))} разів на таблиці, що влазить у пам'ять. На диску різниця
            більша.
          </div>
        )}
        <Panel exchange={explain.exchange} busy={explain.busy} />
      </Card>
    </>
  );
}
