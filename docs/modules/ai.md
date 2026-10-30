# ai: структурований вихід LLM і вектори

## Що це

### Модерація: `POST /posts/:id/moderate`
LLM отримує system prompt і текст поста, повертає JSON `{ action: "approve" | "reject", reason }`. Відповідь парситься і перевіряється zod-схемою. Невалідна відповідь: одна повторна спроба з суворішим нагадуванням, потім `502 LLM_BAD_OUTPUT`. Рішення пишеться у `posts.moderation_action` і `moderation_reason`.

Prompt повністю (`llm.provider.ts`):

```
Ти модератор технічного блогу для розробників.
Оціни пост і вирішиш: approve (публікувати) або reject (відхилити).
Відхиляй: спам, рекламу без змісту, образи, нетехнічний контент, порожні або беззмістовні пости.
Схвалюй: усе, що стосується програмування, інструментів, досвіду розробки, навіть якщо написано просто.
Відповідай ТІЛЬКИ JSON без markdown такої форми:
{"action": "approve" | "reject", "reason": "одне коротке речення українською"}
```

Користувацьке повідомлення: `Заголовок: ...\n\nТекст:\n...` (обрізано до 4000 символів).

Провайдер це порт з двома адаптерами: `OpenAiLlmProvider` (HTTP `chat/completions`, `response_format: json_object`, `temperature: 0`) коли є `OPENAI_API_KEY`, інакше `FakeLlmProvider` (детермінований: слова "spam", "casino", "buy now" дають reject; маркер `[[garbage]]` у тексті змушує повернути сміття для тесту retry).

### Вектори: `GET /posts/similar?q=`
Колонка `posts.embedding vector(384)` (pgvector). При створенні або зміні поста `PostEmbeddingsService.indexPost()` рахує вектор і пише `UPDATE posts SET embedding = $1::vector`. Пошук: `ORDER BY embedding <-> $1::vector LIMIT 5` (`<->` = евклідова відстань, менше = схожіше). `FakeEmbeddingProvider` будує вектор із sha256 слів (спільні слова = ближчі вектори), `OpenAiEmbeddingProvider` викликає `/embeddings` з `dimensions: 384`. Без розширення сервіс каже `422 PGVECTOR_UNAVAILABLE`.

## Чому так
LLM повертає текст, а не об'єкт. "JSON mode" гарантує валідний JSON, але не нашу схему: модель може повернути `{"action": "yes"}`. Zod перетворює "якийсь JSON" на типізований об'єкт або помилку. Коли модель повернула сміття: один retry (часто допомагає), далі 502, бо це помилка зовнішнього сервісу, а не клієнта. Порт з фейком: тести і локальний запуск не ходять у мережу і не коштують грошей. Для великих таблиць векторам потрібен індекс HNSW: `CREATE INDEX ON posts USING hnsw (embedding vector_l2_ops)`.

## Де в коді
- `src/modules/ai/llm.provider.ts`: порт, zod-схема, prompt.
- `src/modules/ai/moderation.service.ts`: parse + retry.
- `src/modules/ai/fake-llm.provider.ts`, `openai-llm.provider.ts`.
- `src/modules/ai/embedding.provider.ts`, `openai-embedding.provider.ts`, `post-embeddings.service.ts`.
- `src/migrations/1700000000002-AddPostEmbedding.ts`.
- `src/modules/ai/moderation.service.spec.ts`, `test/e2e/posts.e2e-spec.ts` (блок `ai`; similar-тест вмикається `PGVECTOR=1`).

## Спробуй сам
1. Додай у схему поле `confidence: number 0..1` і відхиляй рішення з `confidence < 0.5` як "потребує людини" (статус `review`).
2. Запусти `docker compose up`, в якому pgvector є, і виконай `GET /posts/similar?q=postgres pool`. Потім створи пост про React і перевір, що він у кінці списку.

Попередня тема: [github](github.md) | Наступна тема: [деплой](../deploy.md)
