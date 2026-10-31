// Кеш: GET /posts/:id/stats кілька разів (MISS, потім HIT), PATCH інвалідовує, знову MISS.
// Друга панель показує межу цього кешу: числа автора в ключі поста оновлюються тільки по TTL.
import { useEffect, useState } from 'react';
import { apiCall, ApiExchange, errorMessage } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, NeedAuth, PageTitle } from '../components/common';
import { Concept, PanelNotes } from '../components/topic';

interface PostRow {
  id: string;
  title: string;
  likes: number;
  authorId: string;
}

interface StatsBody {
  authorPosts?: number;
}

interface StaleStep {
  label: string;
  exchange: ApiExchange;
  note: string;
}

const DEMO_TITLE = 'Демо кешу: статистика поста';

// Знаходить демо-пост автора або створює його один раз. Спільний проміс не дає StrictMode створити два пости.
const pending = new Map<string, Promise<PostRow | undefined>>();

function ensureDemoPost(userId: string): Promise<PostRow | undefined> {
  const running = pending.get(userId);
  if (running) return running;
  const job = (async (): Promise<PostRow | undefined> => {
    const found = await apiCall('GET', '/posts', { query: { authorId: userId, q: DEMO_TITLE, pageSize: 1 }, auth: false });
    const existing = found.ok ? (found.body as { items: PostRow[] }).items[0] : undefined;
    if (existing) {
      // Порожній PATCH видаляє ключ кешу: перший GET на цій сторінці завжди MISS.
      await apiCall('PATCH', `/posts/${existing.id}`, { body: { likes: existing.likes } });
      return existing;
    }
    const created = await apiCall('POST', '/posts', {
      body: { title: DEMO_TITLE, body: 'Пост для демо кешу. Живе в списку автора, щоб не створювати новий щоразу.', tags: ['demo'] },
    });
    return created.ok ? (created.body as PostRow) : undefined;
  })().finally(() => pending.delete(userId));
  pending.set(userId, job);
  return job;
}

export function CachePage() {
  const auth = useAuth();
  const latency = useLatency(30);
  const staleLatency = useLatency();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [postId, setPostId] = useState('');
  const [calls, setCalls] = useState<ApiExchange[]>([]);
  const [staleSteps, setStaleSteps] = useState<StaleStep[]>([]);
  const [staleVerdict, setStaleVerdict] = useState<string | null>(null);
  const [staleRunning, setStaleRunning] = useState(false);

  useEffect(() => {
    // Залогінений: працюємо зі своїм демо-постом (знаходимо або створюємо один раз), щоб PATCH був дозволений, а кеш починався з холодного.
    // Не залогінений: будь-які пости з сіду, GET /stats працює без токена.
    let cancelled = false;
    async function prepare() {
      if (!auth.user) {
        const res = await apiCall('GET', '/posts', { query: { pageSize: 20 }, auth: false });
        if (cancelled || !res.ok) return;
        const items = (res.body as { items: PostRow[] }).items;
        setPosts(items);
        setPostId(items[0]?.id ?? '');
        return;
      }
      const demo = await ensureDemoPost(auth.user.id);
      if (cancelled || !demo) return;
      setPosts([demo]);
      setPostId(demo.id);
      setCalls([]);
    }
    void prepare();
    return () => {
      cancelled = true;
    };
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

  // Сценарій межі кешу: холодний кеш, MISS, новий пост того ж автора, HIT зі старим числом, порівняння з базою, прибирання.
  async function staleScenario() {
    const post = posts.find((p) => p.id === postId);
    if (!post || !auth.user) return;
    setStaleRunning(true);
    setStaleSteps([]);
    setStaleVerdict(null);
    const steps: StaleStep[] = [];
    const add = (label: string, exchange: ApiExchange, note: string) => {
      steps.push({ label, exchange, note });
      setStaleSteps([...steps]);
    };
    let extraId: string | null = null;
    try {
      add('PATCH поста (скидає ключ)', await staleLatency.track(apiCall('PATCH', `/posts/${post.id}`, { body: { likes: post.likes } })), 'ключ post:stats видалено');
      const first = await staleLatency.track(apiCall('GET', `/posts/${post.id}/stats`, { auth: false }));
      const before = (first.body as StatsBody).authorPosts;
      add('GET /stats', first, `MISS, authorPosts = ${before}`);
      const created = await staleLatency.track(
        apiCall('POST', '/posts', { body: { title: 'Демо кешу: ще один пост автора', body: 'Тимчасовий пост, буде видалений.', tags: ['demo'] } }),
      );
      if (!created.ok) {
        setStaleVerdict(`Не вдалося створити другий пост: ${errorMessage(created)}.`);
        return;
      }
      extraId = (created.body as { id: string }).id;
      add('POST /posts (інший пост цього автора)', created, 'ключ post:stats цього поста не чіпали');
      const second = await staleLatency.track(apiCall('GET', `/posts/${post.id}/stats`, { auth: false }));
      const cached = (second.body as StatsBody).authorPosts;
      add('GET /stats', second, `${second.headers['x-cache'] ?? ''}, authorPosts = ${cached}`);
      const truth = await staleLatency.track(apiCall('GET', '/posts', { query: { authorId: auth.user.id, pageSize: 1 }, auth: false }));
      const real = truth.ok ? (truth.body as { total: number }).total : null;
      add('GET /posts?authorId=я (правда з бази)', truth, `total = ${real}`);
      setStaleVerdict(
        `Кеш каже authorPosts = ${cached}, а в базі в цей момент ${real}. Кеш не збрехав навмисно: він просто не знає про пост, який не був його власним. Число стане правильним, коли мине TTL у 60 секунд.`,
      );
    } finally {
      if (extraId) await apiCall('DELETE', `/posts/${extraId}`);
      setStaleRunning(false);
    }
  }

  return (
    <>
      <PageTitle title="Кеш" sub="GET /posts/:id/stats у Redis на 60 с, інвалідація при записі" />
      <Concept
        what={
          <p>
            Кеш це копія відповіді, яку зберегли поруч (тут у Redis), щоб не рахувати її знову. Дорогий розрахунок робимо один раз, а наступні запити беруть готове за
            одиниці мілісекунд.
          </p>
        }
        when={
          <>
            <p>
              Кеш допомагає, коли відповідь дорога в обчисленні, часто читається і рідко змінюється: статистика, каталог, профіль. Не допомагає, коли відповідь
              унікальна для кожного запиту (пошук з довільним q) і коли дані мають бути точними до секунди (баланс, залишок товару). Не допомагає і тоді, коли запит
              і так швидкий: ти додаєш Redis, ще одну точку відмови і проблему застарілих даних.
            </p>
            <p>Правило: спершу виміряй, потім кешуй.</p>
          </>
        }
        how={
          <>
            <p>
              GET /posts/:id/stats рахує агрегат по кількох таблицях (у коді ще pg_sleep на 0.2 с, щоб це було видно). Результат лежить у Redis під ключем
              post:stats:&lt;id&gt;. Заголовок X-Cache каже, звідки відповідь. MISS: ключа не було, порахували в базі й поклали в Redis. HIT: взяли готове з
              Redis.
            </p>
            <p>Є два способи тримати кеш свіжим, і вони доповнюють один одного:</p>
            <table className="tbl">
              <thead>
                <tr>
                  <th></th>
                  <th>TTL (60 с)</th>
                  <th>Інвалідація (видалити ключ при записі)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Свіжість</td>
                  <td>до 60 с застарілі</td>
                  <td>свіжі одразу після запису</td>
                </tr>
                <tr>
                  <td>Що треба пам'ятати</td>
                  <td>нічого</td>
                  <td>кожне місце, де змінюється пост</td>
                </tr>
                <tr>
                  <td>Якщо забули</td>
                  <td>дані оновляться самі за 60 с</td>
                  <td>застарілі назавжди</td>
                </tr>
              </tbody>
            </table>
            <p>
              Тут працюють обидва: ключ живе 60 секунд, а PATCH, DELETE і publish цього поста видаляють його одразу. TTL це страховка на випадок, коли хтось
              забув інвалідувати.
            </p>
            <p>
              <b>Межа, про яку треба знати.</b> У статистиці поста є числа автора: authorPosts і authorTotalLikes. Інвалідація видаляє ключ лише цього поста. Тому
              новий пост того самого автора не чіпає кеш його інших постів, і їхні числа автора оновляться тільки по TTL, до 60 секунд пізніше. Так бекенд працює
              зараз. Виправлення було б або інвалідувати всі пости автора, або не класти авторські числа в цей ключ. Друга панель показує це на живому прикладі.
            </p>
          </>
        }
      />

      <Card title="HIT, MISS і інвалідація" testId="card-cache">
        <div className="prose">
          <p>
            Панель сама бере (або створює один раз) твій демо-пост. Натисни GET двічі: перший раз MISS і довго (рахується в базі, плюс 200 мс затримки), другий HIT і
            одиниці мілісекунд. Потім PATCH видаляє ключ, і наступний GET знову MISS, але вже з новим likes. Погано було б, якби після PATCH прийшов HIT зі старими
            даними.
          </p>
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
        <PanelNotes
          where={['src/modules/posts/post-stats-cache.service.ts (get, invalidate, TTL_SECONDS)', 'src/modules/posts/stats.controller.ts (заголовок X-Cache)']}
          tryItems={[
            <>
              Натисни GET, PATCH, GET: виходить MISS, видалення ключа, MISS. Різниця в мс між MISS і HIT це справжня ціна обчислення без кешу.
            </>,
            <>
              Після GET виконай <code>redis-cli ttl post:stats:&lt;id&gt;</code> з id поста: скільки секунд лишилось у ключа (не більше 60).
            </>,
          ]}
        />
      </Card>

      <Card title="Межа кешу: статистика автора" testId="card-stale">
        <div className="prose">
          <p>
            Сценарій сам скидає кеш твого демо-поста, читає статистику (MISS), створює інший пост того самого автора, читає статистику вдруге (HIT) і порівнює
            authorPosts із базою. Потім видаляє тимчасовий пост.
          </p>
        </div>
        <NeedAuth>Сценарій створює пост і змінює демо-пост, тому потрібен токен.</NeedAuth>
        <div className="row">
          <button type="button" className="primary" onClick={() => void staleScenario()} disabled={staleRunning || !auth.tokens || !postId} data-testid="author-stale">
            {staleRunning ? 'виконується...' : 'Показати застарілі числа автора'}
          </button>
        </div>
        {staleSteps.length > 0 && (
          <div className="steps" data-testid="stale-steps">
            {staleSteps.map((step, i) => (
              <div className="step" key={i}>
                <span className="step-num">{i + 1}</span>
                <span>
                  <span className="mono">{step.label}</span> <span className="muted small">{step.note}</span>
                </span>
                <span className="muted small mono">
                  {step.exchange.status} {step.exchange.durationMs} мс
                </span>
              </div>
            ))}
          </div>
        )}
        {staleVerdict && (
          <div className="note" data-testid="stale-verdict">
            {staleVerdict}
          </div>
        )}
        <Panel exchange={staleLatency.exchange} busy={staleLatency.busy} />
        <PanelNotes
          where={['src/modules/posts/post-stats-cache.service.ts (compute: author_posts, author_total_likes)', 'src/modules/posts/posts.service.ts (create не інвалідує нічого)']}
          tryItems={[
            <>Натисни кнопку двічі: різниця між кешем і базою щоразу рівно на один пост.</>,
            <>
              Додай у <code>PostsService.create</code> інвалідацію кеша інших постів автора і повтори сценарій: розбіжність зникне, але за це заплатить кожен POST.
            </>,
          ]}
        />
      </Card>
    </>
  );
}
