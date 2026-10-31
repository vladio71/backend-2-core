// AI: модерація поста через LLM (структурований вихід, zod, retry, 502 на сміття) і пошук схожих постів через pgvector.
import { useEffect, useState } from 'react';
import { apiCall, errorCode } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, NeedAuth, PageTitle } from '../components/common';
import { PanelFooter, Topic } from '../components/TopicParts';

const PROMPT = `Ти модератор технічного блогу для розробників.
Оціни пост і вирішиш: approve (публікувати) або reject (відхилити).
Відхиляй: спам, рекламу без змісту, образи, нетехнічний контент, порожні або беззмістовні пости.
Схвалюй: усе, що стосується програмування, інструментів, досвіду розробки, навіть якщо написано просто.
Відповідай ТІЛЬКИ JSON без markdown такої форми:
{"action": "approve" | "reject", "reason": "одне коротке речення українською"}`;

const SCHEMA = `const moderationDecisionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().min(1).max(500),
});`;

interface PostRow {
  id: string;
  title: string;
  body: string;
}

interface Moderation {
  postId: string;
  action: 'approve' | 'reject';
  reason: string;
  attempts: number;
}

interface SimilarRow {
  id: string;
  title: string;
  distance: number;
}

export function AiPage() {
  return (
    <>
      <PageTitle title="AI: LLM і вектори" sub="Структурований вихід LLM через zod і пошук за змістом через pgvector" />

      <h2>Модерація: структурований вихід</h2>
      <Topic
        what={
          <>
            Структурований вихід це коли від LLM просять не прозу, а JSON строго заданої форми, щоб код міг на нього спиратись. Тут форма така:{' '}
            <code>{'{ action: "approve" | "reject", reason: string }'}</code>.
          </>
        }
        when={
          <>
            Потрібен, коли відповідь моделі йде далі в код: у базу, в if, у чергу. Не потрібен, коли відповідь читає людина (чат): там вільний текст нормальний.
            Перевіряти форму треба завжди, навіть у JSON mode. Він гарантує валідний JSON, але не нашу схему: модель може відповісти <code>{'{"action": "yes"}'}</code>.
          </>
        }
        how={
          <>
            Відповідь LLM це рядок. Сервіс парсить його і перевіряє схемою zod. Чому zod: схема водночас і тип TypeScript, і перевірка, одне джерело правди, а{' '}
            <code>safeParse</code> не кидає виняток. Не пройшло: одна повторна спроба з суворішим нагадуванням у system prompt. Знову сміття: 502 LLM_BAD_OUTPUT, а
            пост лишається без змін. Провайдер це порт з двома адаптерами: справжній OpenAI, коли є OPENAI_API_KEY, інакше детермінований фейк (слова spam, casino,
            buy now дають reject). Тому локально й у тестах мережа не потрібна.
          </>
        }
        extra={<pre className="code">{SCHEMA}</pre>}
      />
      <ModerationCard />

      <h2>Схожі пости: pgvector</h2>
      <Topic
        what={
          <>
            Ембединг це масив з 384 чисел, яким модель описує зміст тексту: близькі за змістом тексти дають близькі масиви. Це координати точки в 384-вимірному
            просторі. Оператор <code>&lt;-&gt;</code> у pgvector рахує евклідову відстань між двома точками: 0 це майже той самий текст, чим менше число, тим схожіше.
          </>
        }
        when={
          <>
            Пошук за змістом варто робити, коли люди пишуть не тими словами, що в тексті: «схожі статті», пошук дублікатів, пошук у документації. Не потрібен для
            точного пошуку: слово, id, фільтр. Там вистачає ILIKE, full-text або звичайного індексу. На 50 постах Postgres просто порівнює з усіма; на тисячах і
            більше додають індекс HNSW, який шукає приблизно, але швидко. Ціна: ембединг рахується при кожному записі поста.
          </>
        }
        how={
          <>
            Колонка <code>posts.embedding</code> типу vector(384). Пошук це <code>ORDER BY embedding &lt;-&gt; $1::vector LIMIT 5</code>. Чесно про фейк: без
            OPENAI_API_KEY вектор рахується з хешів слів, тож «схожі» означає «мають спільні слова», а не «близькі за змістом». Справжню семантику дає лише
            справжня модель. Без розширення pgvector сервіс відповідає 422 PGVECTOR_UNAVAILABLE.
          </>
        }
      />
      <SimilarCard />
    </>
  );
}

function ModerationCard() {
  const auth = useAuth();
  const moderation = useLatency();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [postId, setPostId] = useState('');
  const [decision, setDecision] = useState<Moderation | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    void apiCall('GET', '/posts', { query: { pageSize: 30 }, auth: false }).then((res) => {
      if (!res.ok) return;
      const items = (res.body as { items: PostRow[] }).items;
      setPosts(items);
      setPostId((current) => current || items[0]?.id || '');
    });
  }, []);

  async function moderate(id: string) {
    setDecision(null);
    setFailure(null);
    const res = await moderation.track(apiCall('POST', `/posts/${id}/moderate`));
    if (res.ok) {
      setDecision(res.body as Moderation);
    } else if (res.status === 502 && errorCode(res) === 'LLM_BAD_OUTPUT') {
      setFailure(
        '502 LLM_BAD_OUTPUT: модель двічі повернула відповідь, яка не пройшла схему. Сервіс не став вгадувати і нічого не записав у пост. У тілі відповіді нижче, у details.raw, видно, що саме прийшло.',
      );
    } else if (res.status === 502) {
      setFailure('502: LLM-провайдер недоступний або відповів помилкою. Якщо задано OPENAI_API_KEY, перевір ключ і мережу; без ключа працює фейк і такої помилки не буде.');
    }
  }

  // temporary: пост-сміття після демо видаляється, щоб не засмічувати список (інакше він стане першим у вибірці).
  async function createAndModerate(title: string, body: string, tags: string[], temporary = false) {
    const res = await moderation.track(apiCall('POST', '/posts', { body: { title, body, tags } }));
    if (!res.ok) return;
    const created = res.body as PostRow;
    if (!temporary) {
      setPosts((prev) => [created, ...prev]);
      setPostId(created.id);
    }
    await moderate(created.id);
    if (temporary) await apiCall('DELETE', `/posts/${created.id}`);
  }

  const selected = posts.find((p) => p.id === postId);

  return (
    <Card title="POST /posts/:id/moderate">
      <div className="prose">
        <p>
          Дивись на action, reason і attempts: 1 означає, що відповідь пройшла схему з першого разу, 2 що довелось перепитати. Три кнопки показують три випадки:
          звичайний пост (approve), спам (reject) і відповідь-сміття (502). Сміття працює тільки з фейком: у тексті стоїть маркер, на який він реагує. Тестові пости після демо видаляються.
        </p>
      </div>
      <NeedAuth />
      <div className="row">
        <label>
          пост
          <select value={postId} onChange={(e) => setPostId(e.target.value)} data-testid="post-select" style={{ maxWidth: 420 }}>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primary" onClick={() => void moderate(postId)} disabled={!auth.tokens || moderation.busy || !postId} data-testid="moderate">
          POST /posts/:id/moderate
        </button>
      </div>
      <div className="row">
        <button
          type="button"
          onClick={() => void createAndModerate('BUY NOW casino bonus', 'spam spam spam, buy now, best casino, click here', ['spam'], true)}
          disabled={!auth.tokens || moderation.busy}
          data-testid="spam"
        >
          Спам-пост і модерація
        </button>
        <button
          type="button"
          onClick={() => void createAndModerate('Тест відповіді-сміття', 'Звичайний технічний пост про Postgres і пул з’єднань. [[garbage]]', ['test'], true)}
          disabled={!auth.tokens || moderation.busy}
          data-testid="garbage"
        >
          Пост, на який фейк відповість сміттям
        </button>
      </div>
      {selected && (
        <div className="muted small" style={{ marginBottom: 8 }}>
          Текст: {selected.body.slice(0, 160)}
        </div>
      )}
      {failure && (
        <div className="note err" data-testid="moderation-failure">
          {failure}
        </div>
      )}
      {decision && (
        <div className="cols-3" style={{ marginBottom: 12 }} data-testid="decision">
          <div className="col">
            <h3>action</h3>
            <div className="big" style={{ color: decision.action === 'approve' ? 'var(--ok)' : 'var(--err)' }}>
              {decision.action}
            </div>
          </div>
          <div className="col">
            <h3>reason</h3>
            <div>{decision.reason}</div>
          </div>
          <div className="col">
            <h3>attempts</h3>
            <div className="big">{decision.attempts}</div>
            <div className="muted small">1 = з першого разу валідний JSON</div>
          </div>
        </div>
      )}
      <details style={{ marginBottom: 12 }}>
        <summary>system prompt (з llm.provider.ts)</summary>
        <pre className="code">{PROMPT}</pre>
        <div className="muted small">Користувацьке повідомлення: "Заголовок: ...\n\nТекст: ..." (обрізано до 4000 символів).</div>
      </details>
      <Panel exchange={moderation.exchange} busy={moderation.busy} />
      <PanelFooter
        paths={['src/modules/ai/moderation.service.ts (цикл з двох спроб, parse)', 'src/modules/ai/llm.provider.ts (zod-схема, prompt)', 'src/modules/ai/fake-llm.provider.ts (правила і маркер [[garbage]])']}
        tries={[
          'Натисни кнопку зі сміттям: бачиш 502 і в details.raw текст "Sure! Here is my answer", який схема відкинула. У логах API дві строки "невалідна відповідь".',
          'У fake-llm.provider.ts додай слово до списку spam і створи пост з ним: фейк почне його відхиляти.',
        ]}
      />
    </Card>
  );
}

function SimilarCard() {
  const similar = useLatency();
  const [q, setQ] = useState('postgres pool');
  const [rows, setRows] = useState<SimilarRow[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  async function search() {
    setProblem(null);
    setRows([]);
    const res = await similar.track(apiCall('GET', '/posts/similar', { query: { q }, auth: false }));
    if (res.ok) {
      setRows(res.body as SimilarRow[]);
    } else if (res.status === 422 && errorCode(res) === 'PGVECTOR_UNAVAILABLE') {
      setProblem(
        'Пошук вимкнено: у цій базі немає розширення pgvector, тому колонки posts.embedding немає. Це чесна відповідь, а не баг. Щоб побачити результат, запусти бекенд через docker compose (там образ pgvector/pgvector:pg16) або встанови розширення в свій Postgres і накоти міграції знову.',
      );
    } else if (res.status === 0) {
      setProblem('API недоступний: перевір адресу в шапці.');
    }
  }

  return (
    <Card title="GET /posts/similar?q=">
      <div className="prose">
        <p>
          Запит перетворюється на вектор і порівнюється з векторами постів. Менша distance означає схожіше. Добре, коли перші пости справді про те, що ти написав,
          а distance росте вниз по списку. Пробуй і слова, яких немає в постах: з фейком побачиш, що без спільних слів відстані майже однакові.
        </p>
      </div>
      <div className="row">
        <label>
          q
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="similar-q" />
        </label>
        <button type="button" className="primary" onClick={() => void search()} disabled={similar.busy} data-testid="similar">
          GET /posts/similar?q=
        </button>
      </div>
      {problem && (
        <div className="note err" data-testid="similar-problem">
          <b>422 PGVECTOR_UNAVAILABLE.</b> {problem}
        </div>
      )}
      {rows.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>title</th>
              <th>distance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td className="mono">{r.distance.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Panel exchange={similar.exchange} busy={similar.busy} />
      <PanelFooter
        paths={['src/modules/ai/post-embeddings.service.ts (similar, indexPost)', 'src/modules/ai/embedding.provider.ts (FakeEmbeddingProvider, 384 числа)', 'src/migrations/1700000000002-AddPostEmbedding.ts']}
        tries={[
          'Шукай "postgres pool", потім "redis cache": набір постів у топі має змінитись.',
          'Створи пост про React (POST /posts у /reference) і повтори пошук "react": новий пост має опинитись на початку списку.',
        ]}
      />
    </Card>
  );
}
