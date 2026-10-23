#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(packageRoot, '..', '..', 'crates', 'router-ab-cloudflare');
const outputRoot = path.join(packageRoot, 'cloudflare-router-ab');
const roles = ['router', 'deriver-a', 'deriver-b', 'signing-worker', 'tenant-root-control-plane'];

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const role of roles) {
  const sourceBuild = path.join(sourceRoot, 'build', role);
  const entry = path.join(sourceBuild, 'worker', 'shim.mjs');
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Router A/B runtime is missing ${entry}; build all strict Workers before packing`,
    );
  }
  fs.cpSync(sourceBuild, path.join(outputRoot, 'build', role), { recursive: true });
  fs.rmSync(path.join(outputRoot, 'build', role, '.gitignore'), { force: true });

  const configName = `wrangler.${role}.toml`;
  const config = fs.readFileSync(path.join(sourceRoot, configName), 'utf8');
  fs.writeFileSync(path.join(outputRoot, configName), removeSourceBuildCommand(config));
}

// ML-DSA has separate deployable binaries. Ordinary roles contain no ML-DSA engine.
for (const role of ['router', 'deriver-a', 'deriver-b']) {
  const relative = path.join('build', 'ml-dsa', role);
  const sourceBuild = path.join(sourceRoot, relative);
  if (!fs.existsSync(path.join(sourceBuild, 'worker', 'shim.mjs'))) {
    throw new Error(`Missing ML-DSA runtime; run build-strict-worker.sh ${role} ml-dsa before packing`);
  }
  fs.cpSync(sourceBuild, path.join(outputRoot, relative), { recursive: true });
  fs.rmSync(path.join(outputRoot, relative, '.gitignore'), { force: true });
}
for (const role of ['router', 'a', 'b', 'preparer-a', 'preparer-b']) {
  const configName = `wrangler.ml-dsa-${role}.toml`;
  const config = fs.readFileSync(path.join(sourceRoot, configName), 'utf8');
  fs.writeFileSync(path.join(outputRoot, configName), removeSourceBuildCommand(config));
}

fs.cpSync(path.join(sourceRoot, 'migrations'), path.join(outputRoot, 'migrations'), {
  recursive: true,
});

for (const script of [
  'initialize-local-wallet.mjs',
  'start-local-role-workers.mjs',
  'start-local-wallet-system.mjs',
  'bootstrap-local-tenant-root.mjs',
  'prepare-local-runtime-config.mjs',
]) {
  fs.mkdirSync(path.join(outputRoot, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, 'scripts', script), path.join(outputRoot, 'scripts', script));
  fs.chmodSync(path.join(outputRoot, 'scripts', script), 0o755);
}
fs.cpSync(path.join(sourceRoot, 'env'), path.join(outputRoot, 'env'), { recursive: true });
fs.cpSync(path.join(sourceRoot, 'build/local-tools'), path.join(outputRoot, 'build/local-tools'), { recursive: true });

function removeSourceBuildCommand(config) {
  return config.replace(/\n\[build\]\ncommand = "[^"]+"\n/u, '\n');
}
