#!/usr/bin/env node

// Local Wallet system on the VM reference.
//
// The Router, Deriver A, Deriver B, SigningWorker and tenant-root control
// plane run as ordinary processes with role-private SQLite; the Wallet Gateway
// runs on Node with its shared SQLite store. No Cloudflare service, Wrangler or
// Miniflare is involved. The tenant root is created by the same ceremony the
// Cloudflare deployment runs, from a grant the operator signs.
//
// Prints the same `wallet_local_system_ready_v1` line as the Worker launcher,
// so the browser suites can run against either.

import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareLocalHostedWalletGatewayConfig } from '../../router-ab-cloudflare/scripts/prepare-local-runtime-config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const devCrate = path.join(repoRoot, 'crates', 'router-ab-dev');
const walletServerRoot = path.join(repoRoot, 'packages', 'wallet-server');
const gatewayUrl = process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100';
const portOffset = Number(process.env.SEAMS_LOCAL_PORT_OFFSET || 0);
const urls = Object.freeze({
  router: `http://127.0.0.1:${4102 + portOffset}`,
  deriverA: `http://127.0.0.1:${4103 + portOffset}`,
  deriverB: `http://127.0.0.1:${4104 + portOffset}`,
  signingWorker: `http://127.0.0.1:${4105 + portOffset}`,
  controlPlane: `http://127.0.0.1:${4106 + portOffset}`,
});
const ENV_FILES = Object.freeze({
  router: '.env.router-ab.router.local',
  'deriver-a': '.env.router-ab.deriver-a.local',
  'deriver-b': '.env.router-ab.deriver-b.local',
  'signing-worker': '.env.router-ab.signing-worker.local',
  controlPlane: '.env.router-ab.tenant-root-control-plane.local',
  operator: '.env.router-ab.tenant-root-operator.local',
});
const options = parseArguments(process.argv.slice(2));
const root = path.resolve(
  options.root ||
    path.join(tmpdir(), `${path.basename(repoRoot)}-vm-wallet-${randomBytes(8).toString('hex')}`),
);
const gatewayRuntime = path.join(root, '.runtime', 'wallet-gateway');
const ceremonyPrivateJwkPath = path.join(gatewayRuntime, 'ceremony-private.jwk.json');
const identity = Object.freeze({
  orgId: options.orgId,
  projectId: options.projectId,
  environmentId: options.environmentId,
  environmentKey: 'dev',
  signingRootId: options.signingRootId,
  signingRootVersion: 'default',
});
const children = [];
let stopping = false;

await main().catch(handleFatalError);

async function main() {
  installSignalHandlers();
  mkdirSync(gatewayRuntime, { recursive: true, mode: 0o700 });
  if (process.env.SEAMS_VM_SKIP_BUILD !== '1') {
    // The local Router ends a registration burned when the local Gateway's
    // terminal-failure fault asks; no other build has that.
    runRequired('VM role binaries', 'cargo', [
      'build',
      '--manifest-path',
      path.join(devCrate, 'Cargo.toml'),
      '--bins',
      '--features',
      'local-intended-router-burn',
    ]);
  }
  materializeRoleEnvs();
  for (const role of ['router', 'deriver-a', 'deriver-b', 'signing-worker']) {
    runRequired(`${role} migration`, workerBinary(), [
      '--role',
      role,
      '--env',
      ENV_FILES[role],
      '--migrate',
    ], { cwd: root });
  }
  console.log('Starting VM Wallet roles...');
  for (const role of ['router', 'deriver-a', 'deriver-b', 'signing-worker']) {
    startProcess(role, workerBinary(), ['--role', role, '--env', ENV_FILES[role]]);
  }
  startProcess('tenant-root-control-plane', binary('router_ab_local_tenant_root_control_plane'), [
    '--env',
    ENV_FILES.controlPlane,
  ]);
  for (const url of Object.values(urls)) await waitForHttp(`${url}/healthz`, 60_000);

  console.log('Provisioning tenant root...');
  const tenantRoot = bootstrapTenantRoot();
  // Each role's read-only deployment check, as its operator runs it.
  for (const role of ['router', 'deriver-a', 'deriver-b', 'signing-worker']) {
    runDeploymentCheck(role, workerBinary(), ['--role', role, '--env', ENV_FILES[role], '--check'], {
      cwd: root,
    });
  }
  const deployment = localDeployment(tenantRoot);
  const runtime = prepareLocalHostedWalletGatewayConfig({
    repoRoot,
    localEnvRoot: root,
    gatewayUrl,
    ceremonyPrivateJwkPath,
    appOrigins: [options.appOrigin, options.walletOrigin],
    googleOidcClientId: process.env.GOOGLE_OIDC_CLIENT_ID,
    deployment,
  });
  const varsPath = writeNodeGatewayVars(runtime.secretPath);
  const gatewayEnv = {
    ...process.env,
    TSX_TSCONFIG_PATH: path.join(walletServerRoot, 'tsconfig.json'),
    WALLET_GATEWAY_VARS_FILE: varsPath,
    WALLET_GATEWAY_DATABASE_PATH: path.join(gatewayRuntime, 'gateway.sqlite'),
    WALLET_GATEWAY_LISTEN: new URL(gatewayUrl).host,
    WALLET_GATEWAY_ROUTER_URL: urls.router,
    WALLET_GATEWAY_SIGNING_WORKER_URL: urls.signingWorker,
    WALLET_GATEWAY_SIGNER_WASM_PATH: path.join(
      repoRoot,
      'wasm',
      'near_signer',
      'pkg',
      'wasm_signer_worker_bg.wasm',
    ),
    WALLET_GATEWAY_MIGRATIONS_DIR: path.join(walletServerRoot, 'migrations', 'd1-signer'),
  };
  const gatewayMain = path.join(walletServerRoot, 'src', 'router', 'node', 'nodeHostedWalletGatewayMain.ts');
  runRequired('Wallet Gateway migrations', process.execPath, ['--import', 'tsx', gatewayMain, 'migrate'], {
    cwd: walletServerRoot,
    env: gatewayEnv,
  });
  runDeploymentCheck('gateway', process.execPath, ['--import', 'tsx', gatewayMain, 'check'], {
    cwd: walletServerRoot,
    env: gatewayEnv,
  });
  console.log('Starting Wallet Gateway on Node...');
  // The local Gateway: the hosted Gateway plus the intended-suite transport
  // faults, as the local Worker launcher serves it.
  startProcess('wallet-gateway', process.execPath, ['--import', 'tsx', gatewayMain, 'serve-local'], {
    cwd: walletServerRoot,
    env: gatewayEnv,
  });
  await waitForHttp(`${gatewayUrl}/readyz`, 120_000, true);
  console.log(
    JSON.stringify({
      kind: 'wallet_local_system_ready_v1',
      host: 'vm',
      gatewayUrl,
      appOrigin: options.appOrigin,
      walletOrigin: options.walletOrigin,
      projectEnvironmentId: identity.environmentId,
      publishableKey: deployment.credential.publishableKey,
      signingWorkerId: 'local-signing-worker',
      root,
    }),
  );
  await new Promise(() => {});
}

/**
 * Generates every role's env with the Rust materializer, then places the
 * roles on their local ports. The Router's JWT issuer is the Gateway, and it
 * trusts the Gateway's ceremony key, which is minted here as the Worker
 * launcher mints it.
 */
function materializeRoleEnvs() {
  runRequired('VM env materialization', binary('router_ab_local_init'), [
    '--root',
    root,
    '--force',
  ]);
  const placement = [
    ['http://127.0.0.1:4100', urls.router],
    ['http://127.0.0.1:4103', urls.deriverA],
    ['http://127.0.0.1:4104', urls.deriverB],
    ['http://127.0.0.1:4105', urls.signingWorker],
    ['http://127.0.0.1:4106', urls.controlPlane],
  ];
  for (const file of Object.values(ENV_FILES)) {
    const filePath = path.join(root, file);
    let contents = readFileSync(filePath, 'utf8');
    for (const [from, to] of placement) contents = contents.split(from).join(to);
    writeFileSync(filePath, contents, { mode: 0o600 });
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(ceremonyPrivateJwkPath, `${JSON.stringify(privateKey.export({ format: 'jwk' }))}\n`, {
    mode: 0o600,
  });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const routerPath = path.join(root, ENV_FILES.router);
  const routerEnv = setEnvValues(readFileSync(routerPath, 'utf8'), {
    ROUTER_JWT_ISSUER: gatewayUrl,
    ROUTER_JWT_AUDIENCE: 'router-ab',
    ROUTER_JWT_JWKS_JSON: JSON.stringify({
      keys: [
        { alg: 'EdDSA', crv: 'Ed25519', kid: 'local-router-ab-r1', kty: 'OKP', use: 'sig', x: publicJwk.x },
      ],
    }),
  });
  writeFileSync(routerPath, routerEnv, { mode: 0o600 });
  // The Gateway reads its Gateway-to-Router credential from this file; the
  // Router was generated with it.
  const gatewayToRouter = readEnvValue(routerEnv, 'ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET');
  const secretPath = path.join(gatewayRuntime, 'gateway-router-auth.secret');
  writeFileSync(secretPath, `${gatewayToRouter}\n`, { mode: 0o600 });
  chmodSync(secretPath, 0o600);
  // Likewise its presignature-session credential, which the SigningWorker
  // was generated with.
  const signingWorkerEnv = readFileSync(path.join(root, ENV_FILES['signing-worker']), 'utf8');
  const presign = readEnvValue(signingWorkerEnv, 'ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET');
  const presignPath = path.join(gatewayRuntime, 'gateway-signing-worker-presign-auth.secret');
  writeFileSync(presignPath, `${presign}\n`, { mode: 0o600 });
  chmodSync(presignPath, 0o600);
}

function bootstrapTenantRoot() {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'crates', 'router-ab-cloudflare', 'scripts', 'bootstrap-local-tenant-root.mjs'),
      '--root',
      root,
      '--grant-authority-env',
      path.join(root, ENV_FILES.operator),
      '--org-id',
      identity.orgId,
      '--project-id',
      identity.projectId,
      '--env-id',
      identity.environmentId,
      '--signing-root-id',
      identity.signingRootId,
      '--signing-root-version',
      identity.signingRootVersion,
      '--router-url',
      urls.router,
    ],
    { cwd: path.join(repoRoot, 'crates', 'router-ab-cloudflare'), encoding: 'utf8' },
  );
  if (result.stderr) process.stderr.write(result.stderr);
  requireSuccess('tenant-root bootstrap', result);
  const ready = JSON.parse(result.stdout.trim());
  if (ready.kind !== 'wallet_local_tenant_root_ready_v1') {
    throw new Error('tenant-root bootstrap returned an unexpected result');
  }
  return ready;
}

function localDeployment(tenantRoot) {
  return Object.freeze({
    credential: {
      apiKeyId: 'local-wallet-publishable-key',
      publishableKey: options.publishableKey,
      secretKey: `sk_local_${randomBytes(24).toString('base64url')}`,
      allowedOrigins: [options.appOrigin, options.walletOrigin],
      scopes: ['accounts.create', 'wallets.read', 'wallets.auth_methods.create', 'wallets.signers.create'],
    },
    deployment: {
      orgId: identity.orgId,
      projectId: identity.projectId,
      environmentId: identity.environmentId,
      environmentKey: identity.environmentKey,
      signingRootVersion: identity.signingRootVersion,
    },
    tenantRoot: {
      identityDigestB64u: tenantRoot.identityDigestB64u,
      custodyLineageB64u: tenantRoot.custodyLineageB64u,
      signingRootId: identity.signingRootId,
    },
  });
}

/**
 * The Node host reads one vars file: the Gateway's non-secret Wrangler vars
 * plus the generated secrets. Prewarm keeps Worker isolates warm and has no
 * VM counterpart, so it is off here.
 */
function writeNodeGatewayVars(secretPath) {
  const toml = readFileSync(path.join(walletServerRoot, 'wrangler.local-hosted-wallet-gateway.toml'), 'utf8');
  const vars = tomlVarsSection(toml);
  vars.ROUTER_AB_PREWARM_ENABLED = 'false';
  const lines = Object.entries(vars).map(([key, value]) => `${key}='${value}'`);
  const contents = `${lines.join('\n')}\n${readFileSync(secretPath, 'utf8')}`;
  const varsPath = path.join(gatewayRuntime, 'node-gateway.vars');
  writeFileSync(varsPath, contents, { mode: 0o600 });
  return varsPath;
}

function tomlVarsSection(toml) {
  const vars = {};
  let inVars = false;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inVars = line === '[vars]';
      continue;
    }
    if (!inVars || !line || line.startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)\s*=\s*"(.*)"$/.exec(line);
    if (!match) throw new Error(`unsupported Gateway var line: ${line}`);
    vars[match[1]] = match[2];
  }
  return vars;
}

function setEnvValues(contents, values) {
  const seen = new Set();
  const lines = contents.split(/\r?\n/).map((line) => {
    const separator = line.indexOf('=');
    const key = separator > 0 ? line.slice(0, separator) : '';
    if (!(key in values)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  return `${lines.filter((line, index) => line || index < lines.length - 1).join('\n')}\n`;
}

function readEnvValue(contents, key) {
  for (const line of contents.split(/\r?\n/)) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1);
  }
  throw new Error(`${key} is missing`);
}

function workerBinary() {
  return binary('router_ab_local_worker');
}

function binary(name) {
  const built = path.join(devCrate, 'target', 'debug', name);
  if (!existsSync(built)) throw new Error(`${built} is missing; build router-ab-dev first`);
  return built;
}

function startProcess(label, command, args, spawnOptions = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    ...spawnOptions,
  });
  children.push(child);
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${label} stopped (${signal || String(code ?? 'unknown')})`);
    shutdown(typeof code === 'number' && code > 0 ? code : 1);
  });
  child.once('error', (error) => {
    if (stopping) return;
    console.error(`${label} failed: ${error.message}`);
    shutdown(1);
  });
}

/**
 * Runs one process's read-only deployment check; a failed check stops
 * startup. The outcome goes to stderr, which the browser suites keep.
 */
function runDeploymentCheck(role, command, args, spawnOptions) {
  const result = spawnSync(command, args, { ...spawnOptions, encoding: 'utf8' });
  if (result.error) throw new Error(`${role} deployment check failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    throw new Error(`${role} deployment check failed`);
  }
  process.stderr.write(`${JSON.stringify({ kind: 'wallet_vm_deployment_check_v1', role, passed: true })}\n`);
}

function runRequired(label, command, args, spawnOptions = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', ...spawnOptions });
  requireSuccess(label, result);
}

function requireSuccess(label, result) {
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} exited with ${String(result.status ?? 'unknown')}`);
}

async function waitForHttp(url, timeoutMs, requireOk = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('VM Wallet system stopped during startup');
    const status = await requestStatus(url);
    if (status !== null && (!requireOk || status === 200)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not become ready`);
}

function requestStatus(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode ?? null);
    });
    request.setTimeout(750, () => request.destroy());
    request.once('error', () => resolve(null));
  });
}

function parseArguments(args) {
  const parsed = {
    root: '',
    appOrigin: 'http://localhost:4001',
    walletOrigin: 'http://localhost:4002',
    orgId: 'org_local_wallet',
    projectId: 'local-smoke-project',
    environmentId: 'local-smoke-project:dev',
    signingRootId: 'local-smoke-project:dev',
    publishableKey: 'pk_local',
  };
  const flags = {
    '--root': 'root',
    '--app-origin': 'appOrigin',
    '--wallet-origin': 'walletOrigin',
    '--org-id': 'orgId',
    '--project-id': 'projectId',
    '--environment-id': 'environmentId',
    '--signing-root-id': 'signingRootId',
    '--publishable-key': 'publishableKey',
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    const field = flags[argument];
    if (!field || !args[index + 1]) {
      throw new Error(`Usage: start-vm-wallet-system.mjs ${Object.keys(flags).map((flag) => `[${flag} <value>]`).join(' ')}`);
    }
    parsed[field] = args[++index];
  }
  return parsed;
}

function installSignalHandlers() {
  process.once('SIGINT', () => shutdown(130));
  process.once('SIGTERM', () => shutdown(143));
}

function handleFatalError(error) {
  if (stopping) return;
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}

function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(exitCode), 2_000);
  process.exitCode = exitCode;
}
