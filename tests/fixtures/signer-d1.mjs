import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';

const migrationsDirectory = fileURLToPath(
  new URL('../../packages/wallet-server/migrations/d1-signer/', import.meta.url),
);

/** @param {string | null} beforeMigration */
export async function openSignerD1(beforeMigration = null) {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default {};',
    d1Databases: ['DB'],
    compatibilityDate: '2026-04-17',
    port: 0,
  });
  try {
    const database = await runtime.getD1Database('DB');
    const names = (await readdir(migrationsDirectory)).filter(isSqlMigration).sort();
    const migrations = names.filter((name) => beforeMigration === null || name < beforeMigration);
    const pendingMigrations = names.filter((name) => !migrations.includes(name));
    await applySignerD1Migrations(database, migrations);
    return { database, migrations, pendingMigrations, close: runtime.dispose.bind(runtime) };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

export async function applySignerD1Migrations(database, names) {
  for (const name of names) {
    let sql = await readFile(join(migrationsDirectory, name), 'utf8');
    if (name === '0028_r103f_phase1_additive_schema_bridge.sql') {
      sql = buildWorkerdCompatiblePhase1Bridge(sql);
    }
    await database.batch(unstable_splitSqlQuery(sql).map((query) => database.prepare(query)));
  }
}

function isSqlMigration(name) {
  return name.endsWith('.sql');
}
