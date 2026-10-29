// Що це: міграція, що вмикає pgvector і додає колонку posts.embedding vector(384).
// Чому окремо: розширення vector є не в кожному Postgres (у стандартному образі postgres:16 його немає,
// у pgvector/pgvector:pg16 є). Поза production, якщо розширення немає, пропускаємо з попередженням,
// щоб решта проєкту працювала. У production відсутність розширення: помилка, бо схема має бути повною.
// Хто викликає: migration:run.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostEmbedding1700000000002 implements MigrationInterface {
  name = 'AddPostEmbedding1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { name: string }[] = await queryRunner.query(`SELECT name FROM pg_available_extensions WHERE name = 'vector'`);
    if (rows.length === 0) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Розширення pgvector недоступне. Використай образ pgvector/pgvector:pg16.');
      }
      process.stderr.write('[migration] УВАГА: pgvector недоступний, колонку posts.embedding пропущено. Similar-пошук не працюватиме.\n');
      return;
    }
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await queryRunner.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS embedding vector(384) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE posts DROP COLUMN IF EXISTS embedding`);
  }
}
