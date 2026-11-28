import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

const migrationsDirectory = fileURLToPath(
  new URL('../../packages/mpc-wallet-server/migrations/d1-signer/', import.meta.url),
);

/** A local D1 database with every migration of one folder applied. */
export async function openD1(directory = migrationsDirectory) {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default {};',
    d1Databases: ['DB'],
    compatibilityDate: '2026-04-17',
    port: 0,
  });
  try {
    const database = await runtime.getD1Database('DB');
    const migrations = await applyD1Migrations(database, directory);
    return { database, migrations, close: runtime.dispose.bind(runtime) };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

export function openSignerD1() {
  return openD1(migrationsDirectory);
}

/** The database of the Auth Worker. */
export function openAuthD1() {
  return openD1(fileURLToPath(new URL('../../packages/auth/migrations/d1-auth/', import.meta.url)));
}

export function applySignerD1Migrations(database) {
  return applyD1Migrations(database, migrationsDirectory);
}

// Applies every migration of a folder in name order, as `wrangler d1 migrations apply` does,
// and returns the name and SHA-256 of each file.
async function applyD1Migrations(database, directory) {
  const migrations = [];
  for (const name of (await readdir(directory)).filter(isSqlMigration).sort()) {
    const sql = await readFile(join(directory, name), 'utf8');
    await database.batch(unstable_splitSqlQuery(sql).map((query) => database.prepare(query)));
    migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
  }
  return migrations;
}

function isSqlMigration(name) {
  return name.endsWith('.sql');
}
