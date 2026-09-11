#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareLocalHostedWalletGatewayConfig } from './prepare-local-runtime-config.mjs';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const gatewayUrl = 'http://127.0.0.1:4100';
const options = parseArguments(process.argv.slice(2));
const localRoot = path.resolve(
  options.root || path.join(tmpdir(), `${path.basename(repoRoot)}-wallet-system`),
);
const gatewayStateRoot = path.join(localRoot, '.local', 'cloudflare-state', 'wallet-gateway');
const ceremonyPrivateJwkPath = path.join(
  localRoot,
  '.runtime',
  'wallet-gateway',
  'ceremony-private.jwk.json',
);
const identity = Object.freeze({
  orgId: 'org_local_wallet',
  projectId: 'local-smoke-project',
  environmentId: 'local-smoke-project:dev',
  environmentKey: 'dev',
  signingRootId: 'local-smoke-project:dev',
  signingRootVersion: 'default',
});
const children = [];
let stopping = false;

await main().catch(handleFatalError);

async function main() {
  if (options.help) {
    printUsage();
    return;
  }
  installSignalHandlers();
  mkdirSync(localRoot, { recursive: true });
  startRoleWorkers();
  await waitForHttp('http://127.0.0.1:4102/.well-known/router-ab/keyset', 120_000, true);
  await waitForFile(ceremonyPrivateJwkPath, 10_000);
  const tenantRoot = bootstrapTenantRoot();
  const deployment = localDeployment(tenantRoot);
  const runtime = prepareLocalHostedWalletGatewayConfig({
    repoRoot,
    localEnvRoot: localRoot,
    gatewayUrl,
    ceremonyPrivateJwkPath,
    appOrigins: [options.appOrigin, options.walletOrigin],
    googleOidcClientId: process.env.GOOGLE_OIDC_CLIENT_ID,
    deployment,
  });
  applySignerMigrations(runtime);
  startGateway(runtime);
  await waitForHttp(`${runtime.gatewayUrl}/readyz`, 120_000, true);
  console.log(
    JSON.stringify({
      kind: 'wallet_local_system_ready_v1',
      gatewayUrl: runtime.gatewayUrl,
      appOrigin: options.appOrigin,
      walletOrigin: options.walletOrigin,
      projectEnvironmentId: identity.environmentId,
      publishableKey: deployment.credential.publishableKey,
      signingWorkerId: 'local-signing-worker',
      root: localRoot,
    }),
  );
  await waitUntilStopped();
}

function parseArguments(args) {
  const parsed = {
    help: false,
    root: '',
    appOrigin: 'http://localhost:4001',
    walletOrigin: 'http://localhost:4002',
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    if (argument === '--root') {
      parsed.root = requiredArgumentValue(args, ++index, '--root');
      continue;
    }
    if (argument === '--app-origin') {
      parsed.appOrigin = requiredOrigin(args, ++index, '--app-origin');
      continue;
    }
    if (argument === '--wallet-origin') {
      parsed.walletOrigin = requiredOrigin(args, ++index, '--wallet-origin');
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function requiredArgumentValue(args, index, name) {
  const value = args[index];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function requiredOrigin(args, index, name) {
  const value = requiredArgumentValue(args, index, name);
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  return url.origin;
}

function printUsage() {
  console.log(
    'Usage: start-local-wallet-system.mjs [--root <runtime-directory>] [--app-origin <origin>] [--wallet-origin <origin>]',
  );
}

function startRoleWorkers() {
  const child = spawn(
    process.execPath,
    [
      path.join(repoRoot, 'crates/router-ab-cloudflare/scripts/start-local-role-workers.mjs'),
      '--root',
      localRoot,
    ],
    childOptions(),
  );
  trackChild('Wallet role Workers', child);
}

function bootstrapTenantRoot() {
  const output = runRequiredCapture('local tenant-root bootstrap', process.execPath, [
    path.join(repoRoot, 'crates/router-ab-cloudflare/scripts/bootstrap-local-tenant-root.mjs'),
    '--root',
    localRoot,
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
    'http://127.0.0.1:4102',
  ]);
  const result = JSON.parse(output);
  if (result.kind !== 'wallet_local_tenant_root_ready_v1') {
    throw new Error('local tenant-root bootstrap returned an unexpected result');
  }
  return result;
}

function localDeployment(tenantRoot) {
  return Object.freeze({
    credential: {
      apiKeyId: 'local-wallet-publishable-key',
      publishableKey: 'pk_local',
      secretKey: 'sk_local',
      allowedOrigins: [options.appOrigin, options.walletOrigin],
      scopes: [
        'accounts.create',
        'wallets.read',
        'wallets.auth_methods.create',
        'wallets.signers.create',
      ],
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

function applySignerMigrations(runtime) {
  mkdirSync(gatewayStateRoot, { recursive: true });
  runRequired(
    'Wallet signer D1 migrations',
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'migrations',
      'apply',
      runtime.signerDatabaseName,
      '--local',
      '--persist-to',
      gatewayStateRoot,
      '--config',
      runtime.configPath,
    ],
    { ...process.env, CI: 'true' },
  );
}

function startGateway(runtime) {
  const port = String(new URL(runtime.gatewayUrl).port || 80);
  const child = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      runtime.configPath,
      '--port',
      port,
      '--inspector-port',
      '4200',
      '--persist-to',
      gatewayStateRoot,
      '--env-file',
      runtime.secretPath,
      '--local',
      '--show-interactive-dev-session=false',
    ],
    childOptions(),
  );
  trackChild('Wallet Gateway', child);
}

function childOptions() {
  return {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  };
}

function trackChild(label, child) {
  children.push(child);
  child.once('exit', handleChildExit.bind(undefined, label));
  child.once('error', handleChildError.bind(undefined, label));
}

function runRequired(label, command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: repoRoot, env, stdio: 'inherit' });
  requireSuccessfulResult(label, result);
}

function runRequiredCapture(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.stderr) process.stderr.write(result.stderr);
  requireSuccessfulResult(label, result);
  return result.stdout.trim();
}

function requireSuccessfulResult(label, result) {
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} exited with ${String(result.status ?? 'unknown')}`);
  }
}

async function waitForHttp(url, timeoutMs, requireOk) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('local Wallet system stopped during startup');
    const status = await requestStatus(url);
    if (status !== null && (!requireOk || status === 200)) return;
    await delay(250);
  }
  throw new Error(`${url} did not become ready`);
}

async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('local Wallet system stopped during startup');
    if (existsSync(filePath)) return;
    await delay(50);
  }
  throw new Error(`${filePath} was not created`);
}

function requestStatus(url) {
  return new Promise(requestStatusExecutor.bind(undefined, url));
}

function requestStatusExecutor(url, resolve) {
  const request = http.get(url, handleStatusResponse.bind(undefined, resolve));
  request.setTimeout(750, handleRequestTimeout.bind(undefined, request));
  request.once('error', resolve.bind(undefined, null));
}

function handleStatusResponse(resolve, response) {
  response.resume();
  resolve(response.statusCode ?? null);
}

function handleRequestTimeout(request) {
  request.destroy();
}

function delay(milliseconds) {
  return new Promise(resolveDelay.bind(undefined, milliseconds));
}

function resolveDelay(milliseconds, resolve) {
  setTimeout(resolve, milliseconds);
}

function installSignalHandlers() {
  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);
}

function handleSigint() {
  shutdown(130);
}

function handleSigterm() {
  shutdown(143);
}

function handleChildExit(label, code, signal) {
  if (stopping) return;
  console.error(`${label} stopped (${signal || String(code ?? 'unknown')})`);
  shutdown(typeof code === 'number' && code > 0 ? code : 1);
}

function handleChildError(label, error) {
  if (stopping) return;
  console.error(`${label} failed: ${error.message}`);
  shutdown(1);
}

function handleFatalError(error) {
  if (stopping) return;
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}

function waitUntilStopped() {
  return new Promise(() => {});
}

function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopChild(child);
  setTimeout(forceStopChildren, 2_000).unref();
  process.exitCode = exitCode;
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function forceStopChildren() {
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}
