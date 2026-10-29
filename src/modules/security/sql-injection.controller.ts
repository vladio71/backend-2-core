// Що це: демо SQL-ін'єкції. Існує ТІЛЬКИ при NODE_ENV=development (див. security.module.ts).
// ?safe=true: параметризований запит ($1). ?safe=false: конкатенація рядка. Спробуй q=' OR 1=1 --
// Хто викликає: GET /demo/sql-injection?safe=false&q=...
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

export interface SqlInjectionResponse {
  safe: boolean;
  sql: string;
  rows: Array<{ id: string; email: string }>;
}

@ApiTags('demo')
@Controller('demo')
export class SqlInjectionController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('sql-injection')
  async run(@Query('safe') safeRaw?: string, @Query('q') q = 'nobody@example.com'): Promise<SqlInjectionResponse> {
    const safe = safeRaw !== 'false';
    if (safe) {
      // Значення йде окремо від тексту запиту. Postgres ніколи не трактує його як SQL.
      const sql = `SELECT id, email FROM users WHERE email = $1`;
      const rows = await this.dataSource.query(sql, [q]);
      return { safe, sql: `${sql}   -- $1 = ${JSON.stringify(q)}`, rows };
    }
    // НІКОЛИ так не роби. Рядок користувача стає частиною SQL.
    const sql = `SELECT id, email FROM users WHERE email = '${q}'`;
    const rows = await this.dataSource.query(sql);
    return { safe, sql, rows };
  }
}
