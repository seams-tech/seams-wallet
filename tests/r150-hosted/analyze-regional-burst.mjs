#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [outputPath, probeRegion, directory] = process.argv.slice(2);
if (process.argv.length !== 5 || !['apac', 'weur', 'enam'].includes(probeRegion)) {
  throw new Error(
    'Usage: analyze-regional-burst.mjs <output.json> <apac|weur|enam> <cohort-directory>',
  );
}
const root = path.resolve(directory);
const run = readJson(path.join(root, 'run.json'));
const probe = readJson(path.join(root, probeRegion, 'identity.json'));
assert.equal(run.workload, 'first_warm_burst');
assert.equal(probe.cloudflareRegion, probeRegion.toUpperCase());
assert.equal(probe.source.revision, run.source.revision);
assert.equal(probe.source.walletBuildInputHash, run.source.walletBuildInputHash);
const analyzer = fileURLToPath(new URL('./analyze-d1.mjs', import.meta.url));
const stages = new Map([
  ['firstSigning', 1],
  ['warmSigning', 1],
  ['concurrentBurst', 2],
]);
const totalFields = [
  'calls',
  'statements',
  'writeCalls',
  'rowsWritten',
  'summedCallWallMs',
  'sqlMs',
];
const attempts = new Map();
const samples = [];
const windows = [];
const failedAttempts = [];
const backgroundRefillFailures = [];
const ledger = readFileSync(path.join(root, probeRegion, 'attempts.jsonl'), 'utf8')
  .trim()
  .split('\n');
for (const line of ledger) {
  const event = JSON.parse(line);
  assert(['apac', 'weur'].includes(event.arm));
  if (event.event === 'started') {
    assert(!attempts.has(event.runId), 'Duplicate attempt');
    assert.deepEqual(event.database, run.databaseInventory.arms[event.arm]);
    assert.deepEqual(event.identity, probe);
    assert.deepEqual(event.source, run.source);
    attempts.set(event.runId, { arm: event.arm, status: 'incomplete' });
    continue;
  }
  assert.equal(event.event, 'finished');
  const attempt = attempts.get(event.runId);
  assert(attempt && attempt.status === 'incomplete', 'Missing or duplicate start');
  assert.equal(attempt.arm, event.arm);
  assert(['succeeded', 'failed'].includes(event.status));
  attempt.status = event.status;
  if (event.status === 'failed') {
    failedAttempts.push(event);
    continue;
  }
  assert.equal(path.basename(event.artifact), event.artifact);
  const file = path.join(root, probeRegion, event.artifact);
  const artifact = readJson(file);
  assert.equal(artifact.kind, 'gateway_ecdsa_first_warm_burst_diagnostic_v1');
  assert.equal(artifact.signaturesVerified, 5);
  assert.equal(artifact.warmSigning.selectedServerMaterialCompletedBeforeStart, true);
  assert.equal(artifact.concurrentBurst.sharedBudgetExhausted, true);
  const failures = artifact.backgroundRefills.filter(isFailedRefill).length;
  if (failures > 0)
    backgroundRefillFailures.push({ runId: event.runId, arm: event.arm, count: failures });
  const analysis = JSON.parse(
    execFileSync(process.execPath, [analyzer, file], { encoding: 'utf8' }),
  );
  for (const query of analysis.queries) {
    assert.deepEqual(query.regions, [event.arm.toUpperCase()]);
    assert.deepEqual(query.primary, [true]);
  }
  for (const [stage, signatureCount] of stages) {
    const window = artifact[stage];
    const totals = Object.fromEntries(totalFields.map(zeroTotal));
    let signRequests = 0;
    let statusRequests = 0;
    let statusD1Calls = 0;
    for (const request of analysis.requests) {
      if (request.stage !== stage) continue;
      if (request.path === '/wallet/session/status') {
        statusRequests++;
        statusD1Calls += request.calls;
      }
      if (!isSigningRequest(request)) continue;
      signRequests++;
      assert.equal(request.status, 200);
      assert.equal(request.unknownRows, 0);
      assert.equal(request.unknownSql, 0);
      assert.equal(request.calls, request.path.endsWith('/prepare') ? 2 : 3);
      for (const field of totalFields) totals[field] += request[field];
    }
    assert.equal(signRequests, signatureCount * 2);
    assert.equal(totals.calls, signatureCount * 5);
    assert.equal(totals.statements, signatureCount * 6);
    assert.equal(totals.writeCalls, signatureCount * 2);
    assert.equal(totals.rowsWritten, signatureCount * 14);
    const sdkEvents = window.clientTiming.stages.filter(isSdkCall);
    assert.equal(sdkEvents.length, signatureCount);
    for (const sdk of sdkEvents) {
      assert(Number.isFinite(sdk.durationMs) && sdk.durationMs >= 0);
      samples.push({ runId: event.runId, arm: event.arm, stage, sdkMs: sdk.durationMs });
    }
    windows.push({
      runId: event.runId,
      arm: event.arm,
      stage,
      signatures: signatureCount,
      signingD1: totals,
      statusRequests,
      statusD1Calls,
      browserHarnessMs: window.elapsedMs,
      refillRequests: window.presignRefillRequestCounts,
      burstMaterialsReady:
        stage === 'concurrentBurst'
          ? artifact.concurrentBurst.selectedServerMaterialsCompletedBeforeStart
          : null,
    });
  }
}
const arms = {};
for (const arm of ['apac', 'weur']) {
  const outcomes = { dispatched: 0, succeeded: 0, failed: 0, incomplete: 0 };
  for (const attempt of attempts.values()) {
    if (attempt.arm !== arm) continue;
    outcomes.dispatched++;
    outcomes[attempt.status]++;
  }
  const sdkMs = {};
  for (const stage of stages.keys()) {
    const durations = [];
    for (const sample of samples) {
      if (sample.arm === arm && sample.stage === stage) durations.push(sample.sdkMs);
    }
    sdkMs[stage] = distribution(durations);
  }
  arms[arm] = { attempts: outcomes, sdkMs };
}
const result = {
  kind: 'regional_d1_first_warm_burst_diagnostic_v1',
  scope:
    'Fresh mixed wallet; first and ready-material warm signing, then a fresh three-use session with one untimed setup signature and two concurrent signatures consuming the remaining shared quota. SDK includes automatic confirmation. Concurrent durations overlap.',
  percentileMethod: 'Nearest rank; p50 is median. Small cohorts do not establish a tail bound.',
  run,
  probe,
  arms,
  samples,
  windows,
  failedAttempts,
  backgroundRefillFailures,
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(arms, null, 2));

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}
function isFailedRefill(event) {
  return event.outcome === 'failed';
}
function zeroTotal(field) {
  return [field, 0];
}
function isSdkCall(event) {
  return event.stage === 'public_sdk_call';
}
function isSigningRequest(request) {
  return (
    request.path === '/router-ab/ecdsa-derivation/sign/prepare' ||
    request.path === '/router-ab/ecdsa-derivation/sign'
  );
}
function byNumber(a, b) {
  return a - b;
}
function distribution(values) {
  if (values.length === 0) return null;
  const sorted = values.sort(byNumber);
  const n = sorted.length;
  const middle = Math.floor(n / 2);
  const p50 = n % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return { n, min: sorted[0], p50, p95: sorted[Math.ceil(n * 0.95) - 1], max: sorted[n - 1] };
}
