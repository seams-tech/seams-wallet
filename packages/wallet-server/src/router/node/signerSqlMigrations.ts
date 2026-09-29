// Explicit schema management for the VM Gateway's shared SQL store: the
// same d1-signer migration chain the Cloudflare Gateway's D1 database uses,
// applied to a SQLite file with its own ledger.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SyncSqliteConnectionV1 } from '../../storage/syncSqlite';

const LEDGER_TABLE = 'seams_signer_sql_migrations';

type SignerSqlMigrationStatusV1 = {
  readonly applied: readonly string[];
  readonly pending: readonly string[];
  /** Applied migrations this package does not ship: a newer schema. */
  readonly unknown: readonly string[];
};

function migrationNames(directory: string): readonly string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function appliedNames(connection: SyncSqliteConnectionV1): readonly string[] {
  const ledger = connection.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
    [LEDGER_TABLE],
  );
  if (ledger.length === 0) return [];
  return connection
    .execute(`SELECT name FROM ${LEDGER_TABLE} ORDER BY name`, [])
    .map((row) => String(row.name));
}

/** Read-only: compares the database ledger with the shipped migration chain. */
export function inspectSignerSqlMigrationsV1(
  connection: SyncSqliteConnectionV1,
  directory: string,
): SignerSqlMigrationStatusV1 {
  const shipped = migrationNames(directory);
  const applied = appliedNames(connection);
  return {
    applied,
    pending: shipped.filter((name) => !applied.includes(name)),
    unknown: applied.filter((name) => !shipped.includes(name)),
  };
}

/**
 * Applies pending migrations in order, each in one transaction together
 * with its ledger row, so an interrupted run resumes at the first missing
 * migration. Refuses a database that already carries migrations this
 * package does not know, or whose applied set is not a prefix of the chain.
 */
export function applySignerSqlMigrationsV1(
  connection: SyncSqliteConnectionV1,
  directory: string,
  nowMs: number,
): { readonly applied: readonly string[] } {
  const status = inspectSignerSqlMigrationsV1(connection, directory);
  if (status.unknown.length > 0) {
    throw new Error(
      `database has migrations this package does not ship: ${status.unknown.join(', ')}`,
    );
  }
  const shipped = migrationNames(directory);
  if (status.applied.some((name, index) => shipped[index] !== name)) {
    throw new Error('applied migrations are not a prefix of the shipped migration chain');
  }
  connection.executeScript(
    `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (name TEXT PRIMARY KEY, applied_at_ms INTEGER NOT NULL)`,
  );
  const applied: string[] = [];
  for (const name of status.pending) {
    const sql = readFileSync(join(directory, name), 'utf8');
    connection.transaction(() => {
      connection.executeScript(sql);
      connection.execute(`INSERT INTO ${LEDGER_TABLE} (name, applied_at_ms) VALUES (?1, ?2)`, [
        name,
        nowMs,
      ]);
    });
    applied.push(name);
  }
  return { applied };
}
