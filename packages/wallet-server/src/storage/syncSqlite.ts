import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from './tenantRoute';

/**
 * A value SQLite accepts as a bound parameter on every supported host.
 */
export type SyncSqliteValue = string | number | null | Uint8Array;

export type SyncSqliteRow = Record<string, unknown>;

/**
 * One synchronous SQLite connection owned by a single role store: a Durable
 * Object's SQLite storage on Cloudflare, or a role-private SQLite file opened
 * by an ordinary process on a VM. Host adapters implement only these three
 * operations; the store logic above them is shared.
 */
export interface SyncSqliteConnectionV1 {
  /** Executes exactly one statement and returns its rows (none for writes). */
  execute(sql: string, params: readonly SyncSqliteValue[]): readonly SyncSqliteRow[];
  /** Runs `body` in one SQLite transaction. A thrown error rolls it back. */
  transaction<T>(body: () => T): T;
  /** Executes trusted schema text that may contain several statements. */
  executeScript(sql: string): void;
}

/**
 * Presents a synchronous SQLite connection through the async SQL shape used
 * by the shared stores. `batch` is one SQLite transaction: a failing statement
 * rolls back every earlier statement, so guarded compare-and-set batches keep
 * the all-or-nothing semantics they have on D1.
 */
export function createSyncSqliteDatabase(connection: SyncSqliteConnectionV1): D1DatabaseLike {
  return new SyncSqliteDatabase(connection);
}

class SyncSqliteDatabase implements D1DatabaseLike {
  constructor(private readonly connection: SyncSqliteConnectionV1) {}

  prepare(query: string): D1PreparedStatementLike {
    return new SyncSqliteStatement(this.connection, query, []);
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const owned = statements.map((statement) => {
      if (!(statement instanceof SyncSqliteStatement) || statement.connection !== this.connection) {
        throw new Error('SQLite batch statements must be prepared by the same database');
      }
      return statement;
    });
    return this.connection.transaction(() =>
      owned.map((statement) => statement.executeNow()),
    ) as unknown as readonly T[];
  }

  async exec(query: string): Promise<unknown> {
    this.connection.executeScript(query);
    return { success: true };
  }
}

class SyncSqliteStatement implements D1PreparedStatementLike {
  constructor(
    readonly connection: SyncSqliteConnectionV1,
    private readonly query: string,
    private readonly values: readonly SyncSqliteValue[],
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new SyncSqliteStatement(this.connection, this.query, values.map(toSqliteValue));
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const row = this.connection.execute(this.query, this.values)[0];
    if (!row) return null;
    if (columnName === undefined) return row as T;
    return (row[columnName] ?? null) as T | null;
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    return this.executeNow() as D1ResultLike<T>;
  }

  async run<T = unknown>(): Promise<D1ResultLike<T>> {
    return this.executeNow() as D1ResultLike<T>;
  }

  /** Executes synchronously so a batch can run inside one host transaction. */
  executeNow(): D1ResultLike {
    const results = this.connection.execute(this.query, this.values);
    const [counters] = this.connection.execute(
      'SELECT changes() AS changes, last_insert_rowid() AS last_row_id',
      [],
    );
    return {
      results,
      success: true,
      meta: {
        changes: Number(counters?.changes ?? 0),
        last_row_id: Number(counters?.last_row_id ?? 0),
      },
    };
  }
}

function toSqliteValue(value: unknown): SyncSqliteValue {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SQLite binding must be a finite number');
    return value;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`unsupported SQLite binding type ${typeof value}`);
}
