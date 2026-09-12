#!/usr/bin/env node

import { readFileSync } from 'node:fs';
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
  });
  const routerEnv = readEnvMap(path.join(options.localRoot, '.env.router-ab.router.local'));
  const issuedAtMs = Math.max(1, Date.now() - 1);
  const grant = await signTenantRootCreationGrantV1({
    identity: identityResult.value,
    custodyLineage: randomTenantRootCreationGrantBytesV1(16),
    grantNonce: randomTenantRootCreationGrantBytesV1(32),
    issuedAtMs,
    expiresAtMs: issuedAtMs + 300_000,
    grantKeyId: localKeys.grantAuthority.keyId,
    signingSeedB64u: localKeys.grantAuthority.signingSeedB64u,
  });
  const response = await fetch(new URL(TENANT_ROOT_CREATION_PATH, options.routerUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [INTERNAL_SERVICE_AUTH_HEADER]: requiredEnv(
        routerEnv,
        'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
      ),
    },
    body: JSON.stringify({ creation_grant_b64u: grant.grantB64u }),
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
    '  --org-id <organization-id>',
    '  --project-id <project-id>',
    '  --env-id <environment-id>',
    '  --signing-root-id <signing-root-id>',
    '  --signing-root-version <version>',
    '  [--router-url <mpc-router-url>]',
  ].join(' ');
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
