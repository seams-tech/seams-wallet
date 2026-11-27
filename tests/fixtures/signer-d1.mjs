import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

const migrationsDirectory = fileURLToPath(
  new URL('../../packages/mpc-wallet-server/migrations/d1-signer/', import.meta.url),
);

export async function openSignerD1() {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default {};',
    d1Databases: ['DB'],
    compatibilityDate: '2026-04-17',
    port: 0,
  });
  try {
    const database = await runtime.getD1Database('DB');
    const migrations = await applySignerD1Migrations(database);
    return { database, migrations, close: runtime.dispose.bind(runtime) };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

// Applies every signer migration in name order, as `wrangler d1 migrations apply` does, and
// returns the name and SHA-256 of each file.
export async function applySignerD1Migrations(database) {
  const migrations = [];
  for (const name of (await readdir(migrationsDirectory)).filter(isSqlMigration).sort()) {
    const sql = await readFile(join(migrationsDirectory, name), 'utf8');
    await database.batch(unstable_splitSqlQuery(sql).map((query) => database.prepare(query)));
    migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
  }
  return migrations;
}

function isSqlMigration(name) {
  return name.endsWith('.sql');
}
