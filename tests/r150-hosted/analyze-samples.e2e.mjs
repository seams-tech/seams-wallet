#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceDirectory, '../..');
const sampleRoot = mkdtempSync(path.join(os.tmpdir(), 'r150-hosted-analysis-'));
const revision = 'a'.repeat(40);
const walletBuildInputHash = 'd'.repeat(64);
const fingerprint = { d1: 'b'.repeat(64), do: 'c'.repeat(64) };
const regionDirectories = [];

for (const region of ['nrt', 'fra', 'iad']) {
  const runDirectory = path.join(sampleRoot, region);
  const artifactDirectory = path.join(runDirectory, 'artifacts');
  mkdirSync(artifactDirectory, { recursive: true });
  regionDirectories.push(runDirectory);
  const lines = [];
  for (let sequence = 1; sequence <= 40; sequence += 1) {
    const caseIndex = Math.ceil(sequence / 2);
    const arm = expectedArm(sequence);
    const runId = `${region}-case-${String(caseIndex).padStart(2, '0')}-${arm}`;
    const artifactName = `gateway-ecdsa-unforced-timing-hosted_${arm}-${region}-${runId}-0.json`;
    const startedAt = new Date(Date.parse('2026-09-25T00:00:00.000Z') + sequence * 2000);
    const finishedAt = new Date(startedAt.getTime() + 1000);
    lines.push(JSON.stringify({
      event: 'start',
      kind: 'r150_hosted_attempt_v1',
      region,
      caseIndex,
      sequence,
      arm,
      runId,
      revision,
      walletBuildInputHash,
      deploymentFingerprint: fingerprint[arm],
      probe: {
        provider: 'fly',
        region,
        instanceId: `synthetic-${region}`,
        appName: 'synthetic-probe',
        observedAt: '2026-09-25T00:00:00.000Z',
        evidenceRef: 'synthetic-machine-status.json',
      },
      startedAt: startedAt.toISOString(),
    }));
    lines.push(JSON.stringify({
      event: 'end',
      runId,
      status: 'succeeded',
      exitCode: 0,
      signal: null,
      artifact: artifactName,
      finishedAt: finishedAt.toISOString(),
    }));
    writeFileSync(path.join(artifactDirectory, artifactName),
      `${JSON.stringify(artifact(region, arm, runId, caseIndex))}\n`);
  }
  writeFileSync(path.join(runDirectory, 'attempts.jsonl'), `${lines.join('\n')}\n`);
}

const completePath = path.join(sampleRoot, 'complete.json');
const complete = runAnalysis(regionDirectories, completePath);
assert.equal(complete.status, 0, complete.stderr);
const completeReport = JSON.parse(readFileSync(completePath, 'utf8'));
assert.equal(completeReport.complete, true);
for (const region of ['nrt', 'fra', 'iad']) {
  assert.equal(completeReport.regions[region].pairedCases.n, 20);
  assert.equal(completeReport.regions[region].arms.d1.phases.firstSigning.elapsedMs.n, 20);
  assert.equal(completeReport.regions[region].arms.do.phases.subsequentSigning.elapsedMs.n, 20);
  assert.equal(completeReport.regions[region].arms.do.phases.firstSigning.samplesWithServerTiming, 20);
  assert.ok(completeReport.regions[region].p95DoVsD1Percent.firstSigning < 0);
}

const failedDirectory = regionDirectories[1];
const failedLedgerPath = path.join(failedDirectory, 'attempts.jsonl');
const failedLines = readFileSync(failedLedgerPath, 'utf8').trim().split('\n').slice(0, 8);
const failedEnd = JSON.parse(failedLines[7]);
failedEnd.status = 'failed';
failedEnd.exitCode = 1;
failedEnd.artifact = null;
failedLines[7] = JSON.stringify(failedEnd);
writeFileSync(failedLedgerPath, `${failedLines.join('\n')}\n`);
const incompletePath = path.join(sampleRoot, 'incomplete.json');
const incomplete = runAnalysis(regionDirectories, incompletePath);
assert.equal(incomplete.status, 1, incomplete.stderr);
const incompleteReport = JSON.parse(readFileSync(incompletePath, 'utf8'));
assert.equal(incompleteReport.complete, false);
assert.equal(incompleteReport.regions.fra.failures.length, 1);
assert.equal(incompleteReport.regions.fra.pairedCases.n, 1);

const evidenceRoot = path.join(repoRoot, '.runtime', 'r150-hosted');
mkdirSync(evidenceRoot, { recursive: true });
const resultPath = path.join(evidenceRoot, 'analyzer-e2e.result.json');
const result = {
  kind: 'r150_hosted_analyzer_e2e_v1',
  synthetic: true,
  fullCohortAttempts: 120,
  fullCohortComplete: completeReport.complete,
  failureRejected: !incompleteReport.complete,
  retainedPairCountAfterFailure: incompleteReport.regions.fra.pairedCases.n,
  fullReportSha256: createHash('sha256').update(readFileSync(completePath)).digest('hex'),
  reproduce: 'node tests/r150-hosted/analyze-samples.e2e.mjs',
};
writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(`R150 hosted analyzer E2E passed; evidence: ${resultPath}`);

function artifact(region, arm, runId, caseIndex) {
  const base = arm === 'd1' ? 300 : 200;
  const offset = region === 'nrt' ? 0 : region === 'fra' ? 100 : 120;
  return {
    kind: 'gateway_ecdsa_unforced_hosted_timing_pilot_v1',
    requestedBackendProfile: `hosted_${arm}`,
    probeRegion: region,
    runId,
    repeatEachIndex: 0,
    gatewayOrigin: `https://r150-bench-20260925-${arm}-ingress.example.workers.dev`,
    sampleCountPerStage: 1,
    timingPurpose: 'hosted_pilot_not_release_gate',
    registrationReturn: phase(base + offset + caseIndex),
    firstSigning: phase(base + offset + caseIndex + 50),
    subsequentSigning: phase(base + offset + caseIndex - 40),
    signaturesVerified: 2,
  };
}

function phase(elapsedMs) {
  return {
    elapsedMs,
    gatewayRequestCounts: { '/wallet/session/status': 2 },
    presignRefillRequestCounts: { background_step: 1 },
    gatewayServerTimings: [{
      path: '/router-ab/ecdsa-derivation/sign',
      status: 200,
      stagesMs: { ecdsa_sign_total: elapsedMs / 2 },
    }],
  };
}

function expectedArm(sequence) {
  const caseIndex = Math.ceil(sequence / 2);
  const firstArm = caseIndex % 2 === 1 ? 'd1' : 'do';
  if (sequence % 2 === 1) return firstArm;
  return firstArm === 'd1' ? 'do' : 'd1';
}

function runAnalysis(directories, outputPath) {
  return spawnSync(process.execPath, [
    path.join(sourceDirectory, 'analyze-samples.mjs'),
    ...directories,
    '--complete',
    '--output', outputPath,
  ], { cwd: repoRoot, encoding: 'utf8' });
}
