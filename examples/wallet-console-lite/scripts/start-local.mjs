#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const appOrigin = 'http://localhost:4201';
const walletOrigin = 'http://localhost:4202';
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
  if (!options.skipBuild) runRequired('public Wallet build', 'pnpm', ['build']);
  controllerServer = startController();
  startVite('Wallet Console Lite', 4201, false);
  startVite('Wallet asset host', 4202, true);
  await Promise.all([
    waitForHttp(`${controllerOrigin}/healthz`, 60_000),
    waitForHttp(appOrigin, 60_000),
    waitForHttp(`${walletOrigin}/wallet-service`, 60_000),
  ]);
  console.log(`Wallet Console Lite: ${appOrigin}`);
  console.log(`Hosted Wallet origin: ${walletOrigin}`);
  await waitUntilStopped();
}

function parseArguments(args) {
  const parsed = { help: false, root: '', skipBuild: false };
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
    if (argument === '--skip-build') {
      parsed.skipBuild = true;
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

function printUsage() {
  console.log('Usage: pnpm wallet-console-lite [--root <runtime-directory>] [--skip-build]');
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
    if (request.method !== 'POST' || pathname !== '/__local-workspace') {
      sendJson(response, 404, { kind: 'failed', message: 'Route not found' });
      return;
    }
    if (request.headers.origin !== appOrigin) {
      sendJson(response, 403, { kind: 'failed', message: 'Request origin is not allowed' });
      return;
    }
    const input = parseWorkspaceInput(await readJsonBody(request));
    const result = await provisionWorkspace(input);
    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Local workspace setup failed';
    const failure = { kind: 'failed', message };
    if (workspaceState.kind === 'provisioning') workspaceState = failure;
    sendJson(response, 400, failure);
  }
}

function parseWorkspaceInput(value) {
  if (!isRecord(value)) throw new Error('Setup request must be an object');
  const organizationName = normalizeDisplayName(value.organizationName, 'Organisation name');
  const projectName = normalizeDisplayName(value.projectName, 'Project name');
  const organizationSlug = slugify(organizationName, 'Organisation name');
  const projectSlug = slugify(projectName, 'Project name');
  const organizationId = `org_${organizationSlug.replaceAll('-', '_')}`;
  const projectId = `${organizationSlug}-${projectSlug}`;
  const environmentId = `${projectId}:dev`;
  return {
    organizationName,
    organizationId,
    projectName,
    projectId,
    environmentName: 'dev',
    environmentId,
  };
}

function normalizeDisplayName(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is required`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 80) throw new Error(`${label} must be 80 characters or fewer`);
  return normalized;
}

function slugify(value, label) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-$/g, '');
  if (!slug) throw new Error(`${label} must contain at least one letter or number`);
  return slug;
}

async function provisionWorkspace(identity) {
  if (workspaceState.kind === 'ready') {
    requireSameWorkspace(workspaceState.identity, identity);
    return workspaceState;
  }
  if (workspaceState.kind === 'provisioning' && provisioningPromise) {
    return await provisioningPromise;
  }
  workspaceState = { kind: 'provisioning' };
  provisioningPromise = startWalletSystem(identity);
  try {
    workspaceState = await provisioningPromise;
    return workspaceState;
  } finally {
    provisioningPromise = null;
  }
}

function requireSameWorkspace(existing, requested) {
  if (
    existing.organizationName !== requested.organizationName ||
    existing.projectName !== requested.projectName
  ) {
    throw new Error('This process already owns one local workspace. Restart it to create another.');
  }
}

function startWalletSystem(identity) {
  const publishableKey = localPublishableKey(identity.environmentId);
  const args = [
    fileURLToPath(
      new URL('../../../crates/router-ab-cloudflare/scripts/start-local-wallet-system.mjs', import.meta.url),
    ),
    '--app-origin',
    appOrigin,
    '--wallet-origin',
    walletOrigin,
    '--org-id',
    identity.organizationId,
    '--project-id',
    identity.projectId,
    '--environment-id',
    identity.environmentId,
    '--signing-root-id',
    identity.environmentId,
    '--publishable-key',
    publishableKey,
  ];
  if (options.root) args.push('--root', path.resolve(options.root));
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: process.platform !== 'win32',
  });
  trackChild('Local Wallet system', child);
  return waitForWalletSystemReady(child, identity);
}

function localPublishableKey(environmentId) {
  const digest = createHash('sha256')
    .update(environmentId)
    .update(randomBytes(16))
    .digest('base64url')
    .slice(0, 24);
  return `pk_local_${digest}`;
}

function waitForWalletSystemReady(child, identity) {
  return new Promise(waitForWalletSystemReadyExecutor.bind(undefined, child, identity));
}

function waitForWalletSystemReadyExecutor(child, identity, resolve, reject) {
  const state = { buffered: '', settled: false, identity, resolve, reject };
  child.stdout.on('data', handleWalletSystemOutput.bind(undefined, state));
  child.once('error', reject);
  child.once('exit', rejectEarlyWalletExit.bind(undefined, state));
}

function handleWalletSystemOutput(state, chunk) {
  const lines = `${state.buffered}${String(chunk)}`.split('\n');
  state.buffered = lines.pop() || '';
  for (const line of lines) {
    const ready = parseWalletSystemReady(line);
    if (!ready) {
      console.log(line);
      continue;
    }
    if (state.settled) continue;
    try {
      state.settled = true;
      state.resolve({
        kind: 'ready',
        identity: state.identity,
        walletConfig: {
          projectEnvironmentId: requiredReadyString(ready.projectEnvironmentId),
          publishableKey: requiredReadyString(ready.publishableKey),
          gatewayUrl: requiredReadyOrigin(ready.gatewayUrl),
          walletOrigin: requiredReadyOrigin(ready.walletOrigin),
          signingWorkerId: requiredReadyString(ready.signingWorkerId),
        },
      });
    } catch (error) {
      state.reject(error);
    }
  }
}

function parseWalletSystemReady(line) {
  try {
    const value = JSON.parse(line);
    return isRecord(value) && value.kind === 'wallet_local_system_ready_v1' ? value : null;
  } catch {
    return null;
  }
}

function requiredReadyString(value) {
  if (typeof value !== 'string' || !value) throw new Error('Local Wallet system returned invalid configuration');
  return value;
}

function requiredReadyOrigin(value) {
  return new URL(requiredReadyString(value)).origin;
}

function rejectEarlyWalletExit(state, code, signal) {
  if (state.settled) return;
  state.reject(new Error(`Local Wallet system stopped (${signal || String(code ?? 'unknown')})`));
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
