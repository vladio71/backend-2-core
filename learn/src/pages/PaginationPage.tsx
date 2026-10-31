// Пагінація: offset проти cursor на одному списку постів. Панель показує точний query string і розкодований курсор.
import { useState } from 'react';
import { apiCall, buildQueryString, QueryValue } from '../api/client';
import { decodeBase64UrlJson } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel, pretty } from '../components/Panel';
import { Card, Explain, PageTitle, WhereInCode } from '../components/common';

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

export function PaginationPage() {
  const latency = useLatency();
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

  const previewQs = buildQueryString(buildQuery(page, cursor));
  const decodedCursor = cursor ? decodeBase64UrlJson(cursor) : null;
  const decodedNext = nextCursor ? decodeBase64UrlJson(nextCursor) : null;
  const canNext = mode === 'offset' ? total !== null && page * pageSize < total : nextCursor !== null;

  return (
    <>
      <PageTitle title="Пагінація, сортування, фільтри" sub="GET /posts: q, tags, sort, dir, offset або cursor" />
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> Усі параметри проходять через DTO з class-validator: sort тільки з трьох значень, pageSize ціле число. Далі
          QueryBuilder додає умову WHERE для кожного заданого фільтра.
        </p>
        <p>
          Пошук q робить <code>ILIKE '%q%'</code> по title і body. Теги йдуть через оператори масивів Postgres: <code>&&</code> означає "хоч один",{' '}
          <code>@&gt;</code> означає "усі".
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
              <td>Дає total і "сторінка 7 з 40"</td>
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
          Курсор це base64url від <code>{'{ "v": <значення сортування>, "id": <id> }'}</code> останнього елемента. id потрібен, бо значення сортування можуть
          збігатися (два пости з 5 лайками). Сервер бере на один рядок більше, ніж pageSize, щоб знати, чи є наступна сторінка.
        </p>
        <WhereInCode paths={['src/modules/posts/dto/list-posts.dto.ts', 'posts.service.ts (QueryBuilder, курсор)']} />
      </Explain>

      <Card title="Список">
        <div className="prose">
          <p>
            Той самий список постів двома способами. В offset-режимі відповідь має total і номер сторінки, і "Наступна" просто збільшує page. У cursor-режимі
            total немає, зате є nextCursor: непрозорий рядок, який панель нижче розкодує, щоб було видно значення сортування і id останнього елемента.
          </p>
          <p>
            На що дивитись: query string біля кнопок і SQL у відповіді. Добре, коли в cursor-режимі сторінки не дублюються після вставки нового поста; в
            offset-режимі це можливо. nextCursor: null означає останню сторінку.
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
      </Card>
    </>
  );
}
