#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceRoot, '../..');
const identityRoot = path.join(repoRoot, '.runtime', 'r150-hosted', 'identities');
const outputRoot = path.resolve(
  process.argv[3] ?? path.join(repoRoot, '.runtime', 'r150-hosted', 'rendered'),
);
const accountId = 'ba924da36f2ffc3839e8d323000b66b4';
const roles = [
  'ingress',
  'gateway',
  'router',
  'deriver-a',
  'deriver-b',
  'signing-worker',
  'tenant-root-control-plane',
];
const publicAssignments = {
  CEREMONY_JWKS_JSON: ['router', 'ROUTER_JWT_JWKS_JSON'],
  DERIVER_A_BACKUP_HPKE_PUBLIC_KEY: ['deriver-a', 'DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_HPKE_PUBLIC_KEY'],
  DERIVER_A_BACKUP_PROVIDER_ID: ['deriver-a', 'DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_PROVIDER_ID'],
  DERIVER_A_CREATION_KEY_ID: ['deriver-a', 'DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY_ID'],
  DERIVER_A_CUSTODY_VERIFYING_KEY: ['tenant-root-control-plane', 'DERIVER_A_CUSTODY_AUTHORITY_VERIFYING_KEY_HEX'],
  DERIVER_A_D1_KEK_PUBLIC_KEY: ['deriver-a', 'DERIVER_ROLE_PRIVATE_D1_KEK_PUBLIC_KEY'],
  DERIVER_A_HPKE_PUBLIC_KEY: ['router', 'DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY'],
  DERIVER_A_ONLINE_HPKE_PUBLIC_KEY: ['deriver-a', 'DERIVER_A_TENANT_ROOT_ONLINE_HPKE_PUBLIC_KEY'],
  DERIVER_A_ONLINE_KEY_REF: ['deriver-a', 'DERIVER_A_TENANT_ROOT_ONLINE_EPOCH_WRAPPING_KEY_REF'],
  DERIVER_A_PEER_VERIFYING_KEY: ['router', 'DERIVER_A_PEER_VERIFYING_KEY_HEX'],
  DERIVER_B_BACKUP_HPKE_PUBLIC_KEY: ['deriver-b', 'DERIVER_B_TENANT_ROOT_MANAGED_BACKUP_HPKE_PUBLIC_KEY'],
  DERIVER_B_BACKUP_PROVIDER_ID: ['deriver-b', 'DERIVER_B_TENANT_ROOT_MANAGED_BACKUP_PROVIDER_ID'],
  DERIVER_B_CREATION_KEY_ID: ['deriver-b', 'DERIVER_B_TENANT_ROOT_CREATION_SIGNING_KEY_ID'],
  DERIVER_B_CUSTODY_VERIFYING_KEY: ['tenant-root-control-plane', 'DERIVER_B_CUSTODY_AUTHORITY_VERIFYING_KEY_HEX'],
  DERIVER_B_D1_KEK_PUBLIC_KEY: ['deriver-b', 'DERIVER_ROLE_PRIVATE_D1_KEK_PUBLIC_KEY'],
  DERIVER_B_HPKE_PUBLIC_KEY: ['router', 'DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY'],
  DERIVER_B_ONLINE_HPKE_PUBLIC_KEY: ['deriver-b', 'DERIVER_B_TENANT_ROOT_ONLINE_HPKE_PUBLIC_KEY'],
  DERIVER_B_ONLINE_KEY_REF: ['deriver-b', 'DERIVER_B_TENANT_ROOT_ONLINE_EPOCH_WRAPPING_KEY_REF'],
  DERIVER_B_PEER_VERIFYING_KEY: ['router', 'DERIVER_B_PEER_VERIFYING_KEY_HEX'],
  GRANT_KEYS_JSON: ['router', 'TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON'],
  ISSUER_KEYS_JSON: ['router', 'TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON'],
  ISSUER_KEY_ID: ['tenant-root-control-plane', 'TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID'],
  OPERATIONS_INCIDENT_VERIFYING_KEY: ['tenant-root-control-plane', 'OPERATIONS_INCIDENT_VERIFYING_KEY_HEX'],
  RECOVERY_TRUST_BUNDLE_JSON: ['tenant-root-control-plane', 'TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON'],
  ROLE_KEYS_JSON: ['router', 'ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON'],
  SIGNING_WORKER_D1_KEK_PUBLIC_KEY: ['signing-worker', 'SIGNING_WORKER_PRIVATE_D1_KEK_PUBLIC_KEY'],
  SIGNING_WORKER_HPKE_PUBLIC_KEY: ['signing-worker', 'SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY'],
};

const inventoryPath = process.argv[2];
if ((process.argv.length !== 3 && process.argv.length !== 4) || !inventoryPath) {
  throw new Error('Usage: node tests/r150-hosted/render-manifests.mjs <private-resource-inventory.json> [ignored-output-directory]');
}
process.umask(0o077);
requireIgnoredRuntime();
const inventory = JSON.parse(readFileSync(path.resolve(inventoryPath), 'utf8'));
if (inventory.accountId !== accountId) {
  throw new Error('Benchmark inventory targets a different Cloudflare account');
}
for (const arm of ['d1', 'do']) {
  if (!existsSync(path.join(identityRoot, arm, 'identity.ready'))) {
    throw new Error(`Generate ${arm} identity before rendering manifests`);
  }
}
verifyIdentity();

const replacements = {
  d1: buildReplacements('d1', inventory),
  do: buildReplacements('do', inventory),
};
for (const role of roles) {
  const relativePath = roleConfigPath(role);
  const sourcePath = path.join(sourceRoot, relativePath);
  const config = JSON.parse(readFileSync(sourcePath, 'utf8'));
  normalizePaths(config, path.dirname(sourcePath));
  config.account_id = accountId;
  const rendered = replacePlaceholders(config, replacements);
  writeIfAbsentOrEqual(path.join(outputRoot, relativePath), `${JSON.stringify(rendered, null, 2)}\n`);
  if (role !== 'ingress' && role !== 'gateway') {
    for (const arm of ['d1', 'do']) {
      writeRoleSecrets(role, arm, rendered.env[arm].secrets.required);
    }
  }
}
console.log(`Rendered isolated R150 manifests and role secret bundles under ${outputRoot}`);

function requireIgnoredRuntime() {
  const result = spawnSync('git', ['check-ignore', '-q', '--', outputRoot], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  if (result.status !== 0) throw new Error('Rendered benchmark directory must be Git-ignored');
}

function verifyIdentity() {
  const result = spawnSync(process.execPath, [path.join(sourceRoot, 'prepare-identities.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Benchmark identities failed their stability check');
}

function buildReplacements(arm, inventory) {
  const armInventory = inventory.arms?.[arm];
  if (!armInventory) throw new Error(`Missing ${arm} resource inventory`);
  const ingressUrl = new URL(armInventory.ingressUrl);
  if (
    ingressUrl.protocol !== 'https:' ||
    !ingressUrl.hostname.startsWith(`r150-bench-20260925-${arm}-ingress.`) ||
    ingressUrl.pathname !== '/' ||
    ingressUrl.search ||
    ingressUrl.hash
  ) {
    throw new Error(`${arm} ingress URL must name the isolated HTTPS Worker`);
  }
  const prefix = `__R150_BENCH_${arm.toUpperCase()}_`;
  const values = {
    [`${prefix}INGRESS_URL__`]: ingressUrl.origin,
    [`${prefix}SIGNER_DB_ID__`]: requiredDatabaseId(armInventory.databases?.signer, `${arm} signer`),
    [`${prefix}DERIVER_A_DB_ID__`]: requiredDatabaseId(armInventory.databases?.deriverA, `${arm} Deriver A`),
    [`${prefix}DERIVER_B_DB_ID__`]: requiredDatabaseId(armInventory.databases?.deriverB, `${arm} Deriver B`),
    [`${prefix}SIGNING_WORKER_DB_ID__`]: requiredDatabaseId(armInventory.databases?.signingWorker, `${arm} SigningWorker`),
  };
  const roleVars = new Map();
  for (const [placeholder, [role, variable]] of Object.entries(publicAssignments)) {
    if (!roleVars.has(role)) roleVars.set(role, readRoleVars(arm, role));
    const value = roleVars.get(role).get(variable);
    if (typeof value !== 'string' || !value) {
      throw new Error(`Missing ${arm} ${role} public value ${variable}`);
    }
    values[`${prefix}${placeholder}__`] = value;
  }
  return values;
}

function requiredDatabaseId(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error(`${label} requires an inventoried D1 database ID`);
  }
  return value;
}

function readRoleVars(arm, role) {
  const filePath = path.join(
    identityRoot,
    arm,
    '.runtime',
    'router-ab-strict',
    `wrangler.${role}.toml`,
  );
  const values = new Map();
  let inVars = false;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '[vars]') {
      inVars = true;
      continue;
    }
    if (line.trim().startsWith('[')) inVars = false;
    if (!inVars) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match) values.set(match[1], JSON.parse(match[2]));
  }
  return values;
}

function roleConfigPath(role) {
  if (role === 'ingress' || role === 'gateway') return `${role}/wrangler.jsonc`;
  return `roles/${role}.jsonc`;
}

function normalizePaths(config, sourceDirectory) {
  if (config.$schema) config.$schema = path.resolve(sourceDirectory, config.$schema);
  if (config.main) config.main = path.resolve(sourceDirectory, config.main);
  for (const arm of ['d1', 'do']) {
    const environment = config.env[arm];
    if (environment.main) environment.main = path.resolve(sourceDirectory, environment.main);
    for (const database of environment.d1_databases ?? []) {
      database.migrations_dir = path.resolve(sourceDirectory, database.migrations_dir);
    }
  }
}

function replacePlaceholders(value, replacements) {
  if (typeof value === 'string') {
    let rendered = value;
    for (const match of value.matchAll(/__R150_BENCH_(D1|DO)_[A-Z0-9_]+__/g)) {
      const placeholder = match[0];
      const replacement = replacements[match[1].toLowerCase()][placeholder];
      if (replacement === undefined) throw new Error(`Unmapped benchmark placeholder ${placeholder}`);
      rendered = rendered.replaceAll(placeholder, replacement);
    }
    return rendered;
  }
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) result.push(replacePlaceholders(item, replacements));
    return result;
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = replacePlaceholders(item, replacements);
    }
    return result;
  }
  return value;
}

function writeRoleSecrets(role, arm, requiredNames) {
  const filePath = path.join(
    identityRoot,
    arm,
    '.runtime',
    'router-ab-strict',
    `.dev.vars.${role}`,
  );
  const available = new Map();
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) available.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const secrets = {};
  for (const name of requiredNames) {
    const value = available.get(name);
    if (!value) throw new Error(`${arm}/${role} is missing secret ${name}`);
    secrets[name] = value;
  }
  writeIfAbsentOrEqual(
    path.join(outputRoot, 'role-secrets', arm, `${role}.json`),
    `${JSON.stringify(secrets)}\n`,
  );
}

function writeIfAbsentOrEqual(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  if (existsSync(filePath)) {
    if ((statSync(filePath).mode & 0o077) !== 0) {
      throw new Error(`Existing benchmark output is exposed: ${filePath}`);
    }
    if (readFileSync(filePath, 'utf8') !== contents) {
      throw new Error(`Existing benchmark output changed; inspect before replacing ${filePath}`);
    }
    return;
  }
  writeFileSync(filePath, contents, { flag: 'wx', mode: 0o600 });
}
