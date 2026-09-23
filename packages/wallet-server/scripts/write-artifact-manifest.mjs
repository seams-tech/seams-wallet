#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const workerRoles = [
  'router',
  'deriver-a',
  'deriver-b',
  'signing-worker',
  'tenant-root-control-plane',
];
const migrationSets = {
  signer: 'migrations/d1-signer',
  wallet_directory: 'migrations/d1-wallet-directory',
  deriver_a: 'cloudflare-router-ab/migrations/deriver-a',
  deriver_b: 'cloudflare-router-ab/migrations/deriver-b',
  signing_worker: 'cloudflare-router-ab/migrations/signing-worker',
};

const manifest = {
  schemaVersion: 'seams_wallet_server_artifact_manifest_v1',
  package: {
    name: packageJson.name,
    version: packageJson.version,
  },
  workers: Object.fromEntries(workerRoles.map((role) => [role, readWorkerArtifact(role)])),
  migrations: Object.fromEntries(
    Object.entries(migrationSets).map(([name, directory]) => [name, readMigrationSet(directory)]),
  ),
};

writeFileSync(
  path.join(packageRoot, 'artifact-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

function readWorkerArtifact(role) {
  const directory = `cloudflare-router-ab/build/${role}`;
  const files = listFiles(directory).map(inspectFile);
  const entry = `${directory}/worker/shim.mjs`;
  if (!files.some((file) => file.path === entry)) {
    throw new Error(`Missing packaged ${role} Worker entry: ${entry}`);
  }
  return {
    entry,
    fingerprint: digestFileRecords(files),
    files,
  };
}

function readMigrationSet(directory) {
  const files = readdirSync(path.join(packageRoot, directory))
    .filter((name) => /^[0-9]{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort()
    .map((name) => inspectFile(`${directory}/${name}`));
  if (files.length === 0) throw new Error(`Migration set is empty: ${directory}`);

  const fingerprint = createHash('sha256');
  for (const file of files) {
    fingerprint.update(path.basename(file.path));
    fingerprint.update('\0');
    fingerprint.update(readFileSync(path.join(packageRoot, file.path)));
    fingerprint.update('\0');
  }
  return {
    directory,
    head: path.basename(files.at(-1).path),
    fingerprint: fingerprint.digest('hex'),
    files,
  };
}

function listFiles(relativeDirectory) {
  const absoluteDirectory = path.join(packageRoot, relativeDirectory);
  const files = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFiles(relativePath));
    if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

function inspectFile(relativePath) {
  const absolutePath = path.join(packageRoot, relativePath);
  return {
    path: relativePath,
    bytes: statSync(absolutePath).size,
    sha256: createHash('sha256').update(readFileSync(absolutePath)).digest('hex'),
  };
}

function digestFileRecords(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\0');
  }
  return hash.digest('hex');
}
