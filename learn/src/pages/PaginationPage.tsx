// Пагінація: offset проти cursor на одному списку постів. Панель показує точний query string і розкодований курсор.
import { useState } from 'react';
import { apiCall, buildQueryString, QueryValue } from '../api/client';
import { decodeBase64UrlJson, useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, pretty } from '../components/Panel';
import { Card, NeedAuth, PageTitle } from '../components/common';
import { Concept, PanelNotes } from '../components/topic';

interface PostRow {
  id: string;
  title: string;
  tags: string[];
  status: string;
  likes: number;
  createdAt: string;
}

interface OffsetPage {
  items: PostRow[];
  page: number;
  pageSize: number;
  total: number;
}

interface CursorPage {
  items: PostRow[];
  nextCursor: string | null;
}

interface DemoColumn {
  page1: PostRow[];
  page2: PostRow[];
  duplicates: number;
}

interface DemoResult {
  offset: DemoColumn;
  cursor: DemoColumn;
  inserted: number;
}

function base64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const DEMO_PAGE_SIZE = 5;

export function PaginationPage() {
  const auth = useAuth();
  const latency = useLatency();
  const demoLatency = useLatency();
  const tamper = useLatency();
  const [inserts, setInserts] = useState(1);
  const [demo, setDemo] = useState<DemoResult | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [q, setQ] = useState('');
  const [tags, setTags] = useState('');
  const [tagsMode, setTagsMode] = useState<'any' | 'all'>('any');
  const [sort, setSort] = useState<'createdAt' | 'title' | 'likes'>('createdAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(5);
  const [mode, setMode] = useState<'offset' | 'cursor'>('offset');
  const [page, setPage] = useState(1);
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<PostRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  function buildQuery(nextPage: number, nextCursorValue: string | null): Record<string, QueryValue> {
    const query: Record<string, QueryValue> = { q, tags, tagsMode: tags ? tagsMode : undefined, sort, dir, pageSize };
    if (mode === 'offset') {
      query.page = nextPage;
    } else {
      query.mode = 'cursor';
      query.cursor = nextCursorValue ?? undefined;
    }
    return query;
  }

  async function load(nextPage: number, nextCursorValue: string | null) {
    const res = await latency.track(apiCall('GET', '/posts', { query: buildQuery(nextPage, nextCursorValue), auth: false }));
    if (!res.ok) return;
    if (mode === 'offset') {
      const body = res.body as OffsetPage;
      setItems(body.items);
      setTotal(body.total);
      setPage(body.page);
      setNextCursor(null);
    } else {
      const body = res.body as CursorPage;
      setItems(body.items);
      setTotal(null);
      setCursor(nextCursorValue);
      setNextCursor(body.nextCursor);
    }
  }

  function first() {
    setPage(1);
    setCursor(null);
    void load(1, null);
  }

  function next() {
    if (mode === 'offset') void load(page + 1, null);
    else if (nextCursor) void load(1, nextCursor);
  }

  async function runDemo() {
    setDemoRunning(true);
    setDemoError(null);
    setDemo(null);
    const created: string[] = [];
    const query = { sort: 'createdAt', dir: 'desc', pageSize: DEMO_PAGE_SIZE };
    try {
      const off1 = await demoLatency.track(apiCall('GET', '/posts', { query: { ...query, page: 1 }, auth: false }));
      const cur1 = await demoLatency.track(apiCall('GET', '/posts', { query: { ...query, mode: 'cursor' }, auth: false }));
      if (!off1.ok || !cur1.ok) {
        setDemoError('Не вдалося прочитати першу сторінку.');
        return;
      }
      const nextCursor = (cur1.body as CursorPage).nextCursor;
      if (!nextCursor) {
        setDemoError('У базі менше постів, ніж потрібно для двох сторінок.');
        return;
      }
      for (let i = 0; i < inserts; i++) {
        const res = await demoLatency.track(
          apiCall('POST', '/posts', { body: { title: `Пагінація: демо-пост ${i + 1}`, body: 'Тимчасовий пост для демо. Буде видалений одразу після.', tags: ['demo'] } }),
        );
        if (!res.ok) {
          setDemoError(`POST /posts дав ${res.status}. Спробуй ще раз за кілька секунд.`);
          return;
        }
        created.push((res.body as { id: string }).id);
      }
      const off2 = await demoLatency.track(apiCall('GET', '/posts', { query: { ...query, page: 2 }, auth: false }));
      const cur2 = await demoLatency.track(apiCall('GET', '/posts', { query: { ...query, mode: 'cursor', cursor: nextCursor }, auth: false }));
      if (!off2.ok || !cur2.ok) {
        setDemoError('Не вдалося прочитати другу сторінку.');
        return;
      }
      const column = (first: PostRow[], second: PostRow[]): DemoColumn => {
        const seen = new Set(first.map((p) => p.id));
        return { page1: first, page2: second, duplicates: second.filter((p) => seen.has(p.id)).length };
      };
      setDemo({
        offset: column((off1.body as OffsetPage).items, (off2.body as OffsetPage).items),
        cursor: column((cur1.body as CursorPage).items, (cur2.body as CursorPage).items),
        inserted: created.length,
      });
    } finally {
      // Прибираємо за собою: демо-пости м'яко видаляються, у списку їх більше не буде.
      for (const id of created) await apiCall('DELETE', `/posts/${id}`);
      setDemoRunning(false);
    }
  }

  type TamperKind = 'junk' | 'badValue' | 'manual';

  async function tamperCall(kind: TamperKind) {
    const zeroId = '00000000-0000-4000-8000-000000000001';
    const cursor =
      kind === 'junk' ? 'abc' : kind === 'badValue' ? base64UrlJson({ v: 'abc', id: zeroId }) : base64UrlJson({ v: '2000-01-01T00:00:00.000Z', id: zeroId });
    await tamper.track(apiCall('GET', '/posts', { query: { mode: 'cursor', sort: 'createdAt', dir: kind === 'manual' ? 'asc' : 'desc', pageSize: 3, cursor }, auth: false }));
  }

  const previewQs = buildQueryString(buildQuery(page, cursor));
  const decodedCursor = cursor ? decodeBase64UrlJson(cursor) : null;
  const decodedNext = nextCursor ? decodeBase64UrlJson(nextCursor) : null;
  const canNext = mode === 'offset' ? total !== null && page * pageSize < total : nextCursor !== null;

  return (
    <>
      <PageTitle title="Пагінація, сортування, фільтри" sub="GET /posts: q, tags, sort, dir, offset або cursor" />
      <Concept
        what={
          <p>
            Таблиця постів може мати 50 рядків, а може 5 мільйонів. Віддавати все одразу не можна, тому список віддають шматками. Є два способи сказати, де ми
            зараз: «сторінка 3» (offset) або «продовжи після цього елемента» (cursor).
          </p>
        }
        when={
          <>
            <p>
              Offset потрібен, коли в інтерфейсі є номери сторінок і «усього 40 сторінок», як в адмінці. Він простий і дає total. Але чим далі сторінка, тим
              повільніше: OFFSET 100000 змушує базу прочитати і викинути 100 000 рядків. І другий мінус: поки ти читаєш, список змінюється, і сторінки зсуваються
              (див. сценарій нижче).
            </p>
            <p>
              Cursor потрібен для стрічки, нескінченного скролу, експорту, для будь-чого, куди постійно щось додається або де багато рядків. Ціна: немає «сторінка 7
              з 40» і не можна стрибнути на сторінку 7. Обидва способи потребують індексу під сортування, інакше обидва повільні. На 51 пості тут різниці в часі
              не буде, ця сторінка показує поведінку, а не швидкість.
            </p>
          </>
        }
        how={
          <>
            <p>
              GET /posts вміє обидва режими. Без cursor це offset (page і pageSize, у відповіді items і total). З mode=cursor або з cursor це cursor (у відповіді
              items і nextCursor). Фільтри однакові: q шукає ILIKE по title і body, tags із режимом «хоч один» (оператор &&) або «усі» (оператор @&gt;). Параметри
              перевіряє DTO: sort тільки з трьох значень, pageSize від 1 до 100.
            </p>
            <table className="tbl">
              <thead>
                <tr>
                  <th></th>
                  <th>Offset</th>
                  <th>Cursor</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Запит</td>
                  <td className="mono">?page=3&pageSize=10</td>
                  <td className="mono">?mode=cursor&pageSize=10&cursor=eyJ2...</td>
                </tr>
                <tr>
                  <td>SQL</td>
                  <td className="mono">ORDER BY ... LIMIT 10 OFFSET 20</td>
                  <td className="mono">WHERE (created_at, id) &lt; ($v, $id) ORDER BY ... LIMIT 11</td>
                </tr>
                <tr>
                  <td>Дає total і «сторінка 7 з 40»</td>
                  <td>так</td>
                  <td>ні</td>
                </tr>
                <tr>
                  <td>Стабільний при вставках між запитами</td>
                  <td>ні (дублікати або пропуски)</td>
                  <td>так</td>
                </tr>
                <tr>
                  <td>Вартість сторінки N</td>
                  <td>O(N * pageSize): читає і викидає</td>
                  <td>O(pageSize)</td>
                </tr>
              </tbody>
            </table>
            <p>
              <b>Що в курсорі і навіщо там id.</b> Курсор це base64url від JSON {'{ "v": значення сортування, "id": id }'} останнього елемента сторінки. Саме
              значення сортування не годиться, бо воно повторюється: два пости можуть мати по 5 лайків. Тоді «продовж після лайків = 5» не каже, який із двох уже
              показаний, і один загубиться або продублюється. Пара (v, id) однозначна, бо id унікальний.
            </p>
            <p>
              Для перевірки сервер бере на один рядок більше, ніж pageSize: зайвий рядок лише каже, що наступна сторінка є, і до клієнта не йде.
            </p>
            <p>
              <b>Курсор непрозорий, але не підписаний.</b> Це просто base64 від JSON, його може прочитати і змінити будь-хто (панель нижче його розкодовує).
              Нічого страшного: значення йдуть у SQL параметрами, тож ін'єкції немає, а список і так публічний. Підробивши курсор, клієнт лише перестрибне в інше
              місце того самого списку. А що робить сервер із зіпсованим? Будь-який курсор, який не можна використати, це 400 BAD_CURSOR: не JSON, немає id, або
              форма правильна, а v не того типу, що поле сортування («abc» для createdAt, дата для sort=likes). Перевіряти тип v обов'язково: без цього
              сміття доходить до Postgres, він відхиляє порівняння, і клієнт бачить 500 замість зрозумілої помилки. Чому 400, а не 409: клієнт надіслав
              некоректний запит, конфлікту зі станом сервера тут немає. Три кнопки в останній панелі показують усі випадки.
            </p>
          </>
        }
      />

      <Card title="Список">
        <div className="prose">
          <p>
            Той самий список двома способами. В offset-режимі є total і номер сторінки, «Наступна» збільшує page. У cursor-режимі total немає, зате є nextCursor, і
            панель нижче його розкодовує. nextCursor: null означає останню сторінку.
          </p>
        </div>
        <div className="row">
          <label>
            q (пошук)
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="postgres" />
          </label>
          <label>
            tags (через кому)
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="node,redis" />
          </label>
          <label>
            tagsMode
            <select value={tagsMode} onChange={(e) => setTagsMode(e.target.value as 'any' | 'all')}>
              <option value="any">any (хоч один)</option>
              <option value="all">all (усі)</option>
            </select>
          </label>
          <label>
            sort
            <select value={sort} onChange={(e) => setSort(e.target.value as 'createdAt' | 'title' | 'likes')}>
              <option value="createdAt">createdAt</option>
              <option value="title">title</option>
              <option value="likes">likes</option>
            </select>
          </label>
          <label>
            dir
            <select value={dir} onChange={(e) => setDir(e.target.value as 'asc' | 'desc')}>
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </select>
          </label>
          <label>
            pageSize
            <input type="number" min={1} max={50} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value) || 5)} />
          </label>
          <label>
            режим
            <select
              value={mode}
              data-testid="mode"
              onChange={(e) => {
                setMode(e.target.value as 'offset' | 'cursor');
                setPage(1);
                setCursor(null);
                setNextCursor(null);
                setItems([]);
                setTotal(null);
              }}
            >
              <option value="offset">offset</option>
              <option value="cursor">cursor</option>
            </select>
          </label>
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={first} disabled={latency.busy} data-testid="load">
            Перша сторінка
          </button>
          <button type="button" onClick={next} disabled={latency.busy || !canNext} data-testid="next">
            Наступна сторінка
          </button>
          <span className="muted small mono">GET /posts{previewQs}</span>
        </div>
        {mode === 'offset' && total !== null && (
          <div className="muted small">
            сторінка {page} з {Math.max(1, Math.ceil(total / pageSize))}, total {total}
          </div>
        )}
        {mode === 'cursor' && (
          <div className="panel-headers" style={{ marginTop: 4 }}>
            <span>
              поточний cursor: <b>{cursor ? cursor.slice(0, 24) + '...' : '(нема, перша сторінка)'}</b>
            </span>
            {decodedCursor !== null && (
              <span>
                розкодований: <b data-testid="decoded-cursor">{pretty(decodedCursor, 200).replace(/\s+/g, ' ')}</b>
              </span>
            )}
            {decodedNext !== null && (
              <span>
                nextCursor розкодований: <b>{pretty(decodedNext, 200).replace(/\s+/g, ' ')}</b>
              </span>
            )}
            {nextCursor === null && items.length > 0 && <span>nextCursor: null (останні)</span>}
          </div>
        )}
        {items.length > 0 && (
          <table className="tbl" data-testid="posts-table">
            <thead>
              <tr>
                <th>title</th>
                <th>tags</th>
                <th>status</th>
                <th>likes</th>
                <th>createdAt</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td className="mono">{p.tags.join(', ')}</td>
                  <td>{p.status}</td>
                  <td className="mono">{p.likes}</td>
                  <td className="mono">{p.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
        <PanelNotes
          where={['src/modules/posts/dto/list-posts.dto.ts (ListPostsDto)', 'src/modules/posts/posts.service.ts (list, listByOffset, listByCursor)']}
          tryItems={[
            <>Постав sort=likes і режим cursor, пройди всі сторінки до nextCursor: null. Жоден пост не повторюється, хоч у багатьох однакові likes.</>,
            <>Введи pageSize=101 і натисни «Перша сторінка»: отримаєш 400, у details буде максимум 100.</>,
          ]}
        />
      </Card>

      <Card title="Чому offset ламається, а cursor ні" testId="card-offset-breaks">
        <div className="prose">
          <p>
            Сценарій робить усе сам. Читає першу сторінку двома способами, створює між запитами {inserts} {inserts === 1 ? 'новий пост' : 'нових пости'} (як
            це робить інший користувач, поки ти гортаєш), читає другу сторінку і видаляє створене. Новий пост стає першим у списку, і все зсувається.
          </p>
        </div>
        <NeedAuth>Сценарій створює і видаляє власні пости, тому токен потрібен.</NeedAuth>
        <div className="row">
          <label>
            нових постів між запитами
            <input type="number" min={1} max={4} value={inserts} onChange={(e) => setInserts(Math.min(4, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <button type="button" className="primary" onClick={() => void runDemo()} disabled={demoRunning || !auth.tokens} data-testid="offset-demo">
            {demoRunning ? 'виконується...' : 'Запустити сценарій'}
          </button>
        </div>
        {demoError && <div className="note err">{demoError}</div>}
        {demo && (
          <div data-testid="offset-demo-result">
            <div className="cols-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              {(
                [
                  ['offset', 'offset: ?page=1, потім ?page=2', demo.offset],
                  ['cursor', 'cursor: перша сторінка, потім nextCursor', demo.cursor],
                ] as const
              ).map(([key, title, column]) => {
                const seen = new Set(column.page1.map((p) => p.id));
                return (
                  <div className="col" key={key}>
                    <h3>{title}</h3>
                    <table className="tbl small">
                      <thead>
                        <tr>
                          <th>сторінка 1</th>
                          <th>сторінка 2</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: DEMO_PAGE_SIZE }, (_, i) => {
                          const first = column.page1[i];
                          const second = column.page2[i];
                          return (
                            <tr key={i}>
                              <td>{first?.title ?? ''}</td>
                              <td>
                                {second?.title ?? ''} {second && seen.has(second.id) && <span className="badge s4">дублікат</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="small" data-testid={`dups-${key}`}>
                      Дублікатів: <b>{column.duplicates}</b>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="note ok">
              Між запитами з'явилось {demo.inserted} {demo.inserted === 1 ? 'пост' : 'пости'}. Offset повторив {demo.offset.duplicates} {demo.offset.duplicates === 1 ? 'рядок' : 'рядки'} зі сторінки 1,
              бо «пропусти 5» тепер пропускає вже інші 5. Cursor продовжив після останнього елемента, який бачив, і не повторив нічого. Нові пости він покаже, коли
              почнеш знову з першої сторінки. Зворотний випадок: видалення поста зі сторінки 1 в offset призвело б до пропуску.
            </div>
          </div>
        )}
        <Panel exchange={demoLatency.exchange} busy={demoLatency.busy} />
        <PanelNotes
          where={['src/modules/posts/posts.service.ts (listByOffset: skip і take; listByCursor: порівняння кортежу)']}
          tryItems={[
            <>Постав 3 нових пости між запитами: offset повторить три останні рядки сторінки 1, cursor знову нуль.</>,
            <>Запусти сценарій двічі підряд: результат той самий, бо за собою він прибирає.</>,
          ]}
        />
      </Card>

      <Card title="Курсор можна підробити" testId="card-tamper">
        <div className="prose">
          <p>
            Кожна кнопка збирає курсор руками і надсилає його. Подивись на код відповіді: курсор, який сервер не зміг розібрати, і курсор, який він розібрав, але не зміг
            використати, закінчуються по-різному.</p>
        </div>
        <div className="row">
          <button type="button" onClick={() => void tamperCall('junk')} disabled={tamper.busy} data-testid="tamper-junk">
            cursor=abc (не JSON)
          </button>
          <button type="button" onClick={() => void tamperCall('badValue')} disabled={tamper.busy} data-testid="tamper-bad-value">
            Правильна форма, але v = «abc»
          </button>
          <button type="button" onClick={() => void tamperCall('manual')} disabled={tamper.busy} data-testid="tamper-manual">
            Курсор, зібраний руками: v = 2000-01-01, dir=asc
          </button>
        </div>
        <Panel exchange={tamper.exchange} busy={tamper.busy} />
        <PanelNotes
          where={['src/modules/posts/posts.service.ts (encodeCursor, decodeCursor: BadRequestError BAD_CURSOR, перевірка типу v під поле сортування)']}
          tryItems={[
            <>Третя кнопка дає 200 і три найстаріші пости: сервер курсор не підписує і пускає туди, куди курсор указує.</>,
            <>
              Прибери в <code>decodeCursor</code> перевірку типу v для createdAt і натисни другу кнопку: замість 400 буде 500 з Postgres («invalid input syntax for type
              timestamp»). Поверни перевірку назад.
            </>,
          ]}
        />
      </Card>
    </>
  );
}
