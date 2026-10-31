// e2e: posts + queries + ratelimit + ai. Валідація, фільтри, дві пагінації, soft delete, транзакція, кеш, ліміт, модерація.
import { TestApp, TestUser, createTestApp, registerUser, bearer, sleep } from '../helpers/app';
import { PostsService } from '../../src/modules/posts/posts.service';

describe('posts (e2e)', () => {
  let t: TestApp;
  let author: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    author = await registerUser(t, 'author@test.local');
    other = await registerUser(t, 'other@test.local');
  });
  afterAll(async () => {
    await t.close();
  });

  async function createPost(user: TestUser, body: Record<string, unknown>): Promise<string> {
    const res = await t.http().post('/posts').set(bearer(user)).send(body).expect(201);
    return res.body.id;
  }

  // Для масового наповнення пишемо в БД напряму: POST /posts обмежений 10 запитами за 10 с (модуль ratelimit).
  async function insertPost(authorId: string, p: { title: string; body: string; tags: string[]; status: string; likes: number }): Promise<void> {
    await t.dataSource.query(`INSERT INTO posts (title, body, tags, status, likes, author_id) VALUES ($1, $2, $3, $4, $5, $6)`, [p.title, p.body, p.tags, p.status, p.likes, authorId]);
  }

  describe('валідація', () => {
    it('вкладене meta.seo валідується, "42" перетворюється у 42', async () => {
      const res = await t
        .http()
        .post('/posts')
        .set(bearer(author))
        .send({ title: 'Нормальний пост', body: 'текст', likes: '42', meta: { seo: { title: 'seo', description: 'd' } } })
        .expect(201);
      expect(res.body.likes).toBe(42);
      expect(res.body.meta.seo.title).toBe('seo');
    });

    it('невідоме поле (і вкладене теж) -> 400 з назвою поля', async () => {
      const top = await t.http().post('/posts').set(bearer(author)).send({ title: 'abc', body: 'x', hacker: 1 }).expect(400);
      expect(top.body.details).toContain('property hacker should not exist');
      const nested = await t.http().post('/posts').set(bearer(author)).send({ title: 'abc', body: 'x', meta: { seo: { title: 'ok', bad: 1 } } }).expect(400);
      expect(nested.body.details.join(' ')).toMatch(/bad should not exist/);
      const tooLong = await t.http().post('/posts').set(bearer(author)).send({ title: 'abc', body: 'x', meta: { seo: { title: 'x'.repeat(100) } } }).expect(400);
      expect(tooLong.body.details.join(' ')).toMatch(/title/);
    });
  });

  describe('список: фільтри і пагінація', () => {
    beforeAll(async () => {
      for (let i = 1; i <= 12; i++) {
        await insertPost(author.id, { title: `Пост ${String(i).padStart(2, '0')}`, body: i % 2 ? 'про postgres' : 'про redis', tags: i % 2 ? ['db', 'pg'] : ['cache'], status: i % 3 ? 'published' : 'draft', likes: i });
        await sleep(5); // щоб created_at відрізнявся
      }
    });

    it('offset: page/pageSize/total', async () => {
      const res = await t.http().get('/posts?page=2&pageSize=5&sort=likes&dir=asc').expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(12);
      expect(res.body.items).toHaveLength(5);
      expect(res.body.items[0].likes).toBeLessThanOrEqual(res.body.items[4].likes);
    });

    it('cursor: сторінки не перетинаються і покривають усе', async () => {
      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url: string = `/posts?mode=cursor&pageSize=5&sort=likes&dir=desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res: { body: { items: Array<{ id: string }>; nextCursor: string | null } } = await t.http().get(url).expect(200);
        for (const item of res.body.items) {
          expect(seen.has(item.id)).toBe(false);
          seen.add(item.id);
        }
        cursor = res.body.nextCursor;
        pages += 1;
      } while (cursor);
      const all = await t.http().get('/posts?pageSize=100').expect(200);
      expect(seen.size).toBe(all.body.total);
      expect(pages).toBeGreaterThan(1);
    });

    it('фільтри: q, tags any|all, status, authorId', async () => {
      const q = await t.http().get('/posts?q=redis&pageSize=100').expect(200);
      expect(q.body.items.every((p: { body: string }) => p.body.includes('redis'))).toBe(true);
      const any = await t.http().get('/posts?tags=pg,cache&pageSize=100').expect(200);
      expect(any.body.total).toBeGreaterThanOrEqual(12);
      const all = await t.http().get('/posts?tags=db,pg&tagsMode=all&pageSize=100').expect(200);
      expect(all.body.items.every((p: { tags: string[] }) => p.tags.includes('db') && p.tags.includes('pg'))).toBe(true);
      const drafts = await t.http().get('/posts?status=draft&pageSize=100').expect(200);
      expect(drafts.body.items.every((p: { status: string }) => p.status === 'draft')).toBe(true);
      const mine = await t.http().get(`/posts?authorId=${other.id}`).expect(200);
      expect(mine.body.total).toBe(0);
    });

    it('невалідний sort -> 400', async () => {
      await t.http().get('/posts?sort=password').expect(400);
    });
  });

  describe('cursor: однакова мілісекунда, різні мікросекунди', () => {
    const base = '2030-01-01 00:00:00.123';
    const ids: string[] = [];

    beforeAll(async () => {
      // Три поста з тією самою мілісекундою (.123), але різними мікросекундами. JS Date бачить для всіх .123.
      // Далека дата 2030, щоб вони стояли попереду всіх інших постів у DESC і не змішувались при ASC в кінці.
      for (const micros of ['100', '200', '300']) {
        const rows = await t.dataSource.query(
          `INSERT INTO posts (title, body, tags, status, likes, author_id, created_at) VALUES ($1, 'x', '{}', 'published', 0, $2, $3::timestamptz) RETURNING id`,
          [`micro ${micros}`, author.id, `${base}${micros}+00`],
        );
        ids.push(rows[0].id);
      }
    });

    async function paginate(dir: 'asc' | 'desc'): Promise<string[]> {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 200; guard++) {
        const url: string = `/posts?mode=cursor&pageSize=1&sort=createdAt&dir=${dir}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res: { body: { items: Array<{ id: string }>; nextCursor: string | null } } = await t.http().get(url).expect(200);
        seen.push(...res.body.items.map((i) => i.id));
        cursor = res.body.nextCursor;
        if (!cursor) break;
      }
      return seen;
    }

    it('DESC: без пропусків і дублікатів, порядок за мікросекундами', async () => {
      const seen = await paginate('desc');
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.slice(0, 3)).toEqual([ids[2], ids[1], ids[0]]);
      const total = await t.dataSource.query(`SELECT count(*)::int AS n FROM posts WHERE deleted_at IS NULL`);
      expect(seen).toHaveLength(total[0].n);
    });

    it('ASC: без пропусків і дублікатів, порядок за мікросекундами', async () => {
      const seen = await paginate('asc');
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.slice(-3)).toEqual([ids[0], ids[1], ids[2]]);
      const total = await t.dataSource.query(`SELECT count(*)::int AS n FROM posts WHERE deleted_at IS NULL`);
      expect(seen).toHaveLength(total[0].n);
    });

    it('курсор із правильною формою, але сміттям у v, або v не того типу -> 400 BAD_CURSOR (не 500)', async () => {
      const make = (payload: object) => Buffer.from(JSON.stringify(payload)).toString('base64url');
      const id = ids[0];
      for (const [sort, v] of [['createdAt', 'garbage'], ['createdAt', 12], ['likes', 'abc'], ['title', 5]] as const) {
        const res = await t.http().get(`/posts?mode=cursor&sort=${sort}&cursor=${make({ v, id })}`).expect(400);
        expect(res.body.code).toBe('BAD_CURSOR');
      }
      // Пошкоджений base64/JSON і не-uuid id теж 400.
      const broken = await t.http().get('/posts?mode=cursor&cursor=!!!').expect(400);
      expect(broken.body.code).toBe('BAD_CURSOR');
      await t.http().get(`/posts?mode=cursor&sort=likes&cursor=${make({ v: 1, id: 'zzz' })}`).expect(400);
    });
  });

  describe('soft delete і restore', () => {
    it('після DELETE пост зникає зі списку і GET, але повертається після restore', async () => {
      const id = await createPost(author, { title: 'Видалити мене', body: 'x' });
      await t.http().delete(`/posts/${id}`).set(bearer(other)).expect(403);
      await t.http().delete(`/posts/${id}`).set(bearer(author)).expect(204);
      await t.http().get(`/posts/${id}`).expect(404);
      const rows = await t.dataSource.query(`SELECT deleted_at FROM posts WHERE id = $1`, [id]);
      expect(rows[0].deleted_at).not.toBeNull();
      await t.http().post(`/posts/${id}/restore`).set(bearer(author)).expect(201);
      await t.http().get(`/posts/${id}`).expect(200);
    });
  });

  describe('транзакція publish', () => {
    it('успіх: статус published і рядок в activity', async () => {
      const id = await createPost(author, { title: 'Опублікуй мене', body: 'x' });
      const res = await t.http().post(`/posts/${id}/publish`).set(bearer(author)).expect(201);
      expect(res.body.status).toBe('published');
      const activity = await t.dataSource.query(`SELECT * FROM activity WHERE post_id = $1`, [id]);
      expect(activity).toHaveLength(1);
      await t.http().post(`/posts/${id}/publish`).set(bearer(author)).expect(409);
    });

    it('5 паралельних publish: один 201, решта 409, один рядок у activity', async () => {
      const id = await createPost(author, { title: 'Гонка publish', body: 'x' });
      // Робимо вікно між "прочитав статус" і "записав" широким (80 мс), щоб гонка відтворювалась стабільно.
      const service = t.app.get(PostsService);
      const original = service.getById.bind(service);
      const spy = jest.spyOn(service, 'getById').mockImplementation(async (...args) => {
        const post = await original(...args);
        await sleep(80);
        return post;
      });
      const statuses = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const res = await fetch(`${t.baseUrl}/posts/${id}/publish`, { method: 'POST', headers: bearer(author) });
          return res.status;
        }),
      );
      spy.mockRestore();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(4);
      const activity = await t.dataSource.query(`SELECT * FROM activity WHERE post_id = $1`, [id]);
      expect(activity).toHaveLength(1);
    });

    it('падіння другого запису відкочує перший: статус лишається draft', async () => {
      const id = await createPost(author, { title: 'Не опублікуюсь', body: 'x' });
      const service = t.app.get(PostsService);
      await expect(service.publish({ sub: author.id, role: 'user', email: author.email }, id, true)).rejects.toThrow('Імітація');
      const post = await t.http().get(`/posts/${id}`).expect(200);
      expect(post.body.status).toBe('draft');
      const activity = await t.dataSource.query(`SELECT * FROM activity WHERE post_id = $1`, [id]);
      expect(activity).toHaveLength(0);
    });
  });

  describe('кеш статистики', () => {
    it('MISS, потім HIT, після PATCH знову MISS', async () => {
      const id = await createPost(author, { title: 'Статистика', body: 'x', likes: 5 });
      const miss = await t.http().get(`/posts/${id}/stats`).expect(200);
      expect(miss.headers['x-cache']).toBe('MISS');
      const hit = await t.http().get(`/posts/${id}/stats`).expect(200);
      expect(hit.headers['x-cache']).toBe('HIT');
      expect(hit.body.computedAt).toBe(miss.body.computedAt);
      await t.http().patch(`/posts/${id}`).set(bearer(author)).send({ likes: 6 }).expect(200);
      const again = await t.http().get(`/posts/${id}/stats`).expect(200);
      expect(again.headers['x-cache']).toBe('MISS');
      expect(again.body.likes).toBe(6);
    });
  });

  describe('rate limit (token bucket)', () => {
    it('11-й POST /posts за 10 с -> 429 з Retry-After і X-RateLimit-*', async () => {
      const fresh = await registerUser(t, 'limited@test.local');
      let last: { status: number; headers: Record<string, string>; body: { code?: string } } | null = null;
      for (let i = 0; i < 11; i++) {
        last = await t.http().post('/posts').set(bearer(fresh)).send({ title: `rl ${i}`, body: 'x' });
        if (i < 10) expect(last.status).toBe(201);
      }
      expect(last?.status).toBe(429);
      expect(last?.body.code).toBe('RATE_LIMITED');
      expect(last?.headers['retry-after']).toBeDefined();
      expect(last?.headers['x-ratelimit-limit']).toBe('10');
      expect(last?.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('@nestjs/throttler на /demo/throttled теж дає 429 після 10', async () => {
      let status = 0;
      for (let i = 0; i < 11; i++) status = (await t.http().get('/demo/throttled')).status;
      expect(status).toBe(429);
    });
  });

  describe('ai', () => {
    // Окремий користувач: у author уже витрачено більшість із 10 токенів rate limit.
    let aiUser: TestUser;
    beforeAll(async () => {
      aiUser = await registerUser(t, 'ai@test.local');
    });

    it('модерація: approve для технічного, reject для спаму, рішення збережене', async () => {
      const good = await createPost(aiUser, { title: 'Пул зєднань', body: 'Довгий текст про pg pool і таймаути зєднань.' });
      const res = await t.http().post(`/posts/${good}/moderate`).set(bearer(aiUser)).expect(201);
      expect(res.body.action).toBe('approve');
      const stored = await t.http().get(`/posts/${good}`).expect(200);
      expect(stored.body.moderationAction).toBe('approve');

      const spam = await createPost(aiUser, { title: 'Buy now', body: 'casino crypto pump' });
      const rej = await t.http().post(`/posts/${spam}/moderate`).set(bearer(aiUser)).expect(201);
      expect(rej.body.action).toBe('reject');
    });

    it('сміття від LLM двічі -> 502 LLM_BAD_OUTPUT', async () => {
      const bad = await createPost(aiUser, { title: 'garbage', body: '[[garbage]] text' });
      const res = await t.http().post(`/posts/${bad}/moderate`).set(bearer(aiUser)).expect(502);
      expect(res.body.code).toBe('LLM_BAD_OUTPUT');
    });

    it('GET /posts/similar зареєстрований перед /posts/:id (не 400 про uuid)', async () => {
      const res = await t.http().get('/posts/similar?q=postgres');
      expect([200, 422]).toContain(res.status);
      if (res.status === 422) expect(res.body.code).toBe('PGVECTOR_UNAVAILABLE');
    });

    const itVector = process.env.PGVECTOR === '1' || process.env.PGVECTOR === 'true' ? it : it.skip;
    itVector('similar: пост про postgres ближчий до запиту "postgres pool" (потрібен pgvector)', async () => {
      await createPost(aiUser, { title: 'postgres pool tuning', body: 'postgres connection pool max' });
      await createPost(aiUser, { title: 'react hooks', body: 'useEffect useState render' });
      const res = await t.http().get('/posts/similar?q=postgres pool').expect(200);
      expect(res.body[0].title).toBe('postgres pool tuning');
    });
  });
});
