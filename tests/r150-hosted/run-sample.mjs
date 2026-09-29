#!/usr/bin/env node
// Runs one attempt of the R150 hosted pilot for one probe region, from the
// operator's machine: the region's probe container runs the browser, and this
// runner keeps the region's attempt ledger. It records the attempt's start
// before any wallet work, refuses to continue after a failed or unfinished
// attempt, and requires every attempt to run on the container the cohort
// recorded: the same application, Durable Object, location and boot.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROBE_REGIONS = { apac: 'APAC', weur: 'WEUR', enam: 'ENAM' };
const IDENTITY_FIELDS = [
  'applicationId',
  'instanceId',
  'location',
  'cloudflareRegion',
  'countryA2',
  'bootId',
];
/** An attempt that has not finished by then is recorded as failed. */
const ATTEMPT_TIMEOUT_MS = 15 * 60_000;
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
  throw new Error('Probe identity evidence must exist inside the private probe directory');
}
const caseIndex = Number(caseText);
// The source and wallet build the probe image was built from.
const source = input.source;
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
  const artifactDirectory = path.join(runDirectory, 'artifacts');
  const artifactCopy = path.join(artifactDirectory, artifactName);
  if (existsSync(artifactCopy)) {
    throw new Error(`Refusing to overwrite prior collected artifact ${artifactName}`);
  }
  // The probe must still be the container this cohort recorded, on its image.
  requireSameProbe(await probeRequest(input, 'GET', 'identity'), input);

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
  const result = await runOnProbe(input, {
    runId,
    arm,
    region: input.region,
    selected: {
      ingressUrl: selected.ingressUrl,
      environmentId: selected.environmentId,
      publishableKey: selected.publishableKey,
      signingWorkerId: selected.signingWorkerId,
      accessToken: selected.accessToken,
    },
    expectedIdentity: input.probe,
  });
  const logDirectory = path.join(runDirectory, 'logs');
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(logDirectory, `${runId}.log`), result.outputTail ?? '', { mode: 0o600 });
  const sameProbe = sameProbeIdentity(result.identity, input);
  const successful = result.exitCode === 0 && result.signal === null && sameProbe &&
    result.artifactName === artifactName &&
    validArtifactRecord(result.artifact, arm, input.region, runId);
  if (successful) {
    mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(artifactCopy, `${JSON.stringify(result.artifact, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    syncFile(artifactCopy);
    syncFile(artifactDirectory);
  }
  const end = {
    event: 'end',
    runId,
    status: successful ? 'succeeded' : 'failed',
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    ...(sameProbe ? {} : { probeChanged: true }),
    ...(result.error ? { error: result.error } : {}),
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

/** One request to the region's probe, authenticated with the probe token. */
async function probeRequest(input, method, route, body) {
  const url = new URL(`${input.region}/${route}`, input.probe.workerUrl);
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${input.probeAccessToken}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok || json === null) {
    throw new Error(`Probe ${method} ${route} answered ${response.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

/**
 * Starts the attempt on the probe and waits for its result. A probe that
 * refuses the attempt, loses it or does not finish in time yields a failed
 * result, which the ledger records.
 */
async function runOnProbe(input, attempt) {
  try {
    await probeRequest(input, 'POST', 'attempts', attempt);
    const deadline = Date.now() + ATTEMPT_TIMEOUT_MS;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const state = await probeRequest(input, 'GET', `attempts/${attempt.runId}`);
      if (state.status === 'finished') return state.result;
      if (Date.now() > deadline) {
        return { exitCode: null, signal: null, error: 'the attempt did not finish in time' };
      }
    }
  } catch (error) {
    return {
      exitCode: null,
      signal: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sameProbeIdentity(identity, input) {
  return (
    identity?.kind === 'r150_hosted_probe_identity_v1' &&
    identity.provider === 'cloudflare' &&
    IDENTITY_FIELDS.every((name) => identity[name] === input.probe[name]) &&
    identity.source?.revision === input.source.revision &&
    identity.source?.walletBuildInputHash === input.source.walletBuildInputHash
  );
}

function requireSameProbe(identity, input) {
  if (!sameProbeIdentity(identity, input)) {
    throw new Error(
      'The probe container differs from the recorded probe (application, object, location, boot or image); record a new cohort instead of continuing',
    );
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
  if (input.kind !== 'r150_hosted_probe_input_v1' || !PROBE_REGIONS[input.region]) {
    throw new Error('Invalid R150 probe input or region');
  }
  const probe = input.probe;
  if (
    probe?.provider !== 'cloudflare' ||
    probe.region !== input.region ||
    probe.regionConstraint !== PROBE_REGIONS[input.region]
  ) {
    throw new Error('The Cloudflare probe must be placed by the selected cohort region');
  }
  for (const name of [...IDENTITY_FIELDS, 'observedAt', 'evidenceRef']) {
    if (typeof probe[name] !== 'string' || probe[name].length === 0) {
      throw new Error(`Missing probe ${name}`);
    }
  }
  const workerUrl = new URL(probe.workerUrl);
  if (
    workerUrl.protocol !== 'https:' ||
    workerUrl.hostname.split('.')[0] !== 'r150-bench-20260925-probe' ||
    workerUrl.pathname !== '/'
  ) {
    throw new Error('The probe Worker URL must name the isolated R150 probe');
  }
  if (typeof input.probeAccessToken !== 'string' || input.probeAccessToken.length < 32) {
    throw new Error('Missing probe access token');
  }
  if (
    input.source?.kind !== 'r150_hosted_probe_source_v1' ||
    !/^[0-9a-f]{40}$/u.test(input.source.revision) ||
    !/^[0-9a-f]{64}$/u.test(input.source.walletBuildInputHash)
  ) {
    throw new Error('Probe input has no valid committed source and wallet build fingerprint');
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
    return validArtifactRecord(JSON.parse(readFileSync(filePath, 'utf8')), arm, region, runId);
  } catch {
    return false;
  }
}

function validArtifactRecord(artifact, arm, region, runId) {
  return artifact?.kind === 'gateway_ecdsa_unforced_hosted_timing_pilot_v1' &&
    artifact.requestedBackendProfile === `hosted_${arm}` &&
    artifact.probeRegion === region &&
    artifact.runId === runId &&
    artifact.repeatEachIndex === 0 &&
    artifact.sampleCountPerStage === 1 &&
    artifact.signaturesVerified === 2;
}

function expectedArm(sequence) {
  const caseIndex = Math.ceil(sequence / 2);
  const firstArm = caseIndex % 2 === 1 ? 'd1' : 'do';
  if (sequence % 2 === 1) return firstArm;
  return firstArm === 'd1' ? 'do' : 'd1';
}
