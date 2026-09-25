#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  randomTenantRootCreationGrantBytesV1,
  signTenantRootCreationGrantV1,
} from '@seams/wallet-server/cloud-host';

import { resolveLocalTenantRootKeyMaterial } from './prepare-local-runtime-config.mjs';

const INTERNAL_SERVICE_AUTH_HEADER = 'x-router-ab-internal-service-auth';
const TENANT_ROOT_CREATION_PATH = '/router-ab/internal/tenant-root/creation/v1/create';

await main().catch(handleFatalError);

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const identityResult = buildTenantRootIdentityFromAuthenticatedDeploymentV1(options.identity);
  if (!identityResult.ok) {
    throw new Error('Local tenant-root bootstrap identity is invalid');
  }
  const localKeys = resolveLocalTenantRootKeyMaterial({
    repoRoot: options.repoRoot,
    localEnvRoot: options.localRoot,
    issuerEnvPath: options.issuerEnvPath,
  });
  const routerEnv = readEnvMap(path.join(options.localRoot, '.env.router-ab.router.local'));
  const grantB64u = await resolveCreationGrant(options, identityResult.value, localKeys);
  const response = await fetch(new URL(TENANT_ROOT_CREATION_PATH, options.routerUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [INTERNAL_SERVICE_AUTH_HEADER]: requiredEnv(
        routerEnv,
        'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
      ),
    },
    body: JSON.stringify({ creation_grant_b64u: grantB64u }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Tenant-root bootstrap failed (HTTP ${response.status}): ${body}`);
  }
  const result = parseCreationResult(body);
  process.stdout.write(
    `${JSON.stringify({ kind: 'wallet_local_tenant_root_ready_v1', ...result })}\n`,
  );
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error(usage());
    values.set(name, value);
  }
  const repoRoot = process.cwd();
  return {
    repoRoot,
    localRoot: path.resolve(requiredOption(values, '--root')),
    issuerEnvPath: values.get('--issuer-env-path'),
    grantFile: values.get('--grant-file'),
    routerUrl: requiredUrl(values.get('--router-url') ?? 'http://127.0.0.1:4102'),
    identity: {
      orgId: requiredOption(values, '--org-id'),
      projectId: requiredOption(values, '--project-id'),
      envId: requiredOption(values, '--env-id'),
      signingRootId: requiredOption(values, '--signing-root-id'),
      signingRootVersion: requiredOption(values, '--signing-root-version'),
    },
  };
}

function usage() {
  return [
    'Usage: bootstrap-local-tenant-root.mjs',
    '  --root <local-runtime-directory>',
    '  [--issuer-env-path <private-issuer-env-file>]',
    '  [--grant-file <private-grant-file-inside-root>]',
    '  --org-id <organization-id>',
    '  --project-id <project-id>',
    '  --env-id <environment-id>',
    '  --signing-root-id <signing-root-id>',
    '  --signing-root-version <version>',
    '  [--router-url <mpc-router-url>]',
  ].join(' ');
}

async function resolveCreationGrant(options, identity, localKeys) {
  if (!options.grantFile) return (await signNewGrant(identity, localKeys)).grantB64u;
  const filePath = path.resolve(options.grantFile);
  const relativePath = path.relative(options.localRoot, filePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Grant file must be inside the local identity root');
  }
  if (existsSync(filePath)) {
    if ((statSync(filePath).mode & 0o077) !== 0) {
      throw new Error('Existing tenant-root grant file is exposed');
    }
    const stored = JSON.parse(readFileSync(filePath, 'utf8'));
    if (
      JSON.stringify(stored.identity) !== JSON.stringify(options.identity) ||
      stored.grantKeyId !== localKeys.grantAuthority.keyId ||
      typeof stored.grantB64u !== 'string' ||
      !stored.grantB64u
    ) {
      throw new Error('Existing tenant-root grant does not match this identity or authority');
    }
    if (!Number.isSafeInteger(stored.expiresAtMs) || Date.now() >= stored.expiresAtMs) {
      throw new Error('Tenant-root grant expired; reconcile Router state before a new attempt');
    }
    return stored.grantB64u;
  }
  const created = await signNewGrant(identity, localKeys);
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  process.umask(0o077);
  writeFileSync(filePath, `${JSON.stringify({
    identity: options.identity,
    grantKeyId: localKeys.grantAuthority.keyId,
    grantB64u: created.grantB64u,
    expiresAtMs: created.expiresAtMs,
  })}\n`, { flag: 'wx', mode: 0o600 });
  return created.grantB64u;
}

async function signNewGrant(identity, localKeys) {
  const issuedAtMs = Math.max(1, Date.now() - 1);
  const expiresAtMs = issuedAtMs + 300_000;
  const grant = await signTenantRootCreationGrantV1({
    identity,
    custodyLineage: randomTenantRootCreationGrantBytesV1(16),
    grantNonce: randomTenantRootCreationGrantBytesV1(32),
    issuedAtMs,
    expiresAtMs,
    grantKeyId: localKeys.grantAuthority.keyId,
    signingSeedB64u: localKeys.grantAuthority.signingSeedB64u,
  });
  return { grantB64u: grant.grantB64u, expiresAtMs };
}

function requiredOption(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(usage());
  return value;
}

function requiredUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('router URL must use HTTP or HTTPS');
  }
  return url.href;
}

function readEnvMap(filePath) {
  const values = new Map();
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values.set(line.slice(0, separator).trim(), unquote(line.slice(separator + 1).trim()));
  }
  return values;
}

function unquote(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function requiredEnv(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`${name} is missing from the local Router environment`);
  return value;
}

function parseCreationResult(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('Tenant-root bootstrap returned invalid JSON');
  }
  if (!isRecord(value) || !isRecord(value.status) || value.status.kind !== 'ready') {
    throw new Error('Tenant-root bootstrap did not reach ready state');
  }
  return {
    identityDigestB64u: requiredText(value.identity_digest_b64u, 'identity_digest_b64u'),
    custodyLineageB64u: requiredText(value.custody_lineage_b64u, 'custody_lineage_b64u'),
    revision: requiredPositiveInteger(value.revision, 'revision'),
    rootCommitmentB64u: requiredText(
      value.status.root_commitment_b64u,
      'status.root_commitment_b64u',
    ),
    replayed: value.replayed === true,
  };
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function requiredPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function handleFatalError(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
