#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workerBuildRoot = path.join(repoRoot, 'crates/router-ab-cloudflare/build');
const workerRoles = [
  'router',
  'deriver-a',
  'deriver-b',
  'signing-worker',
  'tenant-root-control-plane',
];

ensureWorkerBuilds();
startRouter();

function ensureWorkerBuilds() {
  const missingBuild = workerRoles.some(isWorkerBuildMissing);
  if (!missingBuild) return;

  const result = spawnSync('pnpm', ['build:workers'], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function isWorkerBuildMissing(role) {
  return !existsSync(path.join(workerBuildRoot, role, 'worker/shim.mjs'));
}

function startRouter() {
  const child = spawn(
    'pnpm',
    [
      '-C',
      'crates/router-ab-cloudflare',
      'dev:local-wallet-system',
      '--',
      '--app-origin',
      'http://localhost:4001',
      '--wallet-origin',
      'http://localhost:4002',
      ...process.argv.slice(2),
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    },
  );
  child.once('error', handleChildError);
  child.once('exit', handleChildExit);
}

function handleChildError(error) {
  console.error(error.message);
  process.exitCode = 1;
}

function handleChildExit(code, signal) {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
}
