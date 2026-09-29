#!/usr/bin/env node
// Prepares the R150 probe Worker's private inputs under .runtime/r150-hosted/probe/.
//
//   node tests/r150-hosted/probe/prepare-probe-worker.mjs secrets <image-context> <expires-at-unix-ms>
//     Writes worker-secrets.json, for `wrangler deploy --secrets-file`, with a
//     fresh probe access token and its expiry, and worker.json with the token
//     and the source the image context was prepared from.
//   node tests/r150-hosted/probe/prepare-probe-worker.mjs url <https-worker-url>
//     Records the deployed probe Worker's URL in worker.json.
//
// Both files have mode 0600 and are never printed. Neither is replaced once
// written: a new probe needs a new directory.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const probeRoot = path.join(repoRoot, '.runtime', 'r150-hosted', 'probe');
const workerPath = path.join(probeRoot, 'worker.json');
const [command, ...args] = process.argv.slice(2);
process.umask(0o077);

if (command === 'secrets' && args.length === 2) {
  const [contextArg, expiresText] = args;
  const contextRoot = path.resolve(contextArg);
  const runtimeRoot = path.join(repoRoot, '.runtime', 'r150-hosted');
  if (!contextRoot.startsWith(`${runtimeRoot}${path.sep}probe-image-`)) {
    throw new Error('The image context must be one prepare-image-context.mjs wrote');
  }
  const source = JSON.parse(
    readFileSync(path.join(contextRoot, '.runtime', 'r150-hosted', 'probe-source.json'), 'utf8'),
  );
  if (
    source.kind !== 'r150_hosted_probe_source_v1' ||
    !/^[0-9a-f]{40}$/u.test(source.revision) ||
    !/^[0-9a-f]{64}$/u.test(source.walletBuildInputHash)
  ) {
    throw new Error('The image context has no valid source fingerprint');
  }
  const expiresAtMs = Number(expiresText);
  const now = Date.now();
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs < now + 5 * 60_000 ||
    expiresAtMs > now + 48 * 60 * 60_000
  ) {
    throw new Error('The probe expiry must be 5 minutes to 48 hours ahead, in Unix milliseconds');
  }
  const accessToken = randomBytes(32).toString('base64url');
  mkdirSync(probeRoot, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(probeRoot, 'worker-secrets.json'),
    `${JSON.stringify({ PROBE_ACCESS_TOKEN: accessToken, PROBE_EXPIRES_AT_MS: String(expiresAtMs) })}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  writeFileSync(
    workerPath,
    `${JSON.stringify(
      { kind: 'r150_hosted_probe_worker_v1', accessToken, expiresAtMs, source, workerUrl: null },
      null,
      2,
    )}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  console.log(`Wrote the probe Worker's secrets and record under ${probeRoot}`);
} else if (command === 'url' && args.length === 1) {
  if (!existsSync(workerPath) || (statSync(workerPath).mode & 0o077) !== 0) {
    throw new Error('Prepare the probe secrets first; the probe record must be private');
  }
  const worker = JSON.parse(readFileSync(workerPath, 'utf8'));
  if (worker.workerUrl !== null) throw new Error('The probe Worker URL is already recorded');
  const url = new URL(args[0]);
  if (
    url.protocol !== 'https:' ||
    url.hostname.split('.')[0] !== 'r150-bench-20260925-probe' ||
    url.pathname !== '/' ||
    url.search !== ''
  ) {
    throw new Error('The URL must be the isolated R150 probe Worker origin');
  }
  writeFileSync(
    workerPath,
    `${JSON.stringify({ ...worker, workerUrl: url.href }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`Recorded the probe Worker URL ${url.href}`);
} else {
  throw new Error(
    'Usage: prepare-probe-worker.mjs secrets <image-context> <expires-at-unix-ms> | url <https-worker-url>',
  );
}
