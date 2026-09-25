// node:sqlite as the shared synchronous SQLite connection for VM hosts.

import type { SyncSqliteConnectionV1, SyncSqliteRow, SyncSqliteValue } from '../../storage/syncSqlite';

/** The subset of `node:sqlite`'s DatabaseSync the VM hosts use. */
export type NodeDatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: SyncSqliteValue[]): unknown[] };
  close(): void;
};

export type NodeDatabaseSyncConstructor = new (
  path: string,
  options?: { readonly readOnly?: boolean },
) => NodeDatabaseSyncLike;

const BUSY_TIMEOUT_MS = 5_000;

/** Loads `node:sqlite` at runtime so the package builds without its typings. */
export async function loadNodeDatabaseSync(): Promise<NodeDatabaseSyncConstructor> {
  const specifier = 'node:sqlite';
  const module = (await import(specifier)) as { DatabaseSync?: NodeDatabaseSyncConstructor };
  if (typeof module.DatabaseSync !== 'function') {
    throw new Error('node:sqlite DatabaseSync is unavailable; use Node.js 22.13 or newer');
  }
  return module.DatabaseSync;
}

/**
 * Opens a SQLite file for one role-private store. Writers from separate
 * processes serialize on `BEGIN IMMEDIATE`; WAL lets readers proceed.
 */
export function openNodeSqliteFile(
  DatabaseSync: NodeDatabaseSyncConstructor,
  path: string,
): NodeDatabaseSyncLike {
  const database = new DatabaseSync(path);
  database.exec(
    `PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`,
  );
  return database;
}

export function nodeSqliteConnection(database: NodeDatabaseSyncLike): SyncSqliteConnectionV1 {
  let inTransaction = false;
  return {
    execute: (sql, params) => database.prepare(sql).all(...params) as SyncSqliteRow[],
    executeScript: (sql) => database.exec(sql),
    transaction: (body) => {
      if (inTransaction) throw new Error('nested SQLite transactions are not supported');
      database.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      try {
        const result = body();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  };
}
