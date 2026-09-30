import { createHash } from 'node:crypto';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../../../packages/wallet-server/src/storage/tenantRoute';

type QueryIdentity = {
  readonly id: string;
  readonly kind: string;
  readonly tables: readonly string[];
};

type StatementMeasurement = {
  readonly query: QueryIdentity;
  readonly region: string | null;
  readonly primary: boolean | null;
  readonly sqlMs: number | null;
  readonly rowsRead: number | null;
  readonly rowsWritten: number | null;
  readonly changes: number | null;
  readonly attempts: number | null;
};

type CallMeasurement = {
  readonly sequence: number;
  readonly method: 'first' | 'all' | 'run' | 'batch' | 'exec';
  readonly startedMs: number;
  readonly elapsedMs: number;
  readonly outcome: 'ok' | 'error';
  readonly statements: readonly StatementMeasurement[];
};

function queryIdentity(sql: string): QueryIdentity {
  const tables = new Set<string>();
  for (const match of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z_0-9]*)/giu)) {
    tables.add(match[1].toLowerCase());
  }
  return {
    id: createHash('sha256').update(sql.trim()).digest('hex').slice(0, 24),
    kind: /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|PRAGMA|CREATE)\b/iu.exec(sql)?.[1].toUpperCase() ?? 'OTHER',
    tables: [...tables].sort(),
  };
}

function metric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function statementMeasurement(query: QueryIdentity, result: unknown): StatementMeasurement {
  const meta = isPlainObject(result) && isPlainObject(result.meta) ? result.meta : {};
  const timings = isPlainObject(meta.timings) ? meta.timings : {};
  return {
    query,
    region: typeof meta.served_by_region === 'string' ? meta.served_by_region : null,
    primary: typeof meta.served_by_primary === 'boolean' ? meta.served_by_primary : null,
    sqlMs: metric(timings.sql_duration_ms) ?? metric(meta.duration),
    rowsRead: metric(meta.rows_read),
    rowsWritten: metric(meta.rows_written),
    changes: metric(meta.changes),
    attempts: metric(meta.total_attempts),
  };
}

// This observer belongs to a single benchmark request. SQL, bound values, rows,
// and error messages never enter its response header.
export class TracedD1Database implements D1DatabaseLike {
  private readonly startedAt = performance.now();
  private readonly calls: CallMeasurement[] = [];
  private startedCalls = 0;
  private finishedCalls = 0;

  constructor(private readonly database: D1DatabaseLike) {}

  prepare(sql: string): D1PreparedStatementLike {
    return new TracedStatement(this, this.database.prepare(sql), queryIdentity(sql));
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const originals = [];
    const queries = [];
    for (const statement of statements) {
      if (!(statement instanceof TracedStatement) || statement.owner !== this) {
        throw new Error('Benchmark batch contains a statement from another database');
      }
      originals.push(statement.original);
      queries.push(statement.query);
    }
    return this.measure('batch', queries, (this.database.batch<T>).bind(this.database, originals));
  }

  async exec(sql: string): Promise<unknown> {
    return this.measure('exec', [queryIdentity(sql)], this.database.exec.bind(this.database, sql));
  }

  async measure<T>(
    method: CallMeasurement['method'],
    queries: readonly QueryIdentity[],
    execute: () => Promise<T>,
  ): Promise<T> {
    const sequence = ++this.startedCalls;
    const started = performance.now();
    let outcome: CallMeasurement['outcome'] = 'error';
    let result: unknown = null;
    try {
      const value = await execute();
      result = value;
      outcome = 'ok';
      return value;
    } finally {
      const elapsedMs = performance.now() - started;
      this.finishedCalls += 1;
      if (this.calls.length < 128) {
        const results = method === 'batch' && Array.isArray(result) ? result : [result];
        const statements = [];
        for (let index = 0; index < queries.length; index += 1) {
          statements.push(statementMeasurement(queries[index], results[index]));
        }
        this.calls.push({
          sequence, method, startedMs: started - this.startedAt, elapsedMs, outcome, statements,
        });
      }
    }
  }

  response(response: Response): Response {
    const headers = new Headers(response.headers);
    const trace = {
      version: 1,
      calls: this.calls,
      pending: this.startedCalls - this.finishedCalls,
      dropped: this.finishedCalls - this.calls.length,
    };
    let encoded = JSON.stringify(trace);
    if (encoded.length > 48_000) {
      encoded = JSON.stringify({ ...trace, calls: [], dropped: this.finishedCalls });
    }
    headers.set('X-Benchmark-D1', encoded);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

class TracedStatement implements D1PreparedStatementLike {
  constructor(
    readonly owner: TracedD1Database,
    readonly original: D1PreparedStatementLike,
    readonly query: QueryIdentity,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new TracedStatement(this.owner, this.original.bind(...values), this.query);
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    // D1 first() discards metadata. all() executes the identical SQL once and
    // preserves it; do not add LIMIT or issue a second diagnostic query.
    const result = await this.owner.measure(
      'first', [this.query], (this.original.all<Record<string, T>>).bind(this.original),
    );
    const row = result.results?.[0];
    if (!row) return null;
    if (columnName === undefined) return row as T;
    if (!Object.hasOwn(row, columnName)) {
      throw new Error('D1_COLUMN_NOTFOUND: Column not found');
    }
    return row[columnName];
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    return this.owner.measure('all', [this.query], (this.original.all<T>).bind(this.original));
  }

  async run<T = unknown>(): Promise<D1ResultLike<T>> {
    return this.owner.measure('run', [this.query], (this.original.run<T>).bind(this.original));
  }
}
