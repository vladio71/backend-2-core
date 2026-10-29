// Що це: міграція, що додає складений індекс events(user_id, created_at).
// Чому окремо: щоб ти міг її відкотити (npm run migration:revert), подивитися EXPLAIN без індексу,
// накотити знову і порівняти. Це і є "зміна схеми на живих даних": 200 000 рядків уже є.
// Порядок колонок важливий: спочатку рівність (user_id = ?), потім діапазон (created_at > ?).
// Хто викликає: migration:run.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventsUserCreatedIndex1700000000003 implements MigrationInterface {
  name = 'AddEventsUserCreatedIndex1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // У production на великій таблиці краще CREATE INDEX CONCURRENTLY (не блокує записи),
    // але його не можна виконати всередині транзакції, у якій TypeORM запускає міграцію.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS events_user_id_created_at_idx ON events(user_id, created_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS events_user_id_created_at_idx`);
  }
}
