#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeRoot = path.join(repoRoot, '.runtime', 'r150-hosted');
const stores = {
  signer: { config: 'gateway/wrangler.jsonc', binding: 'SIGNER_DB', inventoryKey: 'signer' },
  'deriver-a': {
    config: 'roles/deriver-a.jsonc',
    binding: 'DERIVER_ROLE_PRIVATE_DB',
    inventoryKey: 'deriverA',
  },
  'deriver-b': {
    config: 'roles/deriver-b.jsonc',
    binding: 'DERIVER_ROLE_PRIVATE_DB',
    inventoryKey: 'deriverB',
  },
  'signing-worker': {
    config: 'roles/signing-worker.jsonc',
    binding: 'SIGNING_WORKER_PRIVATE_DB',
    inventoryKey: 'signingWorker',
  },
};

const [arm, storeName] = process.argv.slice(2);
if (process.argv.length !== 4 || !['d1', 'do'].includes(arm) || !stores[storeName]) {
  throw new Error(
    'Usage: node tests/r150-hosted/apply-remote-migrations.mjs <d1|do> <signer|deriver-a|deriver-b|signing-worker>',
  );
}

process.umask(0o077);
const store = stores[storeName];
const inventory = JSON.parse(readFileSync(path.join(runtimeRoot, 'resource-inventory.json'), 'utf8'));
const configPath = path.join(runtimeRoot, 'rendered', store.config);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const expectedName = `r150-bench-20260925-${arm}-${storeName}-db`;
const expectedWorker = `r150-bench-20260925-${arm}-${storeName === 'signer' ? 'gateway' : storeName}`;
const database = config.env?.[arm]?.d1_databases?.find((entry) => entry.binding === store.binding);
if (
  inventory.accountId !== 'ba924da36f2ffc3839e8d323000b66b4' ||
  config.account_id !== inventory.accountId ||
  config.env[arm].name !== expectedWorker ||
  database?.database_name !== expectedName ||
  database.database_id !== inventory.arms?.[arm]?.databases?.[store.inventoryKey]
) {
  throw new Error('Remote migration target does not match the isolated benchmark inventory');
}

const migrationsDirectory = path.resolve(database.migrations_dir);
if (!migrationsDirectory.startsWith(`${repoRoot}${path.sep}`)) {
  throw new Error('Migration directory escaped the repository');
}
const names = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (names.length === 0) throw new Error('No SQL migrations found');

const commonArgs = [
  'd1', 'execute', store.binding, '--remote', '--json',
  '--config', configPath, '--env', arm,
];
runWrangler([
  'd1', 'migrations', 'list', store.binding, '--remote',
  '--config', configPath, '--env', arm,
]);
let applied = readAppliedMigrations(commonArgs);
requireContiguousPrefix(names, applied);

const bundleDirectory = path.join(runtimeRoot, 'migration-imports', arm, storeName);
mkdirSync(bundleDirectory, { recursive: true, mode: 0o700 });
for (const name of names.slice(applied.length)) {
  const source = readFileSync(path.join(migrationsDirectory, name), 'utf8');
  const bundlePath = path.join(bundleDirectory, name);
  const attemptPath = path.join(bundleDirectory, `${name}.attempt.json`);
  if (existsSync(attemptPath)) {
    throw new Error(`${name} has a prior attempt; reconcile its remote ledger and schema before redispatch`);
  }
  const bundle = `${source.trimEnd()}\nINSERT INTO d1_migrations (name) VALUES ('${name}');\n`;
  writeFileSync(bundlePath, bundle, { flag: 'wx', mode: 0o600 });
  const attempt = {
    kind: 'r150_remote_migration_import_v1',
    accountId: inventory.accountId,
    databaseId: database.database_id,
    migration: name,
    sourceSha256: sha256(source),
    bundleSha256: sha256(bundle),
    startedAt: new Date().toISOString(),
  };
  writeFileSync(attemptPath, `${JSON.stringify(attempt, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  const imported = parseImportResponse(runWrangler([...commonArgs, '--file', bundlePath, '--yes']));
  if (imported.length !== 1 || imported[0].success !== true) {
    throw new Error(`${name} remote import response was not successful`);
  }
  applied = readAppliedMigrations(commonArgs);
  requireContiguousPrefix(names, applied);
  if (applied.at(-1) !== name) throw new Error(`${name} import did not commit its ledger row`);
  const completed = {
    ...attempt,
    completedAt: new Date().toISOString(),
    bookmark: imported[0].finalBookmark,
  };
  writeFileSync(attemptPath, `${JSON.stringify(completed, null, 2)}\n`, { mode: 0o600 });
  console.log(`${arm}/${storeName}: applied ${name}`);
}
console.log(`${arm}/${storeName}: ${applied.length} remote migrations verified`);

function readAppliedMigrations(commonArgs) {
  const output = runWrangler([
    ...commonArgs,
    '--command', 'SELECT name FROM d1_migrations ORDER BY id',
  ]);
  const response = JSON.parse(output);
  if (response.length !== 1 || response[0].success !== true) {
    throw new Error('Remote migration ledger read failed');
  }
  return response[0].results.map((row) => row.name);
}

function requireContiguousPrefix(names, applied) {
  for (let index = 0; index < applied.length; index += 1) {
    if (applied[index] !== names[index]) {
      throw new Error('Remote migration ledger diverges from the checked-in SQL order');
    }
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseImportResponse(output) {
  // Wrangler prints import progress before the JSON result, even with --json.
  const jsonStart = output.lastIndexOf('\n[\n');
  if (jsonStart < 0) throw new Error('Remote import returned no JSON result');
  return JSON.parse(output.slice(jsonStart + 1));
}

function runWrangler(args) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Wrangler ${args.slice(0, 3).join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}
