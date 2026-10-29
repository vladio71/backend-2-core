// Що це: перша міграція. Створює всі таблиці. Написана руками, щоб кожен рядок було видно.
// Чому: synchronize=true у production заборонено: TypeORM може мовчки DROP-нути колонку з даними.
// Міграція ж: версія схеми в git, її можна переглянути, прогнати на staging, відкотити.
// Хто викликає: npm run migration:run (CLI) або dataSource.runMigrations() у тестах.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000001 implements MigrationInterface {
  name = 'InitSchema1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // citext: email без урахування регістру. Vlad@x.com і vlad@x.com це один користувач.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);

    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email citext NOT NULL UNIQUE,
        password_hash text NOT NULL,
        role text NOT NULL DEFAULT 'user',
        display_name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        family_id uuid NOT NULL,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz NULL,
        revoked_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id)`);
    await queryRunner.query(`CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens(family_id)`);

    await queryRunner.query(`
      CREATE TABLE posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title text NOT NULL,
        body text NOT NULL,
        tags text[] NOT NULL DEFAULT '{}',
        status text NOT NULL DEFAULT 'draft',
        likes int NOT NULL DEFAULT 0,
        meta jsonb NOT NULL DEFAULT '{}',
        author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        moderation_action text NULL,
        moderation_reason text NULL,
        published_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL
      )`);
    await queryRunner.query(`CREATE INDEX posts_author_id_idx ON posts(author_id)`);
    await queryRunner.query(`CREATE INDEX posts_status_idx ON posts(status)`);
    // GIN-індекс по масиву тегів: для tags && ARRAY[...] і tags @> ARRAY[...].
    await queryRunner.query(`CREATE INDEX posts_tags_gin_idx ON posts USING gin(tags)`);

    await queryRunner.query(`
      CREATE TABLE activity (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL,
        actor_id uuid NOT NULL,
        action text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX activity_post_id_idx ON activity(post_id)`);

    await queryRunner.query(`
      CREATE TABLE credit_balances (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance int NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT credit_balances_balance_non_negative CHECK (balance >= 0)
      )`);

    await queryRunner.query(`
      CREATE TABLE credit_reservations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount int NOT NULL CHECK (amount > 0),
        status text NOT NULL DEFAULT 'reserved',
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX credit_reservations_user_id_idx ON credit_reservations(user_id)`);
    await queryRunner.query(`CREATE INDEX credit_reservations_status_idx ON credit_reservations(status)`);

    await queryRunner.query(`
      CREATE TABLE github_repos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        github_id bigint NOT NULL,
        owner text NOT NULL,
        name text NOT NULL,
        description text NULL,
        stars int NOT NULL DEFAULT 0,
        language text NULL,
        imported_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner, name)
      )`);

    await queryRunner.query(`
      CREATE TABLE reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        status text NOT NULL DEFAULT 'queued',
        progress int NOT NULL DEFAULT 0,
        fail_rate real NOT NULL DEFAULT 0,
        attempts int NOT NULL DEFAULT 0,
        result jsonb NULL,
        error text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX reports_user_id_idx ON reports(user_id)`);

    // events: без індексу по user_id навмисно. Його додає міграція 1700000000003.
    await queryRunner.query(`
      CREATE TABLE events (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL,
        type text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS events`);
    await queryRunner.query(`DROP TABLE IF EXISTS reports`);
    await queryRunner.query(`DROP TABLE IF EXISTS github_repos`);
    await queryRunner.query(`DROP TABLE IF EXISTS credit_reservations`);
    await queryRunner.query(`DROP TABLE IF EXISTS credit_balances`);
    await queryRunner.query(`DROP TABLE IF EXISTS activity`);
    await queryRunner.query(`DROP TABLE IF EXISTS posts`);
    await queryRunner.query(`DROP TABLE IF EXISTS refresh_tokens`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
  }
}
