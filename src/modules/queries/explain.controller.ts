// Що це: демо індексів. EXPLAIN (ANALYZE, FORMAT JSON) для фільтра events по (user_id, created_at).
// ?indexed=false вимикає індексні сканування в межах однієї транзакції (SET LOCAL), щоб побачити Seq Scan
// без відкату міграції. ?indexed=true: планувальник сам обирає Index Scan, якщо індекс є.
// Хто викликає: GET /demo/explain?indexed=true|false
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

export interface ExplainResponse {
  indexed: boolean;
  userId: string | null;
  rowsMatched: number;
  nodeType: string;
  indexName: string | null;
  planningTimeMs: number;
  executionTimeMs: number;
  plan: unknown;
}

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  Plans?: PlanNode[];
}

interface ExplainRow {
  'QUERY PLAN': Array<{ Plan: PlanNode; 'Planning Time': number; 'Execution Time': number }>;
}

// Шукаємо вузол сканування таблиці. Якщо є вузол з 'Index Name' (Index Scan, Index Only Scan,
// Bitmap Index Scan), беремо його; інакше перший вузол з 'Scan' у назві (Seq Scan).
function findScan(node: PlanNode): PlanNode {
  return findNode(node, (n) => n['Index Name'] !== undefined) ?? findNode(node, (n) => n['Node Type'].includes('Scan')) ?? node;
}

function findNode(node: PlanNode, predicate: (n: PlanNode) => boolean): PlanNode | null {
  if (predicate(node)) return node;
  for (const child of node.Plans ?? []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

@ApiTags('demo')
@Controller('demo')
export class ExplainController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('explain')
  async explain(@Query('indexed') indexedRaw?: string): Promise<ExplainResponse> {
    const indexed = indexedRaw !== 'false';
    // Беремо реального користувача з events, щоб фільтр щось знаходив.
    const sample: Array<{ user_id: string }> = await this.dataSource.query(`SELECT user_id FROM events ORDER BY id LIMIT 1`);
    const userId = sample[0]?.user_id ?? null;
    if (!userId) {
      return { indexed, userId: null, rowsMatched: 0, nodeType: 'none', indexName: null, planningTimeMs: 0, executionTimeMs: 0, plan: null };
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      if (!indexed) {
        // SET LOCAL діє до кінця транзакції. Planner змушений робити Seq Scan.
        await runner.query(`SET LOCAL enable_indexscan = off`);
        await runner.query(`SET LOCAL enable_bitmapscan = off`);
        await runner.query(`SET LOCAL enable_indexonlyscan = off`);
      }
      const rows: ExplainRow[] = await runner.query(
        `EXPLAIN (ANALYZE, FORMAT JSON)
         SELECT count(*) FROM events
         WHERE user_id = $1 AND created_at >= now() - interval '30 days'`,
        [userId],
      );
      const matched: Array<{ count: string }> = await runner.query(
        `SELECT count(*) FROM events WHERE user_id = $1 AND created_at >= now() - interval '30 days'`,
        [userId],
      );
      await runner.commitTransaction();
      const top = rows[0]['QUERY PLAN'][0];
      const scan = findScan(top.Plan);
      return {
        indexed,
        userId,
        rowsMatched: Number(matched[0].count),
        nodeType: scan['Node Type'],
        indexName: scan['Index Name'] ?? null,
        planningTimeMs: top['Planning Time'],
        executionTimeMs: top['Execution Time'],
        plan: top.Plan,
      };
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }
  }
}
