// AI: модерація поста через LLM (структурований вихід, zod, retry) і пошук схожих постів через pgvector.
import { useEffect, useState } from 'react';
import { apiCall, errorCode } from '../api/client';
import { useAuth } from '../api/auth';
import { useLatency } from '../hooks/useLatency';
import { Panel } from '../components/Panel';
import { Card, Explain, NeedAuth, PageTitle, WhereInCode } from '../components/common';

const PROMPT = `Ти модератор технічного блогу для розробників.
Оціни пост і вирішиш: approve (публікувати) або reject (відхилити).
Відхиляй: спам, рекламу без змісту, образи, нетехнічний контент, порожні або беззмістовні пости.
Схвалюй: усе, що стосується програмування, інструментів, досвіду розробки, навіть якщо написано просто.
Відповідай ТІЛЬКИ JSON без markdown такої форми:
{"action": "approve" | "reject", "reason": "одне коротке речення українською"}`;

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
  const auth = useAuth();
  const moderation = useLatency();
  const similar = useLatency();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [postId, setPostId] = useState('');
  const [decision, setDecision] = useState<Moderation | null>(null);
  const [q, setQ] = useState('postgres pool');
  const [rows, setRows] = useState<SimilarRow[]>([]);
  const [similarProblem, setSimilarProblem] = useState<string | null>(null);

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
    const res = await moderation.track(apiCall('POST', `/posts/${id}/moderate`));
    if (res.ok) setDecision(res.body as Moderation);
  }

  async function createSpamAndModerate() {
    const res = await moderation.track(
      apiCall('POST', '/posts', { body: { title: 'BUY NOW casino bonus', body: 'spam spam spam, buy now, best casino, click here', tags: ['spam'] } }),
    );
    if (!res.ok) return;
    const created = res.body as PostRow;
    setPosts((prev) => [created, ...prev]);
    setPostId(created.id);
    await moderate(created.id);
  }

  async function search() {
    setSimilarProblem(null);
    setRows([]);
    const res = await similar.track(apiCall('GET', '/posts/similar', { query: { q }, auth: false }));
    if (res.ok) {
      setRows(res.body as SimilarRow[]);
    } else if (res.status === 422 && errorCode(res) === 'PGVECTOR_UNAVAILABLE') {
      setSimilarProblem(
        '422 PGVECTOR_UNAVAILABLE: у цій базі немає розширення pgvector, тому колонки posts.embedding немає і пошук вимкнено. Запусти бекенд через docker compose (образ pgvector/pgvector:pg16) або встанови розширення і накоти міграції знову.',
      );
    }
  }

  const selected = posts.find((p) => p.id === postId);

  return (
    <>
      <PageTitle title="AI: LLM і вектори" sub="Структурований вихід LLM через zod і векторний пошук через pgvector" />
      <Explain>
        <p>
          <b>Як це працює на бекенді.</b> Модерація відправляє LLM system prompt і текст поста, отримує текст і парсить його zod-схемою{' '}
          <code>{'{ action: "approve" | "reject", reason: string }'}</code>.
        </p>
        <p>
          "JSON mode" гарантує валідний JSON, але не нашу схему: модель може повернути <code>{'{"action": "yes"}'}</code>. Невалідна відповідь: одна повторна
          спроба з суворішим нагадуванням, потім <code>502 LLM_BAD_OUTPUT</code>. Рішення пишеться у колонку moderation_action поста.
        </p>
        <p>
          Провайдер це порт з двома адаптерами: справжній OpenAI, коли є OPENAI_API_KEY, інакше фейковий (детермінований: слова "spam", "casino", "buy now"
          дають reject). Тести і локальний запуск не ходять у мережу.
        </p>
        <p>
          <b>Вектори.</b> Колонка embedding типу vector(384). При створенні або зміні поста рахується вектор; пошук це{' '}
          <code>ORDER BY embedding &lt;-&gt; $1::vector LIMIT 5</code> (евклідова відстань, менше = схожіше). Без розширення pgvector сервіс каже{' '}
          <code>422 PGVECTOR_UNAVAILABLE</code>.
        </p>
        <WhereInCode paths={['src/modules/ai/moderation.service.ts', 'llm.provider.ts, openai-llm.provider.ts, fake-llm.provider.ts', 'post-embeddings.service.ts']} />
      </Explain>

      <Card title="Модерація">
        <div className="prose">
          <p>
            Модель читає пост і повертає рішення. Дивись на три поля: action (approve або reject), reason (чому) і attempts: 1 означає, що відповідь пройшла
            zod-схему з першого разу, 2 що довелось перепитати. Без OPENAI_API_KEY працює фейковий провайдер: звичайний пост дає approve, а кнопка зі спамом
            створює пост зі словом "casino" і має дати reject.
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
          <button
            type="button"
            className="primary"
            onClick={() => void moderate(postId)}
            disabled={!auth.tokens || moderation.busy || !postId}
            data-testid="moderate"
          >
            POST /posts/:id/moderate
          </button>
          <button type="button" onClick={() => void createSpamAndModerate()} disabled={!auth.tokens || moderation.busy}>
            Створити спам-пост і модерувати
          </button>
        </div>
        {selected && (
          <div className="muted small" style={{ marginBottom: 8 }}>
            Текст: {selected.body.slice(0, 160)}
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
        <h3>system prompt (з llm.provider.ts)</h3>
        <pre className="code">
          {PROMPT}
        </pre>
        <div className="muted small">Користувацьке повідомлення: "Заголовок: ...\n\nТекст: ..." (обрізано до 4000 символів).</div>
        <Panel exchange={moderation.exchange} busy={moderation.busy} />
      </Card>

      <Card title="Схожі пости (pgvector)">
        <div className="prose">
          <p>
            Пошук за змістом, а не за словами: запит перетворюється на вектор і порівнюється з векторами постів. У результаті distance менше означає схожіше;
            добре, коли перший пост справді про те, що ти написав. 422 PGVECTOR_UNAVAILABLE означає, що в Postgres немає розширення, і це чесна відповідь, а не
            баг.
          </p>
        </div>
        <div className="note">Потрібне розширення pgvector у Postgres (образ pgvector/pgvector:pg16 у docker compose). Без нього API чесно відповідає 422.</div>
        <div className="row">
          <label>
            q
            <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="similar-q" />
          </label>
          <button type="button" className="primary" onClick={() => void search()} disabled={similar.busy} data-testid="similar">
            GET /posts/similar?q=
          </button>
        </div>
        {similarProblem && (
          <div className="note err" data-testid="similar-problem">
            {similarProblem}
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
      </Card>
    </>
  );
}
