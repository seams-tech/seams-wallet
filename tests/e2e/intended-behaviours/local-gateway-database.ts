import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { D1DatabaseLike, D1PreparedStatementLike } from '@server/storage/tenantRoute';

/** SQLite operations used by isolated signing scenarios. */
export type NodeSqliteModule = {
  readonly DatabaseSync: new (
    path: string,
    options: { readonly readOnly: boolean },
  ) => {
    prepare(sql: string): {
      all(...parameters: (string | number | null)[]): Record<string, unknown>[];
      run(...parameters: (string | number | null)[]): { changes: number };
    };
    close(): void;
  };
};

export async function isolatedGatewayDatabasePath(): Promise<string> {
  const root = process.env.SEAMS_INTENDED_ROUTER_AB_ROOT;
  if (!root) throw new Error('Signing evidence requires an isolated local root');
  const DatabaseSync = await loadIsolatedDatabaseSync();
  const state = path.join(root, '.local', 'cloudflare-state', 'wallet-gateway');
  const files = await readdir(state, { recursive: true });
  const databases: string[] = [];
  for (const file of files) {
    if (!file.endsWith('.sqlite')) continue;
    const candidate = new DatabaseSync(path.join(state, file), { readOnly: true });
    try {
      const tables = candidate
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'authorized_operations'",
        )
        .all();
      if (tables.length === 1) databases.push(file);
    } finally {
      candidate.close();
    }
  }
  if (databases.length !== 1) throw new Error('Expected one isolated Gateway D1 database');
  const databasePath = path.join(state, databases[0]);
  return databasePath;
}

/**
 * Leaves the wallet's active Wallet Session quota as its last claim would:
 * no uses and an exhausted lifecycle. This is what another tab or device that
 * shares the session does to it, unseen by the page under test.
 */
export async function exhaustWalletSessionQuota(walletId: string): Promise<void> {
  const DatabaseSync = await loadIsolatedDatabaseSync();
  const database = new DatabaseSync(await isolatedGatewayDatabasePath(), { readOnly: false });
  try {
    const exhausted = database
      .prepare(
        `UPDATE authorization_wallet_session_quotas AS quota
            SET remaining_uses = 0, lifecycle_kind = 'exhausted'
          WHERE quota.lifecycle_kind = 'active'
            AND EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
              WHERE session.namespace = quota.namespace AND session.tenant_id = quota.tenant_id
                AND session.quota_id = quota.quota_id AND session.wallet_id = ?
                AND session.retired_at_ms IS NULL)
          RETURNING quota_id`,
      )
      .all(walletId);
    if (exhausted.length !== 1) throw new Error('Expected one active Wallet Session quota');
  } finally {
    database.close();
  }
}

export async function loadIsolatedDatabaseSync(): Promise<NodeSqliteModule['DatabaseSync']> {
  const sqliteModule: string = 'node:sqlite';
  const { DatabaseSync } = (await import(sqliteModule)) as NodeSqliteModule;
  return DatabaseSync;
}

/** Read-only inspection of real local D1 state through the production readers. */
export async function openReadOnlyGatewayD1() {
  const DatabaseSync = await loadIsolatedDatabaseSync();
  const sqlite = new DatabaseSync(await isolatedGatewayDatabasePath(), { readOnly: true });
  return { database: new ReadOnlySqliteD1(sqlite), close: sqlite.close.bind(sqlite) };
}

type SqliteEvidenceDatabase = InstanceType<NodeSqliteModule['DatabaseSync']>;

class ReadOnlySqliteD1 implements D1DatabaseLike {
  constructor(private readonly sqlite: SqliteEvidenceDatabase) {}

  prepare(sql: string): D1PreparedStatementLike {
    return new ReadOnlySqliteStatement(this.sqlite, sql, []);
  }

  batch = rejectEvidenceWrite;
  exec = rejectEvidenceWrite;
}

class ReadOnlySqliteStatement implements D1PreparedStatementLike {
  constructor(
    private readonly sqlite: SqliteEvidenceDatabase,
    private readonly sql: string,
    private readonly parameters: readonly (string | number | null)[],
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new ReadOnlySqliteStatement(this.sqlite, this.sql, values.map(evidenceSqlParameter));
  }

  async all<T>() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.parameters) as T[] };
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).all(...this.parameters)[0];
    return row ? ((column === undefined ? row : row[column]) as T) : null;
  }

  run = rejectEvidenceWrite;
}

function evidenceSqlParameter(value: unknown): string | number | null {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  throw new Error('SQLite source evidence accepts scalar query parameters');
}

async function rejectEvidenceWrite(): Promise<never> {
  throw new Error('Source evidence cannot write to the inspected D1 database');
}
