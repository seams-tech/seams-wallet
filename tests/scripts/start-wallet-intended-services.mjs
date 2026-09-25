#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appOrigin = process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4201';
const walletOrigin = process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'http://localhost:4202';
const gatewayUrl = process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100';
const runtimeRoot =
  process.env.SEAMS_INTENDED_ROUTER_AB_ROOT ||
  path.join(tmpdir(), `${path.basename(repoRoot)}-wallet-intended`);
const walletDistRoot = path.join(repoRoot, 'packages', 'wallet', 'dist');
const externalGateway = parseExternalGatewayMode();
const children = [];
let stopping = false;

await main().catch(handleFatalError);

async function main() {
  installSignalHandlers();
  if (externalGateway) assertHostedBenchmarkTarget();
  if (process.env.SEAMS_INTENDED_SKIP_BUILD !== '1') buildWalletRuntime();
  if (!externalGateway) startWalletSystem();
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
  if (externalGateway) return;
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
  runRequired('Wallet local initializer build', 'pnpm', ['run', 'build:local-tools']);
}

function startWalletSystem() {
  const child = spawn(
    process.execPath,
    [
      path.join(repoRoot, 'crates/router-ab-cloudflare/scripts/start-local-wallet-system.mjs'),
      '--root',
      runtimeRoot,
      '--app-origin',
      appOrigin,
      '--wallet-origin',
      walletOrigin,
    ],
    {
      ...childOptions(process.env),
      cwd: path.join(repoRoot, 'crates/router-ab-cloudflare'),
    },
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
    VITE_ROUTER_AB_NORMAL_SIGNING_WORKER_ID: externalGateway
      ? process.env.SEAMS_INTENDED_SIGNING_WORKER_ID
      : 'local-signing-worker',
    VITE_SEAMS_PROJECT_ENVIRONMENT_ID: externalGateway
      ? process.env.SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID
      : 'local-smoke-project:dev',
    VITE_SEAMS_PUBLISHABLE_KEY: externalGateway
      ? process.env.SEAMS_INTENDED_PUBLISHABLE_KEY
      : 'pk_local',
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
  const transport = new URL(url).protocol === 'https:' ? https : http;
  const request = transport.get(url, handleStatusResponse.bind(undefined, resolve));
  request.setTimeout(externalGateway ? 5_000 : 750, handleRequestTimeout.bind(undefined, request));
  request.once('error', resolve.bind(undefined, null));
}

function parseExternalGatewayMode() {
  const value = process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY;
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new Error('SEAMS_INTENDED_EXTERNAL_GATEWAY must be 0 or 1');
}

function assertHostedBenchmarkTarget() {
  const arm = requiredBenchmarkEnvironment('SEAMS_INTENDED_BENCHMARK_ARM');
  if (arm !== 'd1' && arm !== 'do') {
    throw new Error('SEAMS_INTENDED_BENCHMARK_ARM must be d1 or do');
  }
  const benchmarkPrefix = `r150-bench-20260925-${arm}`;
  const gatewayUrl = new URL(requiredBenchmarkEnvironment('SEAMS_INTENDED_ROUTER_URL'));
  if (
    gatewayUrl.protocol !== 'https:' ||
    gatewayUrl.hostname.split('.')[0] !== `${benchmarkPrefix}-ingress` ||
    gatewayUrl.pathname !== '/' ||
    gatewayUrl.search !== ''
  ) {
    throw new Error('Hosted benchmark Gateway URL must name the selected arm ingress');
  }
  const region = requiredBenchmarkEnvironment('SEAMS_INTENDED_PROBE_REGION');
  if (!/^[a-z0-9-]+$/u.test(region)) {
    throw new Error('SEAMS_INTENDED_PROBE_REGION must be a lowercase region label');
  }
  const runId = requiredBenchmarkEnvironment('SEAMS_INTENDED_BENCHMARK_RUN_ID');
  if (!/^[a-z0-9-]+$/u.test(runId)) {
    throw new Error('SEAMS_INTENDED_BENCHMARK_RUN_ID must be a lowercase run label');
  }
  const projectEnvironmentId = requiredBenchmarkEnvironment(
    'SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID',
  );
  const signingWorkerId = requiredBenchmarkEnvironment('SEAMS_INTENDED_SIGNING_WORKER_ID');
  if (
    !projectEnvironmentId.startsWith(benchmarkPrefix) ||
    signingWorkerId !== `${benchmarkPrefix}-signing-worker`
  ) {
    throw new Error('Hosted benchmark project and SigningWorker must be isolated R150 resources');
  }
  requiredBenchmarkEnvironment('SEAMS_INTENDED_PUBLISHABLE_KEY');
}

function requiredBenchmarkEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for hosted benchmarking`);
  return value;
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
  // Allow the Wallet system's four-second cleanup deadline to finish first.
  setTimeout(forceStopChildren.bind(undefined, exitCode), 6_000);
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

function forceStopChildren(exitCode) {
  for (const child of children) {
    if (!child.pid) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
  process.exit(exitCode);
}
