#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packages = [
  { directory: 'packages/wallet', name: '@seams/wallet' },
  { directory: 'packages/wallet-server', name: '@seams/wallet-server' },
];
const forbidden = [
  '@seams-internal/console',
  '@seams-internal/wallet-console',
  'packages/console',
  'packages/wallet-console',
  'apps/seams-console',
  'deployment/console/targets.json',
  'deployment/wallet-system/targets.json',
  'CONSOLE_SESSION_HMAC_SECRET',
  'STRIPE_API_SK',
];
const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'r105-wallet-pack-'));
const tarballDirectory = path.join(workDirectory, 'tarballs');
const nodeModulesDirectory = path.join(workDirectory, 'node_modules');

fs.mkdirSync(tarballDirectory, { recursive: true });
fs.mkdirSync(nodeModulesDirectory, { recursive: true });

try {
  for (const packageDefinition of packages) {
    const tarball = pack(packageDefinition.directory);
    const unpacked = unpack(tarball, packageDefinition.name);
    inspectPackage(unpacked, packageDefinition.name);
    copyPackage(unpacked, packageDefinition.name);
  }
  linkRuntimeDependencies();
  await smokePackedEntries();
  process.stdout.write('[check-packed-wallet-boundaries] passed\n');
} finally {
  fs.rmSync(workDirectory, { recursive: true, force: true });
}

function pack(packageDirectory) {
  const output = execFileSync('npm', ['pack', '--pack-destination', tarballDirectory, '--json'], {
    cwd: path.join(repoRoot, packageDirectory),
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: path.join(workDirectory, 'npm-cache'),
    },
  });
  const result = JSON.parse(output);
  assert.equal(result.length, 1, `${packageDirectory} must produce one tarball`);
  return path.join(tarballDirectory, result[0].filename);
}

function unpack(tarball, packageName) {
  const destination = path.join(workDirectory, 'unpacked', packageName.replace('/', '-'));
  fs.mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', destination]);
  return path.join(destination, 'package');
}

function inspectPackage(packageDirectory, packageName) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
  );
  assert.equal(packageJson.name, packageName);
  assert.equal(packageJson.version, '0.5.0');
  assert.equal(packageJson.license, 'MIT');
  assert.match(
    fs.readFileSync(path.join(packageDirectory, 'LICENSE'), 'utf8'),
    /^MIT License$/mu,
  );

  for (const file of listFiles(packageDirectory)) {
    const relativePath = path.relative(packageDirectory, file);
    assert.ok(!relativePath.endsWith('.map'), `${packageName} contains source map ${relativePath}`);
    if (!/\.(?:js|mjs|cjs|d\.ts|json|toml|sql)$/u.test(file) || file.endsWith('.wasm')) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const value of forbidden) {
      assert.ok(!source.includes(value), `${packageName}/${relativePath} contains ${value}`);
    }
  }
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(entryPath));
    if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function copyPackage(source, packageName) {
  const destination = path.join(nodeModulesDirectory, packageName);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function linkRuntimeDependencies() {
  const dependencyNames = new Set();
  for (const packageDefinition of packages) {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, packageDefinition.directory, 'package.json'), 'utf8'),
    );
    for (const section of ['dependencies', 'peerDependencies']) {
      for (const name of Object.keys(packageJson[section] ?? {})) dependencyNames.add(name);
    }
  }
  for (const name of dependencyNames) {
    const source = path.join(repoRoot, 'node_modules', name);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(nodeModulesDirectory, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(source, destination, 'dir');
  }
}

async function smokePackedEntries() {
  const runtime = await import(
    path.join(nodeModulesDirectory, '@seams/wallet/dist/esm/runtime.js')
  );
  assert.equal(typeof runtime.createSigningRuntime, 'function');

  const authMenu = await import(
    path.join(
      nodeModulesDirectory,
      '@seams/wallet/dist/esm/react/components/SeamsAuthMenu/public.js',
    )
  );
  assert.equal(typeof authMenu.SeamsAuthMenu, 'function');

  const walletServer = await import(
    path.join(nodeModulesDirectory, '@seams/wallet-server/dist/esm/index.js')
  );
  assert.equal(typeof walletServer.AuthService, 'function');

  const artifactManifest = JSON.parse(
    fs.readFileSync(
      path.join(nodeModulesDirectory, '@seams/wallet-server/artifact-manifest.json'),
      'utf8',
    ),
  );
  assert.equal(artifactManifest.schemaVersion, 'seams_wallet_server_artifact_manifest_v1');
  assert.equal(artifactManifest.package.version, '0.5.0');
}
