// Що це: сід. Адмін, 3 користувачі, 30 постів, кредити, 200 000 подій.
// Чому події через INSERT ... SELECT generate_series: один запит замість 200 000. Секунди, а не хвилини.
// Запуск: npm run seed (ідемпотентний: повторний запуск не дублює користувачів).
import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { loadConfig } from '../src/modules/config/config.module';
import { buildDataSourceOptions } from '../src/modules/database/data-source-options';
import { User } from '../src/modules/users/user.entity';
import { Post } from '../src/modules/posts/post.entity';
import { FakeEmbeddingProvider } from '../src/modules/ai/embedding.provider';
import { toVectorLiteral } from '../src/modules/ai/post-embeddings.service';

export const SEED_PASSWORD = 'password123';

const TAGS = ['node', 'postgres', 'redis', 'typescript', 'react', 'docker', 'testing', 'nestjs'];

const TITLES = [
  'Як я налаштував пул з\'єднань до Postgres',
  'N+1 у TypeORM і як його побачити',
  'Міграції замість synchronize',
  'Token bucket на Lua в Redis',
  'Чому refresh-токен треба ротувати',
  'SELECT FOR UPDATE на прикладі кредитів',
  'BullMQ: воркер окремим процесом',
  'socket.io і Redis-адаптер на двох інстансах',
  'Soft delete: за і проти',
  'Cursor-пагінація без OFFSET',
];

export async function runSeed(dataSource: DataSource, options: { events?: number; log?: (msg: string) => void } = {}): Promise<void> {
  const log = options.log ?? ((msg: string) => process.stdout.write(msg + '\n'));
  const eventsCount = options.events ?? 200_000;
  const users = dataSource.getRepository(User);
  const posts = dataSource.getRepository(Post);
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const people = [
    { email: 'admin@devhub.local', displayName: 'Admin', role: 'admin' as const },
    { email: 'olena@devhub.local', displayName: 'Olena', role: 'user' as const },
    { email: 'taras@devhub.local', displayName: 'Taras', role: 'user' as const },
    { email: 'iryna@devhub.local', displayName: 'Iryna', role: 'user' as const },
  ];
  const saved: User[] = [];
  for (const p of people) {
    let user = await users.findOne({ where: { email: p.email } });
    if (!user) user = await users.save(users.create({ ...p, passwordHash }));
    saved.push(user);
    await dataSource.query(`INSERT INTO credit_balances (user_id, balance) VALUES ($1, 100) ON CONFLICT (user_id) DO NOTHING`, [user.id]);
  }
  log(`Користувачів: ${saved.length} (пароль у всіх: ${SEED_PASSWORD})`);

  const existingPosts = await posts.count();
  if (existingPosts === 0) {
    const hasVector = await vectorColumnExists(dataSource);
    const embedder = new FakeEmbeddingProvider();
    const authors = saved.slice(1);
    for (let i = 0; i < 30; i++) {
      const author = authors[i % authors.length];
      const title = `${TITLES[i % TITLES.length]} #${i + 1}`;
      const body = `Пост ${i + 1}. ${TITLES[i % TITLES.length]}. Трохи тексту про ${TAGS[i % TAGS.length]} і ${TAGS[(i + 3) % TAGS.length]}.`;
      const post = await posts.save(
        posts.create({
          title,
          body,
          tags: [TAGS[i % TAGS.length], TAGS[(i + 3) % TAGS.length]],
          status: i % 3 === 0 ? 'draft' : 'published',
          likes: (i * 7) % 50,
          meta: { seo: { title, description: `SEO для поста ${i + 1}` } },
          authorId: author.id,
          publishedAt: i % 3 === 0 ? null : new Date(Date.now() - i * 86_400_000),
        }),
      );
      // Розкидаємо created_at по 30 днях, щоб звіт posts-per-day мав що групувати.
      await dataSource.query(`UPDATE posts SET created_at = now() - ($1 || ' days')::interval WHERE id = $2`, [String(i), post.id]);
      if (hasVector) {
        await dataSource.query(`UPDATE posts SET embedding = $1::vector WHERE id = $2`, [toVectorLiteral(await embedder.embed(`${title}\n${body}`)), post.id]);
      }
    }
    log('Постів: 30');
  } else {
    log(`Постів уже є: ${existingPosts}, пропускаю`);
  }

  const existingEvents: Array<{ count: string }> = await dataSource.query(`SELECT count(*) FROM events`);
  if (Number(existingEvents[0].count) < eventsCount) {
    const started = Date.now();
    // generate_series(1, N) віддає N рядків. user_id: 1000 різних "користувачів" (uuid з номера g % 1000),
    // щоб фільтр по одному user_id був вибірковим (~200 рядків з 200 000) і планувальник обирав індекс.
    // Дата: випадкова в останні 60 днів.
    await dataSource.query(
      `INSERT INTO events (user_id, type, payload, created_at)
       SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(g % 1000), 12, '0'))::uuid,
              (ARRAY['click','view','like','share'])[1 + (g % 4)],
              jsonb_build_object('n', g),
              now() - (random() * interval '60 days')
       FROM generate_series(1, $1) AS g`,
      [eventsCount - Number(existingEvents[0].count)],
    );
    await dataSource.query(`ANALYZE events`);
    log(`Подій: ${eventsCount} за ${Date.now() - started} мс`);
  } else {
    log(`Подій уже є: ${existingEvents[0].count}, пропускаю`);
  }
}

async function vectorColumnExists(dataSource: DataSource): Promise<boolean> {
  const rows: Array<{ exists: boolean }> = await dataSource.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'embedding') AS exists`,
  );
  return rows[0]?.exists === true;
}

if (require.main === module) {
  const dataSource = new DataSource(buildDataSourceOptions(loadConfig()));
  dataSource
    .initialize()
    .then(() => runSeed(dataSource))
    .then(() => dataSource.destroy())
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
      process.exit(1);
    });
}
