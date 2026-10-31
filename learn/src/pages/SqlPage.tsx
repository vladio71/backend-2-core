// SQL і індекси: три картки з власними панелями: звіт posts-per-day (SVG), N+1 (лічильник запитів), EXPLAIN (Seq Scan проти Index Scan).
import { useState } from 'react';
import { apiCall } from '../api/client';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { BarChart, Card, LineChart, LineSeries, PageTitle } from '../components/common';
import { Concept, PanelNotes } from '../components/topic';

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

function shorten(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  const from = flat.indexOf(' FROM ');
  const tail = from === -1 ? flat : flat.slice(from);
  return tail.length > 150 ? `${tail.slice(0, 150)}...` : tail;
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

  const maxExec = Math.max(seq?.executionTimeMs ?? 0, idx?.executionTimeMs ?? 0, 0.001);

  return (
    <>
      <PageTitle title="SQL, N+1 і індекси" sub="Сирий SQL з віконною функцією, N+1 з лічильником, EXPLAIN до і після індексу" />
      <Concept
        what={
          <p>
            Звіт «скільки постів і лайків кожен автор написав за день» це агрегація: з багатьох рядків виходить менше, але підсумкових. SQL робить це одним
            запитом. Альтернатива, витягти всі пости в Node і порахувати циклом, гірша і по мережі, і по пам'яті.
          </p>
        }
        when={
          <>
            <p>
              Коли відповідь це підсумок (кількість, сума, топ-10), а не сам список: рахуй у базі й віддавай готові числа. Коли ти і так вантажиш усі рядки на
              екран, агрегація не потрібна.
            </p>
            <p>
              Віконна функція потрібна для «накопиченого», плинного середнього або місця в рейтингу: без неї це був би другий запит або цикл. Якщо звіт рідкісний,
              але важкий (мільйони рядків), думай про матеріалізоване представлення, а не про ще один індекс.
            </p>
          </>
        }
        how={
          <p>
            Один сирий SQL-запит (ORM тут би заважав). JOIN до users бере ім'я автора замість uuid. GROUP BY день і автор дає один рядок на пару з кількістю постів і
            сумою лайків. Віконна функція <code>sum(count(*)) OVER (PARTITION BY автор ORDER BY день)</code> додає накопичений підсумок по кожному автору, без
            другого запиту. У сіді 51 пост за 30 днів, від одного до трьох на день, автори пишуть нерівно: Olena приблизно 27, Taras 15, Iryna 9.
          </p>
        }
      />

      <Card title="Звіт posts-per-day: JOIN, GROUP BY, віконна функція" testId="card-report">
        <div className="prose">
          <p>
            runningTotal у кожному рядку це накопичена кількість постів саме цього автора, а не всіх разом. На графіку крива Olena крутіша за Iryna, бо Olena пише
            частіше, а плато означає день без постів. Постав days=30, щоб побачити всі 51 пост.
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
            <div className="chart-title">runningTotal по авторах за день</div>
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
        <PanelNotes
          where={['src/modules/queries/posts-per-day.controller.ts (JOIN, GROUP BY, OVER)']}
          tryItems={[
            <>Постав days=7: лінії стають коротшими, а runningTotal рахується лише в межах цього вікна, тобто починається знову з 1.</>,
            <>Наведи курсор на точку графіка: у підказці автор, день і значення.</>,
          ]}
        />
      </Card>

      <Concept
        what={
          <p>
            N+1 це коли один запит бере список (30 постів), а потім у циклі на кожен елемент іде ще запит (автор цього поста). Разом 1 + 30 = 31 запит там, де
            вистачило б двох.
          </p>
        }
        when={
          <>
            <p>
              Вилізає, коли в циклі є await до бази або коли ORM сам підтягує зв'язок при зверненні до поля. У коді це виглядає невинно, і кожен запит швидкий
              (близько мілісекунди), тому локально на 10 рядках усе добре. На проді 1000 постів це 1001 запит, і на кожен ще мережа та планування.
            </p>
            <p>
              Не варто лякатись, коли елементів завжди три, або це одноразовий скрипт. Лікування: JOIN (relations) або один <code>WHERE id IN (...)</code> замість
              запиту на кожен елемент.
            </p>
          </>
        }
        how={
          <p>
            Помітити N+1 можна тільки по кількості запитів, не по коду. Тому бекенд рахує їх логером TypeORM і віддає число в полі queryCount, разом з текстом
            запитів. Дві кнопки нижче повертають ті самі 30 постів з іменами авторів.
          </p>
        }
      />

      <Card title="N+1: цикл з findOne проти relations" testId="card-nplusone">
        <div className="prose">
          <p>
            Добре, коли лічильник не росте разом із кількістю постів: 2 замість 31. Під лічильниками видно, що саме полетіло в базу.
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
        {slow && (
          <div className="small" data-testid="slow-queries" style={{ marginTop: 10 }}>
            <h3>fixed=false: перші запити</h3>
            <ul className="mono small">
              {slow.queries.slice(0, 3).map((q, i) => (
                <li key={i}>{shorten(q)}</li>
              ))}
            </ul>
            <div className="muted small">... і ще {Math.max(0, slow.queries.length - 3)} таких самих запитів по users, різниця тільки в id у WHERE.</div>
          </div>
        )}
        <Panel exchange={nplus.exchange} busy={nplus.busy} />
        <PanelNotes
          where={['src/modules/queries/n-plus-one.controller.ts', 'src/modules/database/query-counter.ts (рахує запити логером TypeORM)']}
          tryItems={[
            <>Натисни обидві кнопки й порівняй queryCount: 31 і 2.</>,
            <>
              Постав <code>DB_LOG_QUERIES=true</code>, перезапусти API, натисни fixed=false і подивись у термінал: 31 рядок SQL за один HTTP-запит.
            </>,
          ]}
        />
      </Card>

      <Concept
        what={
          <p>
            Індекс це окрема впорядкована структура, як зміст у книзі: Postgres знаходить по ній потрібні рядки, не читаючи всю таблицю. EXPLAIN ANALYZE питає
            базу, як вона виконала запит: Seq Scan означає, що прочитано всю таблицю, Index Scan, що пішли по індексу.
          </p>
        }
        when={
          <>
            <p>
              Індекс потрібен колонкам, за якими часто фільтруєш чи сортуєш у великій таблиці. Не потрібен на малій таблиці: на 51 пості Seq Scan швидший за індекс.
              І не потрібен колонці, яку рідко читають, але часто пишуть: кожен індекс сповільнює INSERT і UPDATE та займає місце.
            </p>
            <p>
              У складеному індексі спочатку колонки з рівністю (user_id), потім діапазон (created_at). Не вгадуй, чи індекс допоміг: дивись EXPLAIN.
            </p>
          </>
        }
        how={
          <p>
            Таблиця events має 200 000 рядків від 1000 різних user_id, по 200 на користувача. Запит бере події одного user_id за останні 30 днів і знаходить близько
            сотні. Параметр indexed=false не видаляє індекс, а вимикає індексні сканування на одну транзакцію (<code>SET LOCAL enable_indexscan = off</code>). Так
            обидва запити йдуть на одних і тих самих даних, і порівняння чесне.
          </p>
        }
      />

      <Card title="EXPLAIN: без індексу і з індексом" testId="card-explain">
        <div className="prose">
          <p>
            Той самий запит двічі. Добре: однаковий rows в обох рядках (результат той самий) і Execution Time у десятки і сотні разів менший з індексом. У другому рядку
            Postgres може показати Index Only Scan: усе потрібне лежить в самому індексі, і таблицю взагалі не читають. Погано: Seq Scan на запиті, який
            виконується часто.
          </p>
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
        <PanelNotes
          where={['src/modules/queries/explain.controller.ts (SET LOCAL enable_indexscan = off)', 'src/migrations/1700000000003-AddEventsUserCreatedIndex.ts']}
          tryItems={[
            <>Натисни кожну кнопку двічі: Execution Time плаває, але порядок величин не змінюється. Перший запуск може бути повільнішим через холодний кеш.</>,
            <>
              Виконай <code>npm run migration:revert</code> і натисни indexed=true: тепер теж Seq Scan, бо індексу немає. <code>npm run migration:run</code> повертає
              його.
            </>,
          ]}
        />
      </Card>
    </>
  );
}
