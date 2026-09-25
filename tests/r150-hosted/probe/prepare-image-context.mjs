#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeRoot = path.join(repoRoot, '.runtime', 'r150-hosted');
const walletDist = path.join(repoRoot, 'packages', 'wallet', 'dist');

if (process.argv.length !== 2) {
  throw new Error('Usage: node tests/r150-hosted/probe/prepare-image-context.mjs');
}
if (run('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim() !== '') {
  throw new Error('Commit the exact probe source before preparing a deployment image');
}
run(path.join(repoRoot, 'packages/wallet/scripts/build/check-build-freshness.sh'), [], {
  encoding: 'utf8',
});
if (!existsSync(path.join(walletDist, 'public', 'wallet-assets.manifest.json'))) {
  throw new Error('Hosted Wallet assets have not been built');
}
checkNoSymlinks(walletDist);
const walletBuildInputHash = readFileSync(path.join(walletDist, '.build-inputs.sha256'), 'utf8').trim();
if (!/^[0-9a-f]{64}$/u.test(walletBuildInputHash)) {
  throw new Error('Wallet build input manifest is invalid');
}

const revision = run('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
process.umask(0o077);
mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
const contextRoot = mkdtempSync(path.join(runtimeRoot, 'probe-image-'));
const archive = run('git', ['archive', '--format=tar', 'HEAD'], {
  encoding: null,
  maxBuffer: 512 * 1024 * 1024,
}).stdout;
run('tar', ['-x', '-f', '-', '-C', contextRoot], { input: archive, maxBuffer: 1024 * 1024 });
cpSync(walletDist, path.join(contextRoot, 'packages', 'wallet', 'dist'), {
  recursive: true,
  force: false,
  errorOnExist: true,
});
const sourceRoot = path.join(contextRoot, '.runtime', 'r150-hosted');
mkdirSync(sourceRoot, { recursive: true, mode: 0o700 });
writeFileSync(path.join(sourceRoot, 'probe-source.json'), `${JSON.stringify({
  kind: 'r150_hosted_probe_source_v1',
  revision,
  walletBuildInputHash,
}, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
for (const region of ['nrt', 'fra', 'iad']) {
  const config = [
    `app = "r150-bench-20260925-probe-${region}"`,
    `primary_region = "${region}"`,
    '',
    '[build]',
    'dockerfile = "tests/r150-hosted/probe/Dockerfile"',
    '',
    '[[vm]]',
    'size = "shared-cpu-2x"',
    'memory = "2gb"',
    'persist_rootfs = "restart"',
    '',
  ].join('\n');
  writeFileSync(path.join(contextRoot, `fly-${region}.toml`), config, {
    flag: 'wx',
    mode: 0o600,
  });
}
console.log(`Prepared tracked-only R150 probe image context at ${contextRoot}`);
console.log(`Source revision: ${revision.slice(0, 12)}; Wallet build: ${walletBuildInputHash.slice(0, 12)}`);

function run(command, args, options) {
  const result = spawnSync(command, args, { cwd: repoRoot, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(command)} failed: ${result.error?.message ?? String(result.stderr)}`);
  }
  return result;
}

function checkNoSymlinks(directory) {
  for (const name of readdirSync(directory)) {
    const filePath = path.join(directory, name);
    const status = lstatSync(filePath);
    if (status.isSymbolicLink()) {
      throw new Error(`Wallet distribution contains a symlink: ${filePath}`);
    }
    if (status.isDirectory()) checkNoSymlinks(filePath);
  }
}
