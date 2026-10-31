// SQL і індекси: три картки з власними панелями: звіт posts-per-day (SVG), N+1 (лічильник запитів), EXPLAIN (Seq Scan проти Index Scan).
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { BarChart, Card, Explain, LineChart, LineSeries, PageTitle, WhereInCode } from '../components/common';

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

  // Графік: накопичений підсумок (runningTotal) окремо по кожному автору. Лінія автора росте у день його поста
  // і тримає рівень у дні, коли він нічого не писав, тому видно саме "скільки всього у цього автора на цей день".
  const dayKeys = Array.from(new Set(rows.map((r) => r.day.slice(0, 10)))).sort();
  const authors = Array.from(new Set(rows.map((r) => r.authorName))).sort();
  const authorColors = ['var(--bar-work)', 'var(--bar-alt)', 'var(--ok)', 'var(--info)', 'var(--err)'];
  const series: LineSeries[] = authors.map((author, index) => {
    let last = 0;
    const points = dayKeys.map((day) => {
      const row = rows.find((r) => r.authorName === author && r.day.slice(0, 10) === day);
      if (row) last = row.runningTotal;
      return { label: day.slice(5), value: last };
    });
    return { name: author, color: authorColors[index % authorColors.length], points };
  });
  const everyDayOnePost = rows.length > 0 && rows.every((r) => r.posts === 1);

  const maxExec = Math.max(seq?.executionTimeMs ?? 0, idx?.executionTimeMs ?? 0, 0.001);

  return (
    <>
      <PageTitle title="SQL, N+1 і індекси" sub="Сирий SQL з віконною функцією, N+1 з лічильником, EXPLAIN до і після індексу" />
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> ORM ховає SQL, але не прибирає його. N+1 не видно у коді (цикл виглядає невинно), видно тільки по кількості запитів,
          тому бекенд рахує їх логером TypeORM і віддає в полі queryCount.
        </p>
        <p>
          Індекс не "пришвидшує базу", він міняє план: Seq Scan читає всю таблицю, Index Scan іде по дереву до потрібних рядків.{' '}
          <code>EXPLAIN (ANALYZE, FORMAT JSON)</code> це єдиний спосіб побачити, що реально сталося.
        </p>
        <p>
          Параметр indexed=false не видаляє індекс, а вимикає індексні сканування на одну транзакцію через <code>SET LOCAL enable_indexscan = off</code>.
          Таблиця events має 200 000 рядків, фільтр по user_id і по created_at за останні 30 днів.
        </p>
        <p>Порядок колонок в індексі: спочатку рівність (user_id), потім діапазон (created_at).</p>
        <WhereInCode paths={['src/modules/database/query-counter.ts', 'queries/n-plus-one.controller.ts', 'queries/explain.controller.ts', 'migrations/...-AddEventsUserCreatedIndex.ts']} />
      </Explain>

      <Card title="Звіт posts-per-day: JOIN, GROUP BY, віконна функція" testId="card-report">
        <div className="prose">
          <p>
            Один запит робить три речі. JOIN: до кожного поста беремо його автора. GROUP BY день + автор: один рядок на пару "день, автор" з кількістю постів і
            сумою лайків. Віконна функція <code>sum(count(*)) OVER (PARTITION BY автор ORDER BY день)</code>: накопичений підсумок по автору без другого запиту.
          </p>
          <p>
            На що дивитись: колонка runningTotal це сума саме цього автора на цей день, а не всіх разом. У сіді один пост на день, автори чергуються, тому
            Olena має 9 на 10-28 і 10 на 10-31. Графік показує runningTotal по кожному автору: три сходинки, що ростуть по черзі.
          </p>
        </div>
        <div className="row">
          <label>
            days
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} />
          </label>
          <button type="button" className="primary" onClick={() => void loadReport()} disabled={report.busy} data-testid="report-load">
            GET /reports/posts-per-day
          </button>
        </div>
        {rows.length > 0 && (
          <div data-testid="report-chart">
            <div className="chart-title">runningTotal по авторах за день{everyDayOnePost ? ' (у сіді рівно один пост на день)' : ''}</div>
            <LineChart series={series} height={170} />
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
        <div className="prose">
          <p>
            N+1 це один запит за списком, а потім ще один запит на кожен елемент списку: на 30 постах виходить 31 запит, на 1000 постів 1001. База відповідає
            швидко на кожен, але мережа і планування запиту платяться щоразу, тому список "раптом" починає гальмувати на реальних даних.
          </p>
          <p>
            Виправлення: взяти авторів одним запитом, через JOIN або <code>WHERE id IN (...)</code>. Нижче обидві кнопки повертають ті самі пости; добре,
            коли лічильник запитів не росте разом із кількістю постів (2 замість 31).
          </p>
        </div>
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
        <div className="prose">
          <p>
            Той самий запит до таблиці events на 200 000 рядків, двічі: з вимкненими індексними скануваннями і з індексом. Дивись на Node Type: Seq Scan
            означає, що Postgres прочитав усю таблицю, Index Scan означає, що пішов по індексу одразу до потрібних рядків.
          </p>
          <p>Добре: однаковий rows в обох рядках (результат той самий) і Execution Time у рази менший з індексом. Погано: Seq Scan на запиті, який виконується часто.</p>
        </div>
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
