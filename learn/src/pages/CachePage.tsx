// Кеш: GET /posts/:id/stats кілька разів (MISS, потім HIT), PATCH інвалідовує, знову MISS.
import { useEffect, useState } from 'react';
import { apiCall, ApiExchange } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, Explain, NeedAuth, PageTitle, WhereInCode } from '../components/common';

interface PostRow {
  id: string;
  title: string;
  likes: number;
  authorId: string;
}

export function CachePage() {
  const auth = useAuth();
  const latency = useLatency(30);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [postId, setPostId] = useState('');
  const [calls, setCalls] = useState<ApiExchange[]>([]);

  useEffect(() => {
    // Беремо пости поточного користувача (PATCH дозволений автору або admin); якщо не залогінений, будь-які.
    const query = auth.user && auth.user.role !== 'admin' ? { authorId: auth.user.id, pageSize: 20 } : { pageSize: 20 };
    void apiCall('GET', '/posts', { query, auth: false }).then((res) => {
      if (!res.ok) return;
      const items = (res.body as { items: PostRow[] }).items;
      setPosts(items);
      setPostId((current) => current || items[0]?.id || '');
    });
  }, [auth.user]);

  async function stats() {
    if (!postId) return;
    const res = await latency.track(apiCall('GET', `/posts/${postId}/stats`, { auth: false }));
    setCalls((prev) => [...prev, res].slice(-12));
  }

  async function patch() {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    const res = await latency.track(apiCall('PATCH', `/posts/${postId}`, { body: { likes: post.likes + 1 } }));
    if (res.ok) {
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, likes: post.likes + 1 } : p)));
      setCalls((prev) => [...prev, res].slice(-12));
    }
  }

  return (
    <>
      <PageTitle title="Кеш" sub="GET /posts/:id/stats у Redis на 60 с, інвалідація при записі" />
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> Агрегат по кількох таблицях дорогий (у коді ще є pg_sleep на 0.2 с, щоб це було видно). Результат кладеться у Redis
          на 60 секунд, а заголовок <code>X-Cache: HIT|MISS</code> каже, звідки прийшла відповідь.
        </p>
        <p>
          PATCH, DELETE і publish цього поста видаляють ключ <code>post:stats:&lt;id&gt;</code>, тому наступний GET знову MISS.
        </p>
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>TTL</th>
              <th>Інвалідація</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Свіжість даних</td>
              <td>до 60 с застарілі</td>
              <td>свіжі одразу після запису</td>
            </tr>
            <tr>
              <td>Що треба пам'ятати</td>
              <td>нічого</td>
              <td>кожне місце, де пишеться пост</td>
            </tr>
            <tr>
              <td>Якщо забули</td>
              <td>дані оновляться самі через 60 с</td>
              <td>застарілі назавжди</td>
            </tr>
            <tr>
              <td>Разом</td>
              <td colSpan={2}>TTL як страховка + інвалідація для свіжості</td>
            </tr>
          </tbody>
        </table>
        <WhereInCode paths={['src/modules/posts/post-stats-cache.service.ts', 'stats.controller.ts']} />
      </Explain>

      <Card title="Спробувати">
        <div className="prose">
          <p>
            Перевіряємо кеш і його інвалідацію. Натисни GET двічі: перший раз X-Cache: MISS і довго (агрегат рахується в базі, плюс 200 мс затримки), другий раз
            HIT і одиниці мілісекунд, бо відповідь узято з Redis. Потім PATCH: він видаляє ключ, тому наступний GET знову MISS, але вже з новим likes.
          </p>
          <p>Погано, якби після PATCH прийшов HIT зі старими даними: це і є "застарілий кеш".</p>
        </div>
        <NeedAuth>GET /stats працює без токена, але PATCH (інвалідація) потребує автора або admin.</NeedAuth>
        <div className="row">
          <label>
            пост
            <select value={postId} onChange={(e) => setPostId(e.target.value)} data-testid="post-select">
              {posts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} (likes {p.likes})
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary" onClick={() => void stats()} disabled={latency.busy || !postId} data-testid="stats">
            GET /posts/:id/stats
          </button>
          <button type="button" onClick={() => void patch()} disabled={latency.busy || !postId || !auth.tokens} data-testid="patch">
            Змінити пост (PATCH likes +1)
          </button>
          <button type="button" onClick={() => setCalls([])} disabled={calls.length === 0}>
            Очистити історію
          </button>
        </div>
        {calls.length > 0 && (
          <table className="tbl" data-testid="cache-history">
            <thead>
              <tr>
                <th>#</th>
                <th>запит</th>
                <th>статус</th>
                <th>X-Cache</th>
                <th>мс</th>
                <th style={{ width: '35%' }}></th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c, i) => {
                const cache = c.headers['x-cache'];
                const maxMs = Math.max(...calls.map((x) => x.durationMs), 1);
                return (
                  <tr key={i}>
                    <td className="mono">{i + 1}</td>
                    <td className="mono">
                      {c.request.method} {c.request.path.replace(postId, ':id')}
                    </td>
                    <td className="mono">{c.status}</td>
                    <td>
                      {cache ? (
                        <span className={`badge ${cache.toLowerCase()}`} data-testid="x-cache">
                          {cache}
                        </span>
                      ) : (
                        <span className="muted small">{c.request.method === 'PATCH' ? 'DEL post:stats:id' : 'нема'}</span>
                      )}
                    </td>
                    <td className="mono">{c.durationMs}</td>
                    <td>
                      <div className="timeline-bar">
                        <span
                          className={cache === 'HIT' ? 'work' : 'wait'}
                          style={{ left: 0, width: `${(c.durationMs / maxMs) * 100}%`, background: cache === 'HIT' ? 'var(--ok)' : undefined }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Panel exchange={latency.exchange} busy={latency.busy} />
      </Card>
    </>
  );
}
