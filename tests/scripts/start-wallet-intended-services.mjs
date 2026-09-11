#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appOrigin = 'http://localhost:4201';
const walletOrigin = 'http://localhost:4202';
const gatewayUrl = 'http://127.0.0.1:4100';
const runtimeRoot =
  process.env.SEAMS_INTENDED_ROUTER_AB_ROOT ||
  path.join(tmpdir(), `${path.basename(repoRoot)}-wallet-intended`);
const walletDistRoot = path.join(repoRoot, 'packages', 'wallet', 'dist');
const children = [];
let stopping = false;

await main().catch(handleFatalError);

async function main() {
  installSignalHandlers();
  if (process.env.SEAMS_INTENDED_SKIP_BUILD !== '1') buildWalletRuntime();
  startWalletSystem();
  await waitForHttp(`${gatewayUrl}/readyz`, 180_000);
  startIntendedApp('app', appOrigin, 'app');
  startIntendedApp('wallet-host', walletOrigin, 'wallet-host');
  await waitForHttp(`${appOrigin}/__intended-e2e`, 120_000);
  await waitForHttp(`${walletOrigin}/wallet-service`, 120_000);
  console.log('[wallet-intended] Wallet Gateway and test origins are ready');
  await waitUntilStopped();
}

function buildWalletRuntime() {
  runRequired('Wallet SDK build', 'pnpm', ['-C', 'packages/wallet', 'run', 'build:sdk-full']);
  for (const role of [
    'signing-worker',
    'deriver-a',
    'deriver-b',
    'router',
    'tenant-root-control-plane',
  ]) {
    runRequired(`${role} Worker build`, 'pnpm', [
      '-C',
      'crates/router-ab-cloudflare',
      'run',
      `build:${role}`,
    ]);
  }
  runRequired('Wallet server build', 'pnpm', ['-C', 'packages/wallet-server', 'run', 'build']);
}

function startWalletSystem() {
  const child = spawn(
    'pnpm',
    [
      '-C',
      'crates/router-ab-cloudflare',
      'run',
      'dev:local-wallet-system',
      '--',
      '--root',
      runtimeRoot,
      '--app-origin',
      appOrigin,
      '--wallet-origin',
      walletOrigin,
    ],
    childOptions(process.env),
  );
  trackChild('Wallet system', child);
}

function startIntendedApp(label, origin, cacheName) {
  const url = new URL(origin);
  const configuredCacheRoot =
    process.env.SEAMS_INTENDED_TEST_APP_VITE_CACHE_DIR ||
    path.join(runtimeRoot, '.runtime', 'vite-app');
  const environment = {
    ...process.env,
    VITE_CACHE_DIR:
      cacheName === 'app' ? configuredCacheRoot : `${configuredCacheRoot}-${cacheName}`,
    VITE_RELAYER_URL: gatewayUrl,
    VITE_ROUTER_AB_NORMAL_SIGNING_WORKER_ID: 'local-signing-worker',
    VITE_SEAMS_PROJECT_ENVIRONMENT_ID: 'local-smoke-project:dev',
    VITE_SEAMS_PUBLISHABLE_KEY: 'pk_local',
    VITE_SEAMS_WALLET_ASSET_HOST: cacheName === 'wallet-host' ? '1' : '0',
    VITE_SEAMS_WALLET_DIST_ROOT: walletDistRoot,
    VITE_SIGNING_SESSION_PERSISTENCE_MODE: 'sealed_refresh_v1',
    VITE_WALLET_ORIGIN: walletOrigin,
  };
  const child = spawn(
    'pnpm',
    [
      '-C',
      'tests/intended-app',
      'exec',
      'vite',
      '--host',
      url.hostname,
      '--port',
      url.port,
      '--strictPort',
    ],
    childOptions(environment),
  );
  trackChild(label, child);
}

function childOptions(environment) {
  return {
    cwd: repoRoot,
    env: environment,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  };
}

function trackChild(label, child) {
  children.push(child);
  child.once('exit', handleChildExit.bind(undefined, label));
  child.once('error', handleChildError.bind(undefined, label));
}

function runRequired(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} exited with ${String(result.status ?? 'unknown')}`);
  }
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('Wallet intended services stopped during startup');
    const status = await requestStatus(url);
    if (status !== null && status >= 200 && status < 400) return;
    await delay(250);
  }
  throw new Error(`${url} did not become ready`);
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
