import { readdir } from 'node:fs/promises';
import path from 'node:path';

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
  const sqliteModule: string = 'node:sqlite';
  const { DatabaseSync } = (await import(sqliteModule)) as NodeSqliteModule;
  let databasePath = path.join(root, '.runtime', 'wallet-gateway', 'gateway.sqlite');
  if (process.env.SEAMS_INTENDED_WALLET_HOST !== 'vm') {
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
    databasePath = path.join(state, databases[0]);
  }
  return databasePath;
}

