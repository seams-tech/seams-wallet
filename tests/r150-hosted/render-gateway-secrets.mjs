#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareLocalHostedWalletGatewayConfig } from '../../crates/router-ab-cloudflare/scripts/prepare-local-runtime-config.mjs';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceRoot, '../..');
const identityRoot = path.join(repoRoot, '.runtime', 'r150-hosted', 'identities');
const renderedRoot = path.resolve(
  process.argv[4] ?? path.join(repoRoot, '.runtime', 'r150-hosted', 'rendered'),
);
const receiptPath = process.argv[2];
const ingressExpiresAtMs = Number(process.argv[3]);

if ((process.argv.length !== 4 && process.argv.length !== 5) || !receiptPath) {
  throw new Error('Usage: node tests/r150-hosted/render-gateway-secrets.mjs <private-tenant-root-receipts.json> <ingress-expiry-unix-ms> [ignored-rendered-directory]');
}
if (
  !Number.isSafeInteger(ingressExpiresAtMs) ||
  ingressExpiresAtMs <= Date.now() + 300_000 ||
  ingressExpiresAtMs > Date.now() + 48 * 60 * 60 * 1000
) {
  throw new Error('Ingress expiry must be between five minutes and 48 hours from now');
}
process.umask(0o077);
requireIgnoredRuntime();
const resolvedReceiptPath = path.resolve(receiptPath);
if ((statSync(resolvedReceiptPath).mode & 0o077) !== 0) {
  throw new Error('Tenant-root receipt file must be private');
}
const receipts = JSON.parse(readFileSync(resolvedReceiptPath, 'utf8'));
verifyIdentity();
const routerConfig = JSON.parse(readFileSync(
  path.join(renderedRoot, 'roles', 'router.jsonc'),
  'utf8',
));

for (const arm of ['d1', 'do']) {
  const armRoot = path.join(identityRoot, arm);
  const gatewayConfig = JSON.parse(readFileSync(
    path.join(renderedRoot, 'gateway', 'wrangler.jsonc'),
    'utf8',
  )).env[arm];
  const receipt = requireReceipt(receipts.arms?.[arm], arm);
  const deployment = staticDeployment(arm, gatewayConfig, receipt, armRoot);
  const ingressUrl = new URL(routerConfig.env[arm].vars.ROUTER_JWT_ISSUER);
  const runtime = prepareLocalHostedWalletGatewayConfig({
    repoRoot,
    localEnvRoot: armRoot,
    gatewayUrl: ingressUrl.origin,
    ceremonyPrivateJwkPath: path.join(armRoot, 'ceremony-private.jwk.json'),
    appOrigins: deployment.credential.allowedOrigins,
    deployment,
  });
  const available = readQuotedDevVars(runtime.secretPath);
  available.set('BENCHMARK_WALLET_DEPLOYMENT_JSON', JSON.stringify(deployment));
  available.set('ROUTER_AB_CEREMONY_JWT_KEY_ID', `r150-bench-20260925-${arm}-ceremony-v1`);
  verifyRenderedKeys(arm, armRoot, available, routerConfig.env[arm].vars);
  const topology = JSON.parse(requiredValue(available, 'ROUTER_AB_ECDSA_REGISTRATION_TOPOLOGY_JSON'));
  topology.signerSet.selected_server.server_id = gatewayConfig.vars.SIGNING_WORKER_ID;
  topology.signerSet.signer_set_id = `r150-bench-20260925-${arm}-signer-set-v1`;
  available.set('ROUTER_AB_ECDSA_REGISTRATION_TOPOLOGY_JSON', JSON.stringify(topology));

  const secrets = {};
  for (const name of gatewayConfig.secrets.required) {
    secrets[name] = requiredValue(available, name);
  }
  writeIfAbsentOrEqual(
    path.join(renderedRoot, 'gateway-secrets', `${arm}.json`),
    `${JSON.stringify(secrets)}\n`,
  );
  const ingressTokenPath = path.join(armRoot, 'ingress-token.secret');
  if ((statSync(ingressTokenPath).mode & 0o077) !== 0) {
    throw new Error(`${arm} ingress token file is exposed`);
  }
  writeIfAbsentOrEqual(
    path.join(renderedRoot, 'ingress-secrets', `${arm}.json`),
    `${JSON.stringify({
      BENCHMARK_ACCESS_TOKEN: requiredText(readFileSync(ingressTokenPath, 'utf8'), `${arm} ingress token`),
      BENCHMARK_EXPIRES_AT_MS: String(ingressExpiresAtMs),
    })}\n`,
  );
  writeIfAbsentOrEqual(
    path.join(renderedRoot, 'probe-values', `${arm}.json`),
    `${JSON.stringify({
      arm,
      ingressUrl: ingressUrl.origin,
      environmentId: gatewayConfig.vars.SEAMS_STAGING_ENV_ID,
      publishableKey: deployment.credential.publishableKey,
      signingWorkerId: gatewayConfig.vars.SIGNING_WORKER_ID,
      deploymentFingerprint: fingerprintDeployment(arm, receipt),
    }, null, 2)}\n`,
  );
}
console.log(`Rendered R150 Gateway, ingress, and probe inputs under ${renderedRoot}`);

function fingerprintDeployment(arm, receipt) {
  const digest = createHash('sha256');
  digest.update(JSON.stringify({ arm, receipt }));
  for (const fileName of [
    'gateway/wrangler.jsonc',
    'ingress/wrangler.jsonc',
    'roles/router.jsonc',
    'roles/deriver-a.jsonc',
    'roles/deriver-b.jsonc',
    'roles/signing-worker.jsonc',
    'roles/tenant-root-control-plane.jsonc',
  ]) {
    const config = JSON.parse(readFileSync(path.join(renderedRoot, fileName), 'utf8'));
    digest.update(JSON.stringify(config.env[arm]));
  }
  return digest.digest('hex');
}

function requireIgnoredRuntime() {
  const result = spawnSync('git', ['check-ignore', '-q', '--', renderedRoot], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    throw new Error('Rendered Gateway secrets must be written to a Git-ignored directory');
  }
}

function verifyIdentity() {
  for (const arm of ['d1', 'do']) {
    if (!existsSync(path.join(identityRoot, arm, 'identity.ready'))) {
      throw new Error(`Missing ${arm} benchmark identity`);
    }
  }
  const result = spawnSync(process.execPath, [path.join(sourceRoot, 'prepare-identities.mjs')], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  if (result.status !== 0) throw new Error('Benchmark identity fingerprint check failed');
}

function verifyRenderedKeys(arm, armRoot, available, routerVars) {
  const ceremony = JSON.parse(readFileSync(path.join(armRoot, 'ceremony-private.jwk.json'), 'utf8'));
  const jwks = JSON.parse(routerVars.ROUTER_JWT_JWKS_JSON);
  const keyId = requiredValue(available, 'ROUTER_AB_CEREMONY_JWT_KEY_ID');
  if (jwks.keys?.length !== 1 || jwks.keys[0].kid !== keyId || jwks.keys[0].x !== ceremony.x) {
    throw new Error(`${arm} Router and Gateway ceremony keys differ`);
  }
  const keyset = JSON.parse(requiredValue(available, 'ROUTER_AB_PUBLIC_KEYSET_JSON'));
  if (
    keyset.signer_envelope_hpke?.current?.deriver_a?.public_key !== routerVars.DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY ||
    keyset.signer_envelope_hpke?.current?.deriver_b?.public_key !== routerVars.DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY ||
    keyset.signer_peer_verifying_keys?.deriver_a?.verifying_key_hex !== routerVars.DERIVER_A_PEER_VERIFYING_KEY_HEX ||
    keyset.signer_peer_verifying_keys?.deriver_b?.verifying_key_hex !== routerVars.DERIVER_B_PEER_VERIFYING_KEY_HEX ||
    keyset.signing_worker_server_output_hpke?.public_key !== routerVars.SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY
  ) {
    throw new Error(`${arm} Router and Gateway public keysets differ`);
  }
}

function requireReceipt(value, arm) {
  if (
    !value ||
    value.kind !== 'wallet_local_tenant_root_ready_v1' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision <= 0
  ) {
    throw new Error(`${arm} tenant-root receipt is not ready`);
  }
  requiredText(value.rootCommitmentB64u, `${arm} root commitment`);
  return {
    identityDigestB64u: requiredText(value.identityDigestB64u, `${arm} identity digest`),
    custodyLineageB64u: requiredText(value.custodyLineageB64u, `${arm} custody lineage`),
  };
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`);
  return value.trim();
}

function staticDeployment(arm, gatewayConfig, receipt, armRoot) {
  const values = gatewayConfig.vars;
  const origins = values.HOSTED_WALLET_ORIGINS.split(',');
  if (origins.length !== 2 || !origins.every(isLoopbackOrigin)) {
    throw new Error(`${arm} Gateway origins are not the two benchmark probe origins`);
  }
  const publishableKey = readOrCreatePublishableKey(armRoot, arm);
  return {
    credential: {
      apiKeyId: `r150-bench-20260925-${arm}-publishable-key`,
      publishableKey,
      allowedOrigins: origins,
      scopes: [
        'accounts.create',
        'wallets.read',
        'wallets.auth_methods.create',
        'wallets.signers.create',
      ],
    },
    deployment: {
      orgId: values.SEAMS_STAGING_ORG_ID,
      projectId: values.SEAMS_STAGING_PROJECT_ID,
      environmentId: values.SEAMS_STAGING_ENV_ID,
      environmentKey: 'bench',
      signingRootVersion: 'default',
    },
    tenantRoot: {
      identityDigestB64u: receipt.identityDigestB64u,
      custodyLineageB64u: receipt.custodyLineageB64u,
      signingRootId: values.SEAMS_STAGING_ENV_ID,
    },
  };
}

function isLoopbackOrigin(value) {
  const url = new URL(value);
  return url.protocol === 'http:' && url.hostname === 'localhost' && url.origin === value;
}

function readOrCreatePublishableKey(armRoot, arm) {
  const filePath = path.join(armRoot, 'publishable-key.secret');
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `pk_r150_${arm}_${randomBytes(24).toString('base64url')}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  }
  if ((statSync(filePath).mode & 0o077) !== 0) {
    throw new Error(`Exposed benchmark publishable key: ${filePath}`);
  }
  return requiredText(readFileSync(filePath, 'utf8'), `${arm} publishable key`);
}

function readQuotedDevVars(filePath) {
  const values = new Map();
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const quoted = line.slice(separator + 1);
    if (!quoted.startsWith("'") || !quoted.endsWith("'")) {
      throw new Error(`Invalid generated Gateway secret entry in ${filePath}`);
    }
    values.set(line.slice(0, separator), quoted.slice(1, -1));
  }
  return values;
}

function requiredValue(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`Missing generated Gateway secret ${name}`);
  return value;
}

function writeIfAbsentOrEqual(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  if (existsSync(filePath)) {
    if ((statSync(filePath).mode & 0o077) !== 0 || readFileSync(filePath, 'utf8') !== contents) {
      throw new Error(`Existing benchmark output changed or was exposed: ${filePath}`);
    }
    return;
  }
  writeFileSync(filePath, contents, { flag: 'wx', mode: 0o600 });
}
