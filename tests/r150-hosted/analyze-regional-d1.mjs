#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [outputPath, probeRegion, ...directories] = process.argv.slice(2);
if (directories.length === 0 || !['apac', 'weur', 'enam'].includes(probeRegion)) {
  throw new Error(
    'Usage: analyze-regional-d1.mjs <output.json> <apac|weur|enam> <regional-cohort-directory> ...',
  );
}
const attempts = new Map();
const samples = [];
const cohorts = [];
const runs = [];
let baseline = null;
for (const directory of directories) {
  const root = path.resolve(directory);
  const run = readJson(path.join(root, 'run.json'));
  const probe = readJson(path.join(root, probeRegion, 'identity.json'));
  assert.equal(probe.cloudflareRegion, probeRegion.toUpperCase());
  assert.equal(probe.source.revision, run.source.revision);
  assert.equal(probe.source.walletBuildInputHash, run.source.walletBuildInputHash);
  assert.equal(run.workload, 'linked_chain');
  const identity = {
    source: run.source,
    gatewaySource: run.gatewaySource,
    databaseInventory: run.databaseInventory,
  };
  if (baseline === null) baseline = identity;
  else assert.deepEqual(identity, baseline, 'Cannot pool different builds or database assignments');
  runs.push({
    directory: path.basename(root),
    armOrder: run.armOrder,
    probeRegion,
    location: probe.location,
    bootId: probe.bootId,
  });
  const ledger = readFileSync(path.join(root, probeRegion, 'attempts.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(parseJson);
  for (const event of ledger) {
    if (event.event === 'started') {
      assert(!attempts.has(event.runId), 'Duplicate attempt');
      assert(['apac', 'weur'].includes(event.arm), 'Unknown database arm');
      assert.deepEqual(event.database, run.databaseInventory.arms[event.arm]);
      assert.deepEqual(event.source, run.source);
      assert.deepEqual(event.identity, probe);
      attempts.set(event.runId, { arm: event.arm, status: 'incomplete' });
    } else if (event.event === 'finished') {
      const attempt = attempts.get(event.runId);
      assert(attempt && attempt.status === 'incomplete', 'Missing or duplicate start');
      assert.equal(event.arm, attempt.arm);
      assert(['succeeded', 'failed'].includes(event.status));
      attempt.status = event.status;
      if (event.status === 'succeeded') {
        assert.equal(path.basename(event.artifact), event.artifact);
        const artifact = readJson(path.join(root, probeRegion, event.artifact));
        assert.equal(artifact.kind, 'gateway_ecdsa_linked_custody_chain_v1');
        assert.equal(artifact.verifiedSignatures, 9);
        assert.equal(artifact.signatures.length, 9);
        const deviceCounts = [0, 0, 0];
        const cohortSamples = [];
        for (const signature of artifact.signatures) {
          cohortSamples.push(analyzeSignature(signature, event));
          deviceCounts[signature.device - 1]++;
        }
        assert.deepEqual(deviceCounts, [3, 3, 3]);
        samples.push(...cohortSamples);
        cohorts.push({
          runId: event.runId,
          arm: event.arm,
          owner: summarize(selectSamples(cohortSamples, event.arm, 'owner')),
          linked: summarize(selectSamples(cohortSamples, event.arm, 'linked')),
        });
      }
    }
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
  arms[arm] = {
    attempts: outcomes,
    failedAttemptRate: outcomes.dispatched === 0 ? null : outcomes.failed / outcomes.dispatched,
    owner: summarize(selectSamples(samples, arm, 'owner')),
    linked: summarize(selectSamples(samples, arm, 'linked')),
  };
}
const comparisons = {};
for (const device of ['owner', 'linked']) {
  const control = arms.apac[device].sdkMs;
  const treatment = arms.weur[device].sdkMs;
  comparisons[device] =
    control && treatment
      ? {
          p50ReductionMs: control.p50 - treatment.p50,
          p95ReductionMs: control.p95 - treatment.p95,
          p95ReductionPercent: (100 * (control.p95 - treatment.p95)) / control.p95,
        }
      : null;
}
const output = {
  kind: 'regional_d1_linked_chain_comparison_v1',
  scope:
    'Ready-material ECDSA signing with automatic confirmation. Fresh wallet per attempt; repeated signatures within each wallet. Background refill excluded from the signature dependency window.',
  percentileMethod: 'Nearest rank; p50 is median. Small cohorts do not establish a tail bound.',
  probeRegion,
  runs,
  buildIdentity: baseline,
  arms,
  comparisons,
  cohorts,
  signatures: samples,
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ arms, comparisons }, null, 2));

function parseJson(value) {
  return JSON.parse(value);
}

function readJson(file) {
  return parseJson(readFileSync(file, 'utf8'));
}

function isDependency(request) {
  return (
    request.path === '/wallet/session/status' ||
    request.path === '/router-ab/ecdsa-derivation/sign/prepare' ||
    request.path === '/router-ab/ecdsa-derivation/sign'
  );
}

function analyzeSignature(signature, event) {
  assert([1, 2, 3].includes(signature.device));
  const owner = signature.device === 1;
  const requests = signature.gateway.requests;
  const dependencies = requests.filter(isDependency);
  const calls = [];
  let statusRequests = 0;
  for (const request of requests) {
    assert.notEqual(request.activity, 'foreground_refill');
  }
  for (const request of dependencies) {
    assert.equal(request.startedBeforeWindow, false);
    assert.equal(request.outcome, 'completed');
    assert.equal(request.status, 200);
    assert.equal(request.d1.version, 1);
    assert.equal(request.d1.pending, 0);
    assert.equal(request.d1.dropped, 0);
    if (request.path === '/wallet/session/status') {
      statusRequests++;
      assert.equal(request.d1.calls.length, 1);
    }
    calls.push(...request.d1.calls);
  }
  assert.equal(statusRequests, owner ? 2 : 0);
  assert.equal(dependencies.length, owner ? 4 : 2);
  assert.equal(calls.length, owner ? 7 : 5);
  let sqlStatements = 0;
  let writeCalls = 0;
  let rowsWritten = 0;
  let d1WallMs = 0;
  let sqlMs = 0;
  for (const call of calls) {
    assert.equal(call.outcome, 'ok');
    d1WallMs += call.elapsedMs;
    let writes = false;
    for (const statement of call.statements) {
      assert.equal(statement.region, event.arm.toUpperCase());
      assert.equal(statement.primary, true);
      sqlStatements++;
      rowsWritten += statement.rowsWritten;
      sqlMs += statement.sqlMs;
      if (statement.rowsWritten > 0) writes = true;
    }
    if (writes) writeCalls++;
  }
  assert.equal(sqlStatements, owner ? 8 : 6);
  assert.equal(writeCalls, 2);
  assert.equal(rowsWritten, 14);
  return {
    runId: event.runId,
    arm: event.arm,
    device: signature.device,
    signature: signature.signature,
    sdkMs: signature.clientTiming.publicSdkCallMs,
    d1WallMs,
    sqlMs,
    httpRequests: dependencies.length,
    d1Calls: calls.length,
    sqlStatements,
    writeCalls,
    rowsWritten,
  };
}

function selectSamples(samples, arm, device) {
  const selected = [];
  for (const sample of samples) {
    if (sample.arm === arm && (sample.device === 1) === (device === 'owner')) {
      selected.push(sample);
    }
  }
  return selected;
}

function numericOrder(a, b) {
  return a - b;
}

function summarize(samples) {
  const result = { signatures: samples.length };
  for (const key of ['sdkMs', 'd1WallMs', 'sqlMs']) {
    const values = [];
    for (const sample of samples) {
      assert(Number.isFinite(sample[key]) && sample[key] >= 0);
      values.push(sample[key]);
    }
    values.sort(numericOrder);
    const count = values.length;
    result[key] =
      count === 0
        ? null
        : {
            min: values[0],
            p50: (values[Math.floor((count - 1) / 2)] + values[Math.floor(count / 2)]) / 2,
            p95: values[Math.ceil(count * 0.95) - 1],
            max: values[count - 1],
          };
  }
  return result;
}
