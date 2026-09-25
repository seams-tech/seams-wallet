#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeRoot = path.join(repoRoot, '.runtime', 'r150-hosted');
mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
const sourcePath = path.join(runtimeRoot, 'probe-source.json');
const runDirectory = mkdtempSync(path.join(runtimeRoot, 'runner-preflight-e2e-'));
const inputPath = path.join(runDirectory, 'input.json');
const ledgerPath = path.join(runDirectory, 'attempts.jsonl');
const artifactDirectory = path.join(runDirectory, 'artifacts');
const artifactName = 'gateway-ecdsa-unforced-timing-hosted_d1-nrt-nrt-case-01-d1-0.json';
const artifactPath = path.join(artifactDirectory, artifactName);
const runId = 'nrt-case-01-d1';
let createdSource = false;

try {
  if (!existsSync(sourcePath)) {
    writeFileSync(sourcePath, JSON.stringify({
      kind: 'r150_hosted_probe_source_v1',
      revision: 'a'.repeat(40),
      walletBuildInputHash: 'b'.repeat(64),
    }), { flag: 'wx', mode: 0o600 });
    createdSource = true;
  }
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const input = {
    kind: 'r150_hosted_probe_input_v1',
    region: 'nrt',
    probe: {
      provider: 'fly',
      region: 'nrt',
      instanceId: 'synthetic-machine',
      appName: 'synthetic-probe',
      observedAt: '2026-09-25T00:00:00.000Z',
      evidenceRef: 'machine-status.json',
    },
    arms: {
      d1: armInput('d1', 'c'),
      do: armInput('do', 'd'),
    },
  };
  const start = {
    event: 'start',
    kind: 'r150_hosted_attempt_v1',
    region: 'nrt',
    caseIndex: 1,
    sequence: 1,
    arm: 'd1',
    runId,
    revision: source.revision,
    walletBuildInputHash: source.walletBuildInputHash,
    deploymentFingerprint: input.arms.d1.deploymentFingerprint,
    probe: input.probe,
    startedAt: '2026-09-25T00:00:00.000Z',
  };
  const end = {
    event: 'end',
    runId,
    status: 'succeeded',
    exitCode: 0,
    signal: null,
    artifact: artifactName,
    finishedAt: '2026-09-25T00:00:01.000Z',
  };
  mkdirSync(artifactDirectory, { mode: 0o700 });
  writeFileSync(path.join(runDirectory, 'machine-status.json'), '{}', { mode: 0o600 });
  writeFileSync(artifactPath, JSON.stringify({
    kind: 'gateway_ecdsa_unforced_hosted_timing_pilot_v1',
    requestedBackendProfile: 'hosted_d1',
    probeRegion: 'nrt',
    runId,
    repeatEachIndex: 0,
    sampleCountPerStage: 1,
    signaturesVerified: 2,
  }), { mode: 0o600 });

  const changedDeployment = structuredClone(input);
  changedDeployment.arms.d1.deploymentFingerprint = 'e'.repeat(64);
  assertRejected(changedDeployment, [start, end]);

  const changedProbe = structuredClone(input);
  changedProbe.probe.observedAt = '2026-09-25T00:00:02.000Z';
  assertRejected(changedProbe, [start, end]);

  assertRejected(input, [start]);
  assertRejected(input, [start, { ...end, status: 'failed', exitCode: 1, artifact: null }]);
  assertRejected(input, [start, end], false);

  unlinkSync(artifactPath);
  assertRejected(input, [start, end]);

  const evidence = {
    kind: 'r150_hosted_runner_preflight_e2e_v1',
    synthetic: true,
    rejectedWithoutDispatch: [
      'changed_deployment', 'changed_probe', 'unfinished', 'failed',
      'truncated_ledger', 'missing_artifact',
    ],
    sourceRevision: source.revision,
    sourceBuildHash: source.walletBuildInputHash,
    proofSha256: createHash('sha256').update(readFileSync(ledgerPath)).digest('hex'),
    reproduce: 'node tests/r150-hosted/run-sample-preflight.e2e.mjs',
  };
  const evidencePath = path.join(runtimeRoot, 'runner-preflight-e2e.result.json');
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`R150 hosted runner preflight E2E passed; evidence: ${evidencePath}`);
} finally {
  rmSync(runDirectory, { recursive: true, force: true });
  if (createdSource) unlinkSync(sourcePath);
}

function armInput(arm, fingerprintCharacter) {
  const prefix = `r150-bench-20260925-${arm}`;
  return {
    ingressUrl: `https://${prefix}-ingress.example.workers.dev/`,
    environmentId: `${prefix}-environment`,
    publishableKey: `${prefix}-publishable-key`,
    signingWorkerId: `${prefix}-signing-worker`,
    deploymentFingerprint: fingerprintCharacter.repeat(64),
    accessToken: 'synthetic-token-'.repeat(3),
  };
}

function assertRejected(input, events, completeLine = true) {
  writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
  const lines = [];
  for (const event of events) lines.push(JSON.stringify(event));
  const originalLedger = `${lines.join('\n')}${completeLine ? '\n' : ''}`;
  writeFileSync(ledgerPath, originalLedger, { mode: 0o600 });
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, 'tests', 'r150-hosted', 'run-sample.mjs'), inputPath, '1', 'do',
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FLY_REGION: 'nrt',
      FLY_MACHINE_ID: 'synthetic-machine',
      FLY_APP_NAME: 'synthetic-probe',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile before further wallet work/u);
  assert.equal(readFileSync(ledgerPath, 'utf8'), originalLedger);
  assert.equal(existsSync(path.join(runDirectory, 'sample.lock')), false);
}
