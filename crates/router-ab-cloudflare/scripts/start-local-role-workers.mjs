#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { prepareRouterAbStrictLocalRuntimeConfigs } from './prepare-local-runtime-config.mjs';

const repoRoot = process.cwd();
const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
const options = parseArguments(process.argv.slice(2));
const localRoot = path.resolve(
  options.root || path.join(tmpdir(), `${path.basename(repoRoot)}-wallet-router-ab`),
);
const stateRoot = path.join(localRoot, '.local', 'cloudflare-state', 'router-ab');
const gatewayRuntimeRoot = path.join(localRoot, '.runtime', 'wallet-gateway');
const ceremonyPrivateJwkPath = path.join(gatewayRuntimeRoot, 'ceremony-private.jwk.json');
const workersReadyPath = path.join(localRoot, '.runtime', 'role-workers.ready');
// Separate local stacks reuse Worker names, so each needs its own discovery registry.
const workerEnv = {
  ...process.env,
  WRANGLER_LOG: process.env.WRANGLER_LOG || 'warn',
  WRANGLER_REGISTRY_PATH: path.join(localRoot, '.local', 'worker-registry'),
};
const children = [];
let stopping = false;

await main().catch(handleFatalError);

async function main() {
  if (options.help) {
    printUsage();
    return;
  }
  installSignalHandlers();
  initializeLocalIdentity();
  assertWorkerArtifacts();
  const runtime = prepareRouterAbStrictLocalRuntimeConfigs({
    repoRoot,
    localEnvRoot: localRoot,
    ceremonyJwksJson: resolveCeremonyPublicJwksJson(),
  });
  applyPrivateD1Migrations(runtime);
  startWorkers(runtime);
  await waitForWorkers(runtime);
  writeFileSync(workersReadyPath, 'ready\n');
  if (process.stdout.isTTY) {
    console.log('Local Wallet role Workers ready.');
  } else {
    console.log(
      JSON.stringify({
        kind: 'wallet_role_workers_ready_v1',
        mpcRouterUrl: runtime.mpcRouterUrl,
        ceremonyPrivateJwkPath,
        workers: runtime.configs.map(describeWorker),
      }),
    );
  }
  await waitUntilStopped();
}

function parseArguments(args) {
  const parsed = { help: false, root: '' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--help') {
      parsed.help = true;
      continue;
    }
    if (argument === '--root') {
      parsed.root = args[index + 1] || '';
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function printUsage() {
  console.log('Usage: start-local-role-workers.mjs [--root <runtime-directory>]');
}

function initializeLocalIdentity() {
  if (existsSync(path.join(localRoot, '.env.router-ab.router.local'))) return;
  mkdirSync(localRoot, { recursive: true });
  runRequired(
    'Router A/B local identity initialization',
    process.execPath,
    [
      fileURLToPath(new URL('./initialize-local-wallet.mjs', import.meta.url)),
      '--root',
      localRoot,
    ],
    repoRoot,
  );
}

function assertWorkerArtifacts() {
  const missing = [
    'router',
    'deriver-a',
    'deriver-b',
    'signing-worker',
    'tenant-root-control-plane',
  ]
    .map(workerArtifactPath)
    .filter(isMissingPath);
  if (missing.length === 0) return;
  throw new Error(
    `Wallet role Worker artifacts are missing: ${missing.map(repoRelativePath).join(', ')}. Install a complete @seams/wallet-server release.`,
  );
}

function workerArtifactPath(role) {
  return path.join(runtimeRoot, 'build', role, 'worker', 'shim.mjs');
}

function isMissingPath(filePath) {
  return !existsSync(filePath);
}

function repoRelativePath(filePath) {
  return path.relative(repoRoot, filePath);
}

function resolveCeremonyPublicJwksJson() {
  mkdirSync(gatewayRuntimeRoot, { recursive: true, mode: 0o700 });
  if (!existsSync(ceremonyPrivateJwkPath)) {
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(
      ceremonyPrivateJwkPath,
      `${JSON.stringify(privateKey.export({ format: 'jwk' }))}\n`,
      { mode: 0o600 },
    );
  }
  chmodSync(ceremonyPrivateJwkPath, 0o600);
  const privateJwk = JSON.parse(readFileSync(ceremonyPrivateJwkPath, 'utf8'));
  if (
    privateJwk?.kty !== 'OKP' ||
    privateJwk?.crv !== 'Ed25519' ||
    typeof privateJwk.x !== 'string' ||
    !privateJwk.x ||
    typeof privateJwk.d !== 'string' ||
    !privateJwk.d
  ) {
    throw new Error(`Invalid ceremony private JWK at ${ceremonyPrivateJwkPath}`);
  }
  return JSON.stringify({
    keys: [
      {
        alg: 'EdDSA',
        crv: privateJwk.crv,
        kid: 'local-router-ab-r1',
        kty: privateJwk.kty,
        use: 'sig',
        x: privateJwk.x,
      },
    ],
  });
}

function applyPrivateD1Migrations(runtime) {
  for (const config of runtime.configs) {
    if (!config.privateD1) continue;
    const persistPath = path.join(stateRoot, config.role);
    mkdirSync(persistPath, { recursive: true });
    runRequired(
      `${config.role} private D1 migrations`,
      'pnpm',
      [
        'exec',
        'wrangler',
        'd1',
        'migrations',
        'apply',
        config.privateD1.databaseName,
        '--local',
        '--persist-to',
        persistPath,
        '--config',
        config.configPath,
      ],
      repoRoot,
      { ...workerEnv, CI: 'true' },
    );
    console.log(`Local database ready: ${config.role}`);
  }
}

function startWorkers(runtime) {
  const ordered = [...runtime.configs.slice(1), runtime.configs[0]];
  for (const config of ordered) startWorker(config);
}

function startWorker(config) {
  const child = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      config.configPath,
      '--port',
      String(config.port),
      '--inspector-port',
      String(config.port + 1000),
      '--persist-to',
      path.join(stateRoot, config.role),
      '--env-file',
      config.secretPath,
      '--local',
      '--show-interactive-dev-session=false',
    ],
    {
      cwd: repoRoot,
      env: workerEnv,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    },
  );
  children.push(child);
  child.once('exit', handleChildExit.bind(undefined, config.role));
  child.once('error', handleChildError.bind(undefined, config.role));
}

async function waitForWorkers(runtime) {
  for (const config of runtime.configs) {
    await waitForHttp(config.url, 90_000, false);
  }
  await waitForHttp(`${runtime.mpcRouterUrl}/.well-known/router-ab/keyset`, 90_000, true);
}

function describeWorker(config) {
  return { role: config.role, url: config.url };
}

async function waitForHttp(url, timeoutMs, requireOk) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await requestStatus(url);
    if (status !== null && (!requireOk || status === 200)) return;
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

function runRequired(label, command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} exited with ${String(result.status ?? 'unknown')}`);
  }
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

function handleChildExit(role, code, signal) {
  if (stopping) return;
  console.error(`${role} stopped (${signal || String(code ?? 'unknown')})`);
  shutdown(typeof code === 'number' && code > 0 ? code : 1);
}

function handleChildError(role, error) {
  if (stopping) return;
  console.error(`${role} failed: ${error.message}`);
  shutdown(1);
}

function handleFatalError(error) {
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
  setTimeout(forceStopChildren.bind(undefined, exitCode), 2_000);
  process.exitCode = exitCode;
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {}
}

function forceStopChildren(exitCode) {
  for (const child of children) {
    // Detached workers can outlive the package-manager process that launched them.
    if (!child.pid) continue;
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {}
  }
  process.exit(exitCode);
}
