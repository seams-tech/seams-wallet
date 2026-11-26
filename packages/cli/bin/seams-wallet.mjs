#!/usr/bin/env node
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile, mkdir, writeFile, chmod, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
async function download(url, maximum) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.url.startsWith('https://') || response.body === null)
    throw new Error('Unable to download the signed Seams release.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new Error('Release download exceeds its size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('base64url');
}
function target() {
  switch (`${process.platform}-${process.arch}`) {
    case 'darwin-arm64':
      return 'aarch64-apple-darwin';
    case 'darwin-x64':
      return 'x86_64-apple-darwin';
    case 'linux-x64':
      return 'x86_64-unknown-linux-gnu';
    default:
      throw new Error('Supported platforms: macOS Apple Silicon/Intel and Linux x86_64.');
  }
}
async function main() {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const root = JSON.parse(await readFile(new URL('../release-root.json', import.meta.url), 'utf8'));
  const platform = target();
  const base = `https://github.com/seams-tech/seams-wallet/releases/download/seams-cli-v${pkg.version}`;
  const directory = join(homedir(), '.cache', 'seams-cli', pkg.version);
  const manifestPath = join(directory, 'seams-release-manifest.json');
  let manifestBytes;
  try {
    manifestBytes = await readFile(manifestPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    manifestBytes = await download(`${base}/seams-release-manifest.json`, 65536);
  }
  if (manifestBytes.length > 65536) throw new Error('Release manifest exceeds its size limit.');
  const manifest = JSON.parse(manifestBytes);
  const { signature, ...unsigned } = manifest;
  if (
    manifest.formatVersion !== 'seams_release_checksum_manifest_v1' ||
    manifest.releaseVersion !== pkg.version ||
    manifest.signerKeyId !== root.keyId ||
    typeof signature !== 'string' ||
    !Array.isArray(manifest.entries)
  )
    throw new Error('Release manifest does not match this CLI package.');
  const key = createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: root.verifyingKey },
  });
  if (
    !verify(
      null,
      Buffer.concat([
        Buffer.from('seams/release-checksum-manifest/v1'),
        Buffer.from(canonical(unsigned)),
      ]),
      key,
      Buffer.from(signature, 'base64url'),
    )
  )
    throw new Error('Release signature verification failed.');
  const entries = manifest.entries.filter(
    (entry) => entry.target === platform && entry.filename === `seams-wallet-${platform}`,
  );
  if (entries.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(entries[0].sha256B64u))
    throw new Error('No verified binary for this platform.');
  const entry = entries[0];
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const executable = join(directory, entry.filename);
  let cached = null;
  try {
    cached = await readFile(executable);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cached === null || digest(cached) !== entry.sha256B64u) {
    const bytes = await download(`${base}/${entry.filename}`, 200 * 1024 * 1024);
    if (digest(bytes) !== entry.sha256B64u) throw new Error('Binary checksum verification failed.');
    const temporary = `${executable}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o700, flag: 'wx' });
      await rename(temporary, executable);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryManifest, manifestBytes, { mode: 0o600, flag: 'wx' });
    await rename(temporaryManifest, manifestPath);
  } finally {
    await rm(temporaryManifest, { force: true });
  }
  await chmod(executable, 0o700);
  const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? (result.signal === 'SIGINT' ? 130 : 1);
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Seams CLI setup failed.');
  process.exitCode = 1;
}
