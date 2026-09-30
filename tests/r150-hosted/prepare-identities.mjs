#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  prepareRouterAbStrictLocalRuntimeConfigs,
  resolveLocalTenantRootKeyMaterial,
} from '../../crates/router-ab-cloudflare/scripts/prepare-local-runtime-config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const identityRoot = path.join(repoRoot, '.runtime', 'r150-hosted', 'identities');
const initializer = path.join(
  repoRoot,
  'crates/router-ab-cloudflare/scripts/initialize-local-wallet.mjs',
);
const secretFiles = [
  '.env.router-ab.router.local',
  '.env.router-ab.deriver-a.local',
  '.env.router-ab.deriver-b.local',
  '.env.router-ab.signing-worker.local',
  'tenant-root-issuer.env',
  'ceremony-private.jwk.json',
  'ingress-token.secret',
  '.runtime/wallet-gateway/gateway-router-auth.secret',
  '.runtime/wallet-gateway/gateway-signing-worker-presign-auth.secret',
  '.runtime/wallet-gateway/router-signing-worker-ecdsa-auth.secret',
];

if (process.argv.length !== 2) {
  throw new Error('Usage: node tests/r150-hosted/prepare-identities.mjs');
}

process.umask(0o077);
requireIgnoredRuntime();
mkdirSync(identityRoot, { recursive: true, mode: 0o700 });

for (const arm of ['d1', 'do']) {
  const armRoot = path.join(identityRoot, arm);
  if (existsSync(armRoot)) {
    checkExistingIdentity(armRoot);
  } else {
    createIdentity(armRoot, arm);
  }
}

const d1Identity = readIdentityEvidence('d1');
const doIdentity = readIdentityEvidence('do');
for (const name of Object.keys(d1Identity)) {
  if (d1Identity[name] === doIdentity[name]) {
    throw new Error(`D1 and DO ${name} identities must differ`);
  }
}

for (const arm of ['d1', 'do']) {
  const digest = identityDigest(path.join(identityRoot, arm)).slice(0, 16);
  console.log(`${arm} identity ready: ${digest}`);
}

function requireIgnoredRuntime() {
  const result = spawnSync('git', ['check-ignore', '-q', '--', identityRoot], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    throw new Error('Benchmark identity directory must be Git-ignored before generating secrets');
  }
}

function createIdentity(armRoot, arm) {
  mkdirSync(armRoot, { mode: 0o700 });
  const result = spawnSync(process.execPath, [initializer, '--root', armRoot], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    throw new Error(`${arm} role identity initialization failed; inspect the incomplete private directory`);
  }
  replaceGeneratedInternalAuth(armRoot);

  const issuer = [
    `TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID=r150-bench-20260925-${arm}-issuer-v1`,
    `TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY=${randomBytes(32).toString('hex')}`,
    '',
  ].join('\n');
  writePrivateFile(path.join(armRoot, 'tenant-root-issuer.env'), issuer);

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writePrivateFile(
    path.join(armRoot, 'ceremony-private.jwk.json'),
    `${JSON.stringify(privateKey.export({ format: 'jwk' }))}\n`,
  );
  writePrivateFile(
    path.join(armRoot, 'ingress-token.secret'),
    `${randomBytes(32).toString('base64url')}\n`,
  );

  const publicJwk = publicKey.export({ format: 'jwk' });
  prepareRouterAbStrictLocalRuntimeConfigs({
    repoRoot,
    localEnvRoot: armRoot,
    tenantRootIssuerEnvPath: path.join(armRoot, 'tenant-root-issuer.env'),
    ceremonyJwksJson: JSON.stringify({
      keys: [{
        alg: 'EdDSA',
        crv: publicJwk.crv,
        kid: `r150-bench-20260925-${arm}-ceremony-v1`,
        kty: publicJwk.kty,
        use: 'sig',
        x: publicJwk.x,
      }],
    }),
  });
  writePrivateFile(path.join(armRoot, 'identity.ready'), `${identityDigest(armRoot)}\n`);
  checkExistingIdentity(armRoot);
}

function writePrivateFile(filePath, contents) {
  writeFileSync(filePath, contents, { flag: 'wx', mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function replaceGeneratedInternalAuth(armRoot) {
  const filePath = path.join(armRoot, '.env.router-ab.router.local');
  const source = readFileSync(filePath, 'utf8');
  const assignment = /^ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET=.*$/gm;
  if ((source.match(assignment) ?? []).length !== 1) {
    throw new Error('Generated Router identity has no unique internal service auth assignment');
  }
  const secret = randomBytes(32).toString('base64url');
  writeFileSync(filePath, source.replace(assignment, `ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET=${secret}`), {
    mode: 0o600,
  });
  chmodSync(filePath, 0o600);
}

function checkExistingIdentity(armRoot) {
  for (const fileName of [...secretFiles, 'identity.ready']) {
    const filePath = path.join(armRoot, fileName);
    if (!existsSync(filePath) || (statSync(filePath).mode & 0o077) !== 0) {
      throw new Error(`Incomplete or exposed benchmark identity: ${filePath}`);
    }
  }
  for (const role of ['router', 'deriver-a', 'deriver-b', 'signing-worker', 'tenant-root-control-plane']) {
    const filePath = path.join(armRoot, '.runtime', 'router-ab-strict', `.dev.vars.${role}`);
    if (!existsSync(filePath) || (statSync(filePath).mode & 0o077) !== 0) {
      throw new Error(`Incomplete or exposed benchmark role secret: ${filePath}`);
    }
  }
  if (readFileSync(path.join(armRoot, 'identity.ready'), 'utf8').trim() !== identityDigest(armRoot)) {
    throw new Error(`Benchmark identity changed after initialization: ${armRoot}`);
  }
}

function readIdentityEvidence(arm) {
  return identityEvidenceAt(path.join(identityRoot, arm));
}

function identityDigest(armRoot) {
  return createHash('sha256')
    .update(JSON.stringify(identityEvidenceAt(armRoot)))
    .digest('hex');
}

function identityEvidenceAt(armRoot) {
  const keys = resolveLocalTenantRootKeyMaterial({
    repoRoot,
    localEnvRoot: armRoot,
    issuerEnvPath: path.join(armRoot, 'tenant-root-issuer.env'),
  });
  const routerEnv = readEnv(path.join(armRoot, '.env.router-ab.router.local'));
  const deriverAEnv = readEnv(path.join(armRoot, '.env.router-ab.deriver-a.local'));
  const deriverBEnv = readEnv(path.join(armRoot, '.env.router-ab.deriver-b.local'));
  const signingWorkerEnv = readEnv(path.join(armRoot, '.env.router-ab.signing-worker.local'));
  const internalAuth = routerEnv.get('ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET');
  if (!internalAuth) throw new Error(`Missing internal service authentication at ${armRoot}`);
  const ceremonyJwk = JSON.parse(readFileSync(path.join(armRoot, 'ceremony-private.jwk.json'), 'utf8'));
  if (ceremonyJwk.kty !== 'OKP' || ceremonyJwk.crv !== 'Ed25519' || !ceremonyJwk.x || !ceremonyJwk.d) {
    throw new Error(`Missing ceremony key at ${armRoot}`);
  }
  return {
    issuer: keys.issuer.verifyingKeysJson,
    deriverA: requiredEnvValue(routerEnv, 'DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY'),
    deriverB: requiredEnvValue(routerEnv, 'DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY'),
    deriverAPeer: requiredEnvValue(deriverAEnv, 'DERIVER_A_PEER_VERIFYING_KEY'),
    deriverBPeer: requiredEnvValue(deriverBEnv, 'DERIVER_B_PEER_VERIFYING_KEY'),
    signingWorker: requiredEnvValue(signingWorkerEnv, 'SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY'),
    ceremony: ceremonyJwk.x,
    internalAuthDigest: createHash('sha256').update(internalAuth).digest('hex'),
    ingressTokenDigest: createHash('sha256')
      .update(readFileSync(path.join(armRoot, 'ingress-token.secret')))
      .digest('hex'),
    gatewayRouterAuthDigest: secretDigest(armRoot, 'gateway-router-auth.secret'),
    gatewaySigningWorkerAuthDigest: secretDigest(
      armRoot,
      'gateway-signing-worker-presign-auth.secret',
    ),
    routerSigningWorkerAuthDigest: secretDigest(
      armRoot,
      'router-signing-worker-ecdsa-auth.secret',
    ),
  };
}

function requiredEnvValue(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`Missing generated ${name}`);
  return value;
}

function secretDigest(armRoot, fileName) {
  const filePath = path.join(armRoot, '.runtime', 'wallet-gateway', fileName);
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readEnv(filePath) {
  const values = new Map();
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}
