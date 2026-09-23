#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const exampleRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const appOrigin = 'http://localhost:4001';
const walletOrigin = 'http://localhost:4002';
const gatewayUrl = 'http://localhost:4101';
const rawGatewayUrl = 'http://127.0.0.1:4100';
const controllerOrigin = 'http://127.0.0.1:4203';
const options = parseArguments(process.argv.slice(2));
const children = [];
let workspaceState = { kind: 'empty' };
let provisioningPromise = null;
let stopping = false;
let controllerServer = null;

await main().catch(handleFatalError);

async function main() {
  if (options.help) {
    printUsage();
    return;
  }
  installSignalHandlers();
  if (!options.skipBuild) {
    runRequired('public Wallet SDK build', 'pnpm', ['-C', 'packages/wallet', 'build:sdk']);
  }
  controllerServer = startController();
  startVite('Wallet Console Lite', 4201, false);
  startVite('Wallet asset host', 4202, true);
  startDocs();
  startCaddy();
  await Promise.all([
    waitForHttp(`${controllerOrigin}/healthz`, 60_000),
    waitForHttp('http://localhost:4201', 60_000),
    waitForHttp('http://localhost:4202/wallet-service', 60_000),
    waitForHttp('http://localhost:4006/docs/', 60_000),
  ]);
  console.log(`Wallet site and Console Lite: ${appOrigin}`);
  console.log('Wallet docs: http://docs.localhost:4003/docs/');
  console.log(`Hosted Wallet origin: ${walletOrigin}`);
  console.log(`Wallet Gateway proxy: ${gatewayUrl}`);
  await waitUntilStopped();
}

function parseArguments(args) {
  const parsed = { help: false, skipBuild: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    if (argument === '--skip-build') {
      parsed.skipBuild = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function printUsage() {
  console.log('Usage: pnpm site [--skip-build]');
}

function startController() {
  const server = http.createServer(handleControllerRequest);
  server.listen(4203, '127.0.0.1');
  server.once('error', handleFatalError);
  return server;
}

async function handleControllerRequest(request, response) {
  try {
    const pathname = new URL(request.url || '/', controllerOrigin).pathname;
    if (request.method === 'GET' && pathname === '/healthz') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (!['GET', 'POST'].includes(request.method) || pathname !== '/__local-workspace') {
      sendJson(response, 404, { kind: 'failed', message: 'Route not found' });
      return;
    }
    if (
      (request.method === 'POST' || request.headers.origin) &&
      request.headers.origin !== appOrigin
    ) {
      sendJson(response, 403, { kind: 'failed', message: 'Request origin is not allowed' });
      return;
    }
    if (request.method === 'GET') {
      const current = provisioningPromise ? await provisioningPromise : workspaceState;
      sendJson(response, 200, current);
      return;
    }
    const input = parseWorkspaceInput(await readJsonBody(request));
    const result = await provisionWorkspace(input);
    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Local workspace setup failed';
    const failure = { kind: 'failed', message };
    sendJson(response, 400, failure);
  }
}

function parseWorkspaceInput(value) {
  if (!isRecord(value)) throw new Error('Setup request must be an object');
  const organizationName = normalizeDisplayName(value.organizationName, 'Organisation name');
  const projectName = normalizeDisplayName(value.projectName, 'Project name');
  return {
    organizationName,
    organizationId: 'org_local_wallet',
    projectName,
    projectId: 'local-smoke-project',
    environmentName: 'dev',
    environmentId: 'local-smoke-project:dev',
  };
}

function normalizeDisplayName(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is required`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 80) throw new Error(`${label} must be 80 characters or fewer`);
  return normalized;
}

async function provisionWorkspace(identity) {
  if (workspaceState.kind === 'ready') {
    return workspaceState;
  }
  if (workspaceState.kind === 'provisioning' && provisioningPromise) {
    return await provisioningPromise;
  }
  workspaceState = { kind: 'provisioning' };
  provisioningPromise = connectToWalletSystem(identity);
  try {
    workspaceState = await provisioningPromise;
    return workspaceState;
  } catch (error) {
    workspaceState = {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Local workspace setup failed',
    };
    throw error;
  } finally {
    provisioningPromise = null;
  }
}

async function connectToWalletSystem(identity) {
  if (!(await requestIsReady(`${rawGatewayUrl}/readyz`))) {
    throw new Error('Local Wallet backend is unavailable. Run pnpm router in another terminal.');
  }
  return {
    kind: 'ready',
    identity,
    walletConfig: {
      projectEnvironmentId: identity.environmentId,
      publishableKey: 'pk_local',
      gatewayUrl,
      walletOrigin,
      signingWorkerId: 'local-signing-worker',
    },
  };
}

function startVite(label, port, walletAssetHost) {
  const child = spawn(
    'pnpm',
    ['exec', 'vite', '--host', 'localhost', '--port', String(port), '--logLevel', 'warn'],
    {
      cwd: exampleRoot,
      env: {
        ...process.env,
        VITE_SEAMS_WALLET_ASSET_HOST: walletAssetHost ? '1' : '0',
      },
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    },
  );
  trackChild(label, child);
}

function startDocs() {
  const child = spawn('pnpm', ['-C', 'apps/docs', 'dev'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VITE_SITE_ORIGIN: appOrigin,
      VITE_DOCS_ORIGIN: 'http://docs.localhost:4003/docs',
      VITE_DOCS_BASE_PATH: '/docs/',
      VITE_WALLET_SITE_ORIGIN: appOrigin,
    },
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  trackChild('Wallet docs', child);
}

function startCaddy() {
  const result = spawnSync('caddy', ['version'], { cwd: exampleRoot, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error('Caddy is required for pnpm site. Install it with: brew install caddy');
  }
  const child = spawn(
    'caddy',
    ['run', '--config', fileURLToPath(new URL('../Caddyfile', import.meta.url)), '--adapter', 'caddyfile'],
    {
      cwd: exampleRoot,
      env: process.env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    },
  );
  trackChild('Caddy', child);
}

function runRequired(label, command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, env: process.env, stdio: 'inherit' });
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} exited with ${String(result.status ?? 'unknown')}`);
}

function trackChild(label, child) {
  children.push(child);
  child.once('exit', handleChildExit.bind(undefined, label));
  child.once('error', handleChildError.bind(undefined, label));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', appendRequestBody.bind(undefined, () => body, (value) => { body = value; }, request));
    request.once('end', parseRequestBody.bind(undefined, () => body, resolve, reject));
    request.once('error', reject);
  });
}

function appendRequestBody(readBody, writeBody, request, chunk) {
  const next = `${readBody()}${chunk}`;
  if (next.length > 4_096) {
    request.destroy(new Error('Setup request is too large'));
    return;
  }
  writeBody(next);
}

function parseRequestBody(readBody, resolve, reject) {
  try {
    resolve(JSON.parse(readBody()));
  } catch (error) {
    reject(error);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('Wallet Console Lite stopped during startup');
    if (await requestIsReady(url)) return;
    await delay(200);
  }
  throw new Error(`${url} did not become ready`);
}

function requestIsReady(url) {
  return new Promise((resolve) => {
    const request = http.get(url, handleReadyResponse.bind(undefined, resolve));
    request.setTimeout(750, handleRequestTimeout.bind(undefined, request));
    request.once('error', resolve.bind(undefined, false));
  });
}

function handleReadyResponse(resolve, response) {
  response.resume();
  resolve(response.statusCode === 200);
}

function handleRequestTimeout(request) {
  request.destroy();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  controllerServer?.close();
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
