import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../../../packages/wallet-server/src/storage/tenantRoute';

type SqliteJsonRow = Record<string, unknown>;

class SqliteCliD1Database implements D1DatabaseLike {
  constructor(readonly databasePath: string) {}

  prepare(query: string): D1PreparedStatementLike {
    return new SqliteCliD1PreparedStatement(this.databasePath, query, []);
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const sqlStatements = statements.map(sqlFromD1PreparedStatement);
    const sql = `BEGIN IMMEDIATE; ${sqlStatements
      .map(sqlStatementWithBatchReadback)
      .join(' ')} COMMIT;`;
    const rows = runSqliteJson(this.databasePath, sql);
    return buildD1BatchResults(rows, statements.length) as unknown as readonly T[];
  }

  async exec(query: string): Promise<unknown> {
    runSqlite(this.databasePath, query);
    return null;
  }
}

class SqliteCliD1PreparedStatement implements D1PreparedStatementLike {
  constructor(
    private readonly databasePath: string,
    private readonly query: string,
    private readonly values: readonly unknown[],
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new SqliteCliD1PreparedStatement(this.databasePath, this.query, values);
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const result = await this.all<SqliteJsonRow>();
    const row = result.results?.[0] || null;
    if (!row) return null;
    if (!columnName) return row as T;
    const value = row[columnName];
    return value === undefined ? null : (value as T);
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    const results = runSqliteJson(this.databasePath, this.toSql());
    return {
      success: true,
      results: results as readonly T[],
      meta: { rows_read: results.length, rows_written: 0 },
    };
  }

  async run<T = unknown>(): Promise<D1ResultLike<T>> {
    const sql = `${this.toSql()} SELECT changes() AS changes, last_insert_rowid() AS last_row_id;`;
    const results = runSqliteJson(this.databasePath, sql);
    const metaRow = results.at(-1) || {};
    const changes = toInteger(metaRow.changes);
    return {
      success: true,
      results: [] as readonly T[],
      meta: {
        changes,
        last_row_id: toInteger(metaRow.last_row_id),
        rows_written: changes,
      },
    };
  }

  toSql(): string {
    return interpolateSql(this.query, this.values);
  }
}

export type TemporaryD1Database = {
  readonly database: D1DatabaseLike;
  readonly tempDir: string;
};

export function createTemporaryD1Database(): TemporaryD1Database {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'seams-wallet-region-test-'));
  return {
    database: new SqliteCliD1Database(path.join(tempDir, 'wallet-region.sqlite')),
    tempDir,
  };
}

export function cleanupTemporaryD1Database(tempDir: string): void {
  rmSync(tempDir, { recursive: true, force: true });
}

function sqlFromD1PreparedStatement(statement: D1PreparedStatementLike): string {
  if (!(statement instanceof SqliteCliD1PreparedStatement)) {
    throw new Error('SQLite D1 fixture only accepts SQLite-backed statements');
  }
  return statement.toSql();
}

function sqlStatementWithBatchReadback(statement: string, index: number): string {
  return `SELECT ${index} AS __d1_batch_begin; ${statement} SELECT ${index} AS __d1_batch_end, changes() AS changes, last_insert_rowid() AS last_row_id;`;
}

function buildD1BatchResults(
  rows: readonly SqliteJsonRow[],
  statementCount: number,
): readonly D1ResultLike[] {
  const results: D1ResultLike[] = [];
  let cursor = 0;
  for (let index = 0; index < statementCount; index += 1) {
    const begin = rows[cursor];
    if (toInteger(begin?.__d1_batch_begin) !== index) {
      throw new Error(`SQLite D1 batch result ${index} is missing its begin marker`);
    }
    cursor += 1;
    const statementRows: SqliteJsonRow[] = [];
    while (cursor < rows.length && !('__d1_batch_end' in (rows[cursor] || {}))) {
      const row = rows[cursor];
      if (row) statementRows.push(row);
      cursor += 1;
    }
    const end = rows[cursor];
    if (toInteger(end?.__d1_batch_end) !== index) {
      throw new Error(`SQLite D1 batch result ${index} is missing its end marker`);
    }
    cursor += 1;
    const changes = toInteger(end?.changes);
    results.push({
      success: true,
      results: statementRows,
      meta: {
        changes,
        last_row_id: toInteger(end?.last_row_id),
        rows_read: statementRows.length,
        rows_written: changes,
      },
    });
  }
  return results;
}

function runSqlite(databasePath: string, sql: string): void {
  const result = spawnSync('sqlite3', [databasePath], {
    encoding: 'utf8',
    input: sql,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status === 0) return;
  throw new Error(formatSqliteError(result.stderr, sql));
}

function runSqliteJson(databasePath: string, sql: string): readonly SqliteJsonRow[] {
  const result = spawnSync('sqlite3', ['-json', databasePath], {
    encoding: 'utf8',
    input: sql,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(formatSqliteError(result.stderr, sql));
  const stdout = result.stdout.trim();
  if (!stdout) return [];
  return parseSqliteJsonRows(stdout);
}

function parseSqliteJsonRows(stdout: string): readonly SqliteJsonRow[] {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed.filter(isSqliteJsonRow) : [];
  } catch {
    return parseLineDelimitedSqliteJsonRows(stdout);
  }
}

function parseLineDelimitedSqliteJsonRows(stdout: string): readonly SqliteJsonRow[] {
  const rows: SqliteJsonRow[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) rows.push(...parsed.filter(isSqliteJsonRow));
  }
  return rows;
}

function isSqliteJsonRow(value: unknown): value is SqliteJsonRow {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function formatSqliteError(stderr: string, sql: string): string {
  return `sqlite3 failed: ${stderr.trim() || 'unknown error'}\nSQL: ${sql}`;
}

function interpolateSql(query: string, values: readonly unknown[]): string {
  let sql = '';
  let inSingleQuote = false;
  let anonymousIndex = 0;
  const referenced = new Set<number>();
  for (let index = 0; index < query.length; index += 1) {
    const character = query[index] || '';
    const next = query[index + 1] || '';
    if (character === "'" && inSingleQuote && next === "'") {
      sql += "''";
      index += 1;
      continue;
    }
    if (character === "'") {
      inSingleQuote = !inSingleQuote;
      sql += character;
      continue;
    }
    if (character !== '?' || inSingleQuote) {
      sql += character;
      continue;
    }
    let digits = '';
    while (index + 1 < query.length && /[0-9]/u.test(query[index + 1] || '')) {
      index += 1;
      digits += query[index];
    }
    const valueIndex = digits ? Number(digits) - 1 : anonymousIndex++;
    if (!Number.isSafeInteger(valueIndex) || valueIndex < 0 || valueIndex >= values.length) {
      throw new Error(`SQL placeholder ${digits ? `?${digits}` : '?'} has no bound value`);
    }
    referenced.add(valueIndex);
    sql += sqlLiteral(values[valueIndex]);
  }
  if (referenced.size !== values.length) {
    throw new Error(
      `SQL placeholder count ${referenced.size} did not match bound value count ${values.length}`,
    );
  }
  const trimmed = sql.trim();
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
}

function sqlLiteral(value: unknown): string {
  if (value == null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

function toInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}
