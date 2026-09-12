#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const binary = fileURLToPath(new URL(
  '../build/local-tools/' + process.platform + '-' + process.arch + '/router_ab_local_init',
  import.meta.url,
));
if (!existsSync(binary)) {
  throw new Error('Wallet local initializer is unavailable for ' + process.platform + '-' + process.arch);
}
// Package managers can normalize executable bits on bundled native assets.
if ((statSync(binary).mode & 0o111) === 0) chmodSync(binary, 0o755);
const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
