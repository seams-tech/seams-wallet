#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmPackageManifests = [
  'packages/wallet/package.json',
  'packages/wallet-server/package.json',
];
const cargoManifests = [
  'crates/seams-cli/Cargo.toml',
  'crates/router-ab-cloudflare/Cargo.toml',
  'crates/router-ab-ed25519-yao-client/Cargo.toml',
  'wasm/email_otp_runtime/Cargo.toml',
  'wasm/evm_crypto/Cargo.toml',
  'wasm/near_signer/Cargo.toml',
  'wasm/router_ab_ecdsa_client/Cargo.toml',
  'wasm/router_ab_ecdsa_signing_worker/Cargo.toml',
  'wasm/shamir3pass_runtime/Cargo.toml',
  'wasm/tempo_signer/Cargo.toml',
  'wasm/wallet_custody_ceremony/Cargo.toml',
];
const outputPaths = [
  'THIRD_PARTY_NOTICES.md',
  'packages/wallet/THIRD_PARTY_NOTICES.md',
  'packages/wallet-server/THIRD_PARTY_NOTICES.md',
];

main();

function main() {
  const records = [...collectNpmRuntimeDependencies(), ...collectCargoDependencies()];
  records.sort(compareDependencyRecords);
  const notice = renderNotice(records, collectLicenseTexts(records));
  for (const outputPath of outputPaths) {
    fs.writeFileSync(path.join(repositoryRoot, outputPath), notice);
  }
  process.stdout.write(
    `Generated Wallet third-party notices for ${String(records.length)} dependency records\n`,
  );
}

function collectNpmRuntimeDependencies() {
  const queue = [];
  for (const manifestPath of npmPackageManifests) {
    const absoluteManifestPath = path.join(repositoryRoot, manifestPath);
    const packageJson = readJson(absoluteManifestPath);
    queue.push(...dependencyRequests(packageJson, path.dirname(absoluteManifestPath)));
  }
  const visitedDirectories = new Set();
  const records = new Map();
  while (queue.length > 0) {
    const request = queue.shift();
    const packageDirectory = resolveInstalledPackageDirectory(request.name, request.fromDirectory);
    const canonicalDirectory = fs.realpathSync(packageDirectory);
    if (visitedDirectories.has(canonicalDirectory)) continue;
    visitedDirectories.add(canonicalDirectory);
    const packageJson = readJson(path.join(packageDirectory, 'package.json'));
    const version = requiredString(packageJson.version, `${request.name} version`);
    records.set(`${request.name}@${version}`, {
      ecosystem: 'npm',
      name: request.name,
      version,
      license: normalizedLicense(packageJson.license),
      authors: normalizeNpmAuthors(packageJson),
      packageDirectory,
    });
    queue.push(...dependencyRequests(packageJson, packageDirectory));
  }
  return [...records.values()];
}

function dependencyRequests(packageJson, fromDirectory) {
  return Object.keys(packageJson.dependencies || {}).map(
    createDependencyRequest.bind(null, fromDirectory),
  );
}

function createDependencyRequest(fromDirectory, name) {
  return { name, fromDirectory };
}

function resolveInstalledPackageDirectory(name, fromDirectory) {
  let currentDirectory = path.resolve(fromDirectory);
  while (isWithinRepository(currentDirectory)) {
    const candidate = path.join(currentDirectory, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }
  throw new Error(`Unable to resolve installed npm dependency ${name} from ${fromDirectory}`);
}

function isWithinRepository(directory) {
  return directory === repositoryRoot || directory.startsWith(`${repositoryRoot}${path.sep}`);
}

function collectCargoDependencies() {
  const records = new Map();
  for (const manifestPath of cargoManifests) {
    const metadata = runCargoMetadata(manifestPath);
    for (const packageRecord of metadata.packages) {
      if (!packageRecord.source || records.has(packageRecord.id)) continue;
      records.set(packageRecord.id, {
        ecosystem: 'cargo',
        name: requiredString(packageRecord.name, 'Cargo package name'),
        version: requiredString(packageRecord.version, 'Cargo package version'),
        license: normalizedLicense(packageRecord.license),
        authors: normalizeAuthors(packageRecord.authors),
        packageDirectory: path.dirname(packageRecord.manifest_path),
      });
    }
  }
  return [...records.values()];
}

function runCargoMetadata(manifestPath) {
  const result = spawnSync(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--manifest-path',
      path.join(repositoryRoot, manifestPath),
    ],
    { encoding: 'utf8', cwd: repositoryRoot },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `cargo metadata failed for ${manifestPath}: ${String(result.stderr || result.stdout).trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

function collectLicenseTexts(records) {
  const groups = new Map();
  for (const record of records) {
    const licenseFiles = findLicenseFiles(record.packageDirectory);
    record.licenseFiles = licenseFiles.map(relativeLicenseFile.bind(null, record.packageDirectory));
    for (const licenseFile of licenseFiles) {
      const text = normalizeLicenseText(fs.readFileSync(licenseFile, 'utf8'));
      const digest = createHash('sha256').update(text).digest('hex');
      const existing = groups.get(digest);
      if (existing) {
        existing.dependencies.push(recordLabel(record));
        existing.fileNames.add(path.basename(licenseFile));
        continue;
      }
      groups.set(digest, {
        digest,
        text,
        dependencies: [recordLabel(record)],
        fileNames: new Set([path.basename(licenseFile)]),
      });
    }
  }
  return [...groups.values()].sort(compareLicenseGroups);
}

function findLicenseFiles(packageDirectory) {
  return fs
    .readdirSync(packageDirectory, { withFileTypes: true })
    .filter(isLicenseFile)
    .map(resolveDirectoryEntry.bind(null, packageDirectory))
    .sort();
}

function isLicenseFile(entry) {
  return entry.isFile() && /^(license|licence|copying|notice)(?:[.-]|$)/iu.test(entry.name);
}

function resolveDirectoryEntry(directory, entry) {
  return path.join(directory, entry.name);
}

function relativeLicenseFile(packageDirectory, filePath) {
  return path.relative(packageDirectory, filePath);
}

function renderNotice(records, licenseGroups) {
  const withoutPackagedText = records.filter(hasNoPackagedLicenseText);
  const lines = [
    '# Third-Party Notices',
    '',
    'This file covers the runtime npm dependencies and registry crates used by the',
    'distributed Seams Wallet SDK, server runtime, Wasm, strict Workers, and CLI.',
    'Dependency license expressions come from their package metadata. Packaged',
    'license and notice wording is reproduced below with normalized whitespace.',
    '',
    `Inventory: ${String(records.length)} dependency records (${String(countEcosystem(records, 'npm'))} npm, ${String(countEcosystem(records, 'cargo'))} Cargo).`,
    '',
    '## Dependency inventory',
    '',
    '| Ecosystem | Package | Version | License | Authors |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const record of records) lines.push(renderDependencyRow(record));
  lines.push('', '## Dependencies without a packaged license file', '');
  if (withoutPackagedText.length === 0) {
    lines.push('None.', '');
  } else {
    lines.push(
      'These packages declare the following SPDX license expression in package metadata',
      'but do not include a top-level license or notice file in the distributed package:',
      '',
    );
    for (const record of withoutPackagedText) {
      lines.push(`- ${recordLabel(record)} — ${record.license}`);
    }
    lines.push('');
  }
  lines.push('## Packaged license and notice texts', '');
  for (const group of licenseGroups) lines.push(...renderLicenseGroup(group));
  return `${lines.join('\n')}\n`;
}

function renderDependencyRow(record) {
  return `| ${record.ecosystem} | ${escapeTable(record.name)} | ${escapeTable(record.version)} | ${escapeTable(record.license)} | ${escapeTable(record.authors)} |`;
}

function renderLicenseGroup(group) {
  const dependencies = [...new Set(group.dependencies)].sort();
  return [
    `### ${group.digest.slice(0, 16)}`,
    '',
    `Packaged as: ${[...group.fileNames].sort().join(', ')}`,
    '',
    'Applies to:',
    '',
    ...dependencies.map(renderDependencyBullet),
    '',
    ...group.text.split('\n').map(indentLicenseLine),
    '',
  ];
}

function renderDependencyBullet(dependency) {
  return `- ${dependency}`;
}

function indentLicenseLine(line) {
  return line ? `    ${line}` : '';
}

function hasNoPackagedLicenseText(record) {
  return record.licenseFiles.length === 0;
}

function countEcosystem(records, ecosystem) {
  return records.filter(matchesEcosystem.bind(null, ecosystem)).length;
}

function matchesEcosystem(ecosystem, record) {
  return record.ecosystem === ecosystem;
}

function compareDependencyRecords(left, right) {
  return recordLabel(left).localeCompare(recordLabel(right));
}

function compareLicenseGroups(left, right) {
  return left.digest.localeCompare(right.digest);
}

function recordLabel(record) {
  return `${record.ecosystem}:${record.name}@${record.version}`;
}

function normalizeLicenseText(text) {
  return `${text.replace(/\r\n/gu, '\n').split('\n').map(trimLineEnd).join('\n').trimEnd()}\n`;
}

function trimLineEnd(line) {
  return line.trimEnd();
}

function normalizedLicense(value) {
  return requiredString(value, 'dependency license');
}

function normalizeNpmAuthors(packageJson) {
  const authors = [];
  if (packageJson.author) authors.push(normalizeNpmAuthor(packageJson.author));
  if (Array.isArray(packageJson.contributors)) {
    authors.push(...packageJson.contributors.map(normalizeNpmAuthor));
  }
  return normalizeAuthors(authors);
}

function normalizeNpmAuthor(author) {
  if (typeof author === 'string') return author;
  if (!author || typeof author !== 'object') return '';
  return [author.name, author.email].filter(Boolean).join(' ');
}

function normalizeAuthors(authors) {
  if (!Array.isArray(authors)) return '';
  return [...new Set(authors.map(normalizeAuthor).filter(Boolean))].sort().join('; ');
}

function normalizeAuthor(author) {
  return String(author || '').trim();
}

function escapeTable(value) {
  return String(value || '').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
