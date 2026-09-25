#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const roles = [
  'ingress',
  'gateway',
  'router',
  'deriver-a',
  'deriver-b',
  'signing-worker',
  'tenant-root-control-plane',
];
const databaseNames = new Set();
const databaseIds = new Set();
const options = parseArguments(process.argv.slice(2));

for (const arm of ['d1', 'do']) {
  const prefix = `r150-bench-20260925-${arm}-`;
  for (const role of roles) {
    const configPath = path.join(options.root, roleConfigPath(role));
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const environment = config.env?.[arm];
    requireCondition(environment, `${role}/${arm} environment is missing`);
    requireCondition(environment.name === `${prefix}${role}`, `${role}/${arm} Worker name changed`);
    requireCondition(config.preview_urls === false, `${role} preview URLs must be disabled`);
    requireCondition(environment.preview_urls === false, `${role}/${arm} preview URLs must be disabled`);
    requireCondition(config.workers_dev === (role === 'ingress'), `${role} public routing changed`);
    if (role !== 'ingress') {
      requireCondition(environment.workers_dev === false, `${role}/${arm} must remain private`);
    }
    checkBindings(environment, prefix, role);
    checkWalletObjects(environment, arm, role);
    checkSecrets(environment, role);
    checkValues(environment, prefix, role);
    if (options.ready) checkReady(environment, arm, role);
  }
}

console.log(`R150 hosted manifests: ${options.ready ? 'ready-value' : 'isolated template structure'} checks passed`);

function parseArguments(args) {
  let root = sourceRoot;
  let ready = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--ready') {
      ready = true;
      continue;
    }
    if (args[index] === '--root' && args[index + 1]) {
      root = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }
    throw new Error('Usage: node tests/r150-hosted/preflight.mjs [--root <manifest-directory>] [--ready]');
  }
  return { root, ready };
}

function roleConfigPath(role) {
  if (role === 'ingress' || role === 'gateway') return `${role}/wrangler.jsonc`;
  return `roles/${role}.jsonc`;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function isBenchWorkerName(value, prefix) {
  for (const role of roles) {
    if (value === `${prefix}${role}`) return true;
  }
  return false;
}

function checkBindings(environment, prefix, role) {
  for (const binding of environment.services ?? []) {
    requireCondition(
      isBenchWorkerName(binding.service, prefix),
      `${role} service ${binding.binding} crosses the benchmark arm`,
    );
  }
  for (const binding of environment.durable_objects?.bindings ?? []) {
    requireCondition(
      !binding.script_name || isBenchWorkerName(binding.script_name, prefix),
      `${role} object ${binding.name} crosses the benchmark arm`,
    );
  }
  for (const database of environment.d1_databases ?? []) {
    requireCondition(
      database.database_name.startsWith(prefix),
      `${role} database ${database.binding} crosses the benchmark arm`,
    );
    requireCondition(
      !databaseNames.has(database.database_name),
      `${role} database ${database.database_name} is shared`,
    );
    databaseNames.add(database.database_name);
  }
  for (const bucket of environment.r2_buckets ?? []) {
    requireCondition(
      bucket.bucket_name.startsWith(prefix),
      `${role} bucket ${bucket.binding} crosses the benchmark arm`,
    );
  }
}

function checkWalletObjects(environment, arm, role) {
  const walletClasses = {
    'deriver-a': 'RouterAbDeriverAWalletDurableObject',
    'deriver-b': 'RouterAbDeriverBWalletDurableObject',
    'signing-worker': 'RouterAbSigningWorkerWalletDurableObject',
  };
  const walletClass = walletClasses[role];
  if (!walletClass) return;
  let bound = false;
  let migrated = false;
  for (const binding of environment.durable_objects?.bindings ?? []) {
    if (binding.class_name === walletClass) bound = true;
  }
  for (const migration of environment.migrations ?? []) {
    if ((migration.new_sqlite_classes ?? []).includes(walletClass)) migrated = true;
  }
  requireCondition(bound === (arm === 'do'), `${role}/${arm} wallet object binding changed`);
  requireCondition(migrated === (arm === 'do'), `${role}/${arm} wallet object migration changed`);
}

function checkSecrets(environment, role) {
  const required = environment.secrets?.required;
  requireCondition(Array.isArray(required) && required.length > 0, `${role} secret inventory is missing`);
  requireCondition(new Set(required).size === required.length, `${role} secret inventory has duplicates`);
}

function checkValues(environment, prefix, role) {
  for (const [name, value] of Object.entries(environment.vars ?? {})) {
    if (typeof value !== 'string' || !value.includes('r150-bench-20260925-')) continue;
    requireCondition(value.includes(prefix.slice(0, -1)), `${role} variable ${name} crosses the benchmark arm`);
  }
}

function checkReady(environment, arm, role) {
  const encoded = JSON.stringify(environment);
  requireCondition(!/__R150_BENCH_[A-Z0-9_]+__/.test(encoded), `${role}/${arm} has unresolved placeholders`);
  for (const database of environment.d1_databases ?? []) {
    requireCondition(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(database.database_id),
      `${role}/${arm} database ${database.binding} has no valid D1 ID`,
    );
    requireCondition(
      !databaseIds.has(database.database_id),
      `${role}/${arm} database ${database.binding} reuses a D1 ID`,
    );
    databaseIds.add(database.database_id);
  }
  if (role === 'router') {
    requireCondition(
      new URL(environment.vars.ROUTER_JWT_ISSUER).protocol === 'https:',
      `${role}/${arm} issuer must use HTTPS`,
    );
  }
}
