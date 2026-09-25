#!/usr/bin/env node
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [inputName, caseText, arm] = process.argv.slice(2);
if (process.argv.length !== 5 || !inputName ||
    !/^(?:[1-9]|1[0-9]|20)$/u.test(caseText ?? '') ||
    !['d1', 'do'].includes(arm)) {
  throw new Error('Usage: node tests/r150-hosted/run-sample.mjs <private-input.json> <case-1..20> <d1|do>');
}

process.umask(0o077);
const inputPath = path.resolve(inputName);
const runDirectory = path.dirname(inputPath);
const ledgerPath = path.join(runDirectory, 'attempts.jsonl');
const lockPath = path.join(runDirectory, 'sample.lock');
requirePrivateInput(inputPath);
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
validateInput(input);
const evidencePath = path.resolve(runDirectory, input.probe.evidenceRef);
if (!evidencePath.startsWith(`${runDirectory}${path.sep}`) || !existsSync(evidencePath)) {
  throw new Error('Fly machine evidence must exist inside the private probe directory');
}
if (process.env.FLY_REGION !== input.region ||
    process.env.FLY_MACHINE_ID !== input.probe.instanceId ||
    process.env.FLY_APP_NAME !== input.probe.appName) {
  throw new Error('Fly runtime region, machine, or app differs from the inventoried probe');
}
const caseIndex = Number(caseText);
const source = JSON.parse(readFileSync(
  path.join(repoRoot, '.runtime', 'r150-hosted', 'probe-source.json'),
  'utf8',
));
if (source.kind !== 'r150_hosted_probe_source_v1' ||
    !/^[0-9a-f]{40}$/u.test(source.revision) ||
    !/^[0-9a-f]{64}$/u.test(source.walletBuildInputHash)) {
  throw new Error('Probe image has no valid committed source and wallet build fingerprint');
}
const lock = openSync(lockPath, 'wx', 0o600);
let dispatched = false;
let completed = false;
try {
  const sequence = completedAttemptCount(ledgerPath, input, source) + 1;
  if (sequence > 40 || caseIndex !== Math.ceil(sequence / 2) || arm !== expectedArm(sequence)) {
    throw new Error(`Expected case ${Math.ceil(sequence / 2)} ${expectedArm(sequence)}; pilot is capped at 40 attempts per region`);
  }

  const revision = source.revision;
  const runId = `${input.region}-case-${String(caseIndex).padStart(2, '0')}-${arm}`;
  const artifactName = `gateway-ecdsa-unforced-timing-hosted_${arm}-${input.region}-${runId}-0.json`;
  const sourceArtifact = path.join(repoRoot, '.artifacts', 'r150', artifactName);
  if (existsSync(sourceArtifact)) {
    throw new Error(`Refusing to reuse prior benchmark artifact ${artifactName}`);
  }

  const start = {
    event: 'start',
    kind: 'r150_hosted_attempt_v1',
    region: input.region,
    caseIndex,
    sequence,
    arm,
    runId,
    revision,
    walletBuildInputHash: source.walletBuildInputHash,
    deploymentFingerprint: input.arms[arm].deploymentFingerprint,
    probe: input.probe,
    startedAt: new Date().toISOString(),
  };
  appendDurableEvent(ledgerPath, start);
  dispatched = true;

  const selected = input.arms[arm];
  const env = {
    ...process.env,
    SEAMS_INTENDED_EXTERNAL_GATEWAY: '1',
    SEAMS_INTENDED_ROUTER_URL: selected.ingressUrl,
    SEAMS_INTENDED_BENCHMARK_ARM: arm,
    SEAMS_INTENDED_PROBE_REGION: input.region,
    SEAMS_INTENDED_BENCHMARK_RUN_ID: runId,
    SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID: selected.environmentId,
    SEAMS_INTENDED_PUBLISHABLE_KEY: selected.publishableKey,
    SEAMS_INTENDED_SIGNING_WORKER_ID: selected.signingWorkerId,
    SEAMS_INTENDED_BENCHMARK_ACCESS_TOKEN: selected.accessToken,
  };
  const result = spawnSync('pnpm', [
    '-C', 'tests', 'exec', 'playwright', 'test',
    '-c', 'playwright.wallet-intended.ci.config.ts',
    'e2e/intended-behaviours/passkey.presign-pool.contract.test.ts',
    '--grep', 'unforced ECDSA registration and repeated signing',
  ], { cwd: repoRoot, env, stdio: 'inherit' });
  const successful = result.status === 0 && result.signal === null &&
    existsSync(sourceArtifact) && validArtifact(sourceArtifact, arm, input.region, runId);
  if (successful) {
    const artifactDirectory = path.join(runDirectory, 'artifacts');
    mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
    const artifactCopy = path.join(artifactDirectory, artifactName);
    if (existsSync(artifactCopy)) {
      throw new Error(`Refusing to overwrite prior collected artifact ${artifactName}`);
    }
    copyFileSync(sourceArtifact, artifactCopy);
    chmodSync(artifactCopy, 0o600);
    syncFile(artifactCopy);
    syncFile(artifactDirectory);
  }
  const end = {
    event: 'end',
    runId,
    status: successful ? 'succeeded' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    artifact: successful ? artifactName : null,
    finishedAt: new Date().toISOString(),
  };
  appendDurableEvent(ledgerPath, end);
  if (!successful) {
    throw new Error(`Benchmark attempt ${runId} failed; it remains in the ledger and must not be silently retried`);
  }
  completed = true;
  console.log(`Recorded ${runId} at ${revision.slice(0, 12)}`);
} finally {
  closeSync(lock);
  // A failed dispatched attempt needs explicit reconciliation before more wallet work.
  if (!dispatched || completed) {
    unlinkSync(lockPath);
  }
}

function requirePrivateInput(filePath) {
  const runtimeRoot = path.join(repoRoot, '.runtime', 'r150-hosted');
  if (!filePath.startsWith(`${runtimeRoot}${path.sep}`)) {
    throw new Error('Probe input must be inside the ignored .runtime/r150-hosted directory');
  }
  if ((statSync(filePath).mode & 0o077) !== 0) {
    throw new Error('Probe input contains an access token and must have mode 0600');
  }
}

function validateInput(input) {
  if (input.kind !== 'r150_hosted_probe_input_v1' || !['nrt', 'fra', 'iad'].includes(input.region)) {
    throw new Error('Invalid R150 probe input or region');
  }
  const probe = input.probe;
  if (probe?.provider !== 'fly' || probe.region !== input.region) {
    throw new Error('Fly probe region must match the selected cohort');
  }
  for (const name of ['instanceId', 'appName', 'observedAt', 'evidenceRef']) {
    if (typeof probe[name] !== 'string' || probe[name].length === 0) {
      throw new Error(`Missing probe ${name}`);
    }
  }
  for (const selectedArm of ['d1', 'do']) {
    const selected = input.arms?.[selectedArm];
    const expectedPrefix = `r150-bench-20260925-${selectedArm}`;
    if (typeof selected?.ingressUrl !== 'string') {
      throw new Error(`Missing ${selectedArm} benchmark ingress URL`);
    }
    const ingressUrl = new URL(selected.ingressUrl);
    if (
      ingressUrl.protocol !== 'https:' ||
      ingressUrl.hostname.split('.')[0] !== `${expectedPrefix}-ingress` ||
      ingressUrl.pathname !== '/' || ingressUrl.search !== '' || ingressUrl.hash !== '' ||
      !selected.environmentId?.startsWith(expectedPrefix) ||
      selected.signingWorkerId !== `${expectedPrefix}-signing-worker` ||
      typeof selected.publishableKey !== 'string' ||
      typeof selected.accessToken !== 'string' ||
      selected.accessToken.length < 32 ||
      !/^[0-9a-f]{64}$/u.test(selected.deploymentFingerprint)
    ) {
      throw new Error(`Invalid or unisolated ${selectedArm} probe values`);
    }
  }
  if (input.arms.d1.deploymentFingerprint === input.arms.do.deploymentFingerprint) {
    throw new Error('D1 and DO deployment fingerprints must differ');
  }
}

function completedAttemptCount(filePath, input, source) {
  if (!existsSync(filePath)) return 0;
  const ledger = readFileSync(filePath, 'utf8');
  if (!ledger.endsWith('\n')) {
    throw new Error('Attempt ledger has a truncated event; reconcile before further wallet work');
  }
  const lines = ledger.slice(0, -1).split('\n');
  if (lines.length > 80 || lines.length % 2 !== 0) {
    throw new Error('Attempt ledger has an unfinished or excess event; reconcile before further wallet work');
  }
  for (let index = 0; index < lines.length; index += 2) {
    const start = JSON.parse(lines[index]);
    const end = JSON.parse(lines[index + 1]);
    const sequence = index / 2 + 1;
    const previousCase = Math.ceil(sequence / 2);
    const previousArm = expectedArm(sequence);
    const runId = `${input.region}-case-${String(previousCase).padStart(2, '0')}-${previousArm}`;
    const artifactName = `gateway-ecdsa-unforced-timing-hosted_${previousArm}-${input.region}-${runId}-0.json`;
    const artifactPath = path.join(path.dirname(filePath), 'artifacts', artifactName);
    if (start.event !== 'start' || start.kind !== 'r150_hosted_attempt_v1' ||
        start.region !== input.region || start.caseIndex !== previousCase ||
        start.sequence !== sequence || start.arm !== previousArm || start.runId !== runId ||
        start.revision !== source.revision ||
        start.walletBuildInputHash !== source.walletBuildInputHash ||
        start.deploymentFingerprint !== input.arms[previousArm].deploymentFingerprint ||
        !isDeepStrictEqual(start.probe, input.probe) ||
        end.event !== 'end' || end.runId !== runId || end.status !== 'succeeded' ||
        end.exitCode !== 0 || end.signal !== null || end.artifact !== artifactName ||
        !existsSync(artifactPath) || !validArtifact(artifactPath, previousArm, input.region, runId)) {
      throw new Error(`Previous attempt ${runId} is inconsistent, unfinished, or failed; reconcile before further wallet work`);
    }
  }
  return lines.length / 2;
}

function appendDurableEvent(filePath, event) {
  const file = openSync(filePath, 'a', 0o600);
  try {
    const payload = Buffer.from(`${JSON.stringify(event)}\n`);
    let written = 0;
    while (written < payload.length) {
      const count = writeSync(file, payload, written, payload.length - written);
      if (count === 0) throw new Error('Attempt ledger write made no progress');
      written += count;
    }
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  syncFile(path.dirname(filePath));
}

function syncFile(filePath) {
  const file = openSync(filePath, 'r');
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
}

function validArtifact(filePath, arm, region, runId) {
  try {
    const artifact = JSON.parse(readFileSync(filePath, 'utf8'));
    return artifact.kind === 'gateway_ecdsa_unforced_hosted_timing_pilot_v1' &&
      artifact.requestedBackendProfile === `hosted_${arm}` &&
      artifact.probeRegion === region &&
      artifact.runId === runId &&
      artifact.repeatEachIndex === 0 &&
      artifact.sampleCountPerStage === 1 &&
      artifact.signaturesVerified === 2;
  } catch {
    return false;
  }
}

function expectedArm(sequence) {
  const caseIndex = Math.ceil(sequence / 2);
  const firstArm = caseIndex % 2 === 1 ? 'd1' : 'do';
  if (sequence % 2 === 1) return firstArm;
  return firstArm === 'd1' ? 'do' : 'd1';
}
