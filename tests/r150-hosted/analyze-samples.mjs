#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Cloudflare Containers placement regions, by their cohort names. */
const PROBE_REGIONS = { apac: 'APAC', weur: 'WEUR', enam: 'ENAM' };

const argumentsList = process.argv.slice(2);
const requireComplete = argumentsList.includes('--complete');
const outputIndex = argumentsList.indexOf('--output');
let outputPath = null;
if (outputIndex !== -1) {
  outputPath = argumentsList[outputIndex + 1];
  if (!outputPath) throw new Error('--output requires a report path');
  argumentsList.splice(outputIndex, 2);
}
const directoryNames = argumentsList.filter((argument) => argument !== '--complete');
if (directoryNames.length === 0 || directoryNames.length > 3 ||
    directoryNames.some((argument) => argument.startsWith('--'))) {
  throw new Error('Usage: node tests/r150-hosted/analyze-samples.mjs <region-run-dir> [other-region-run-dir...] [--complete] [--output <report.json>]');
}

const reports = {};
const revisions = new Set();
const walletBuilds = new Set();
const fingerprints = { d1: new Set(), do: new Set() };
for (const directoryName of directoryNames) {
  const report = analyzeRegion(path.resolve(directoryName));
  if (reports[report.region]) throw new Error(`Duplicate region ${report.region}`);
  reports[report.region] = report;
  if (report.revision) revisions.add(report.revision);
  if (report.walletBuildInputHash) walletBuilds.add(report.walletBuildInputHash);
  for (const arm of ['d1', 'do']) {
    if (report.deploymentFingerprints[arm]) {
      fingerprints[arm].add(report.deploymentFingerprints[arm]);
    }
  }
}
const allRegions = Object.keys(PROBE_REGIONS).every((region) => reports[region]?.complete === true);
const sameRevision = revisions.size === 1;
const sameWalletBuild = walletBuilds.size === 1;
const sameDeployments = fingerprints.d1.size === 1 && fingerprints.do.size === 1 &&
  [...fingerprints.d1][0] !== [...fingerprints.do][0];
const report = {
  kind: 'r150_hosted_comparison_report_v1',
  purpose: 'isolated_pilot_not_release_gate',
  percentileConvention: 'nearest_rank: sorted[ceil(p*n)-1]; 20 samples per arm and phase required',
  complete: allRegions && sameRevision && sameWalletBuild && sameDeployments,
  consistency: { sameRevision, sameWalletBuild, sameDeployments },
  regions: reports,
  cost: { status: 'pending_measured_cloudflare_and_probe_usage' },
  doPlacement: { status: 'unknown_without_direct_role_execution_evidence' },
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const resolvedOutput = path.resolve(outputPath);
  if (existsSync(resolvedOutput)) {
    if (readFileSync(resolvedOutput, 'utf8') !== serialized) {
      throw new Error(`Refusing to overwrite a different report: ${resolvedOutput}`);
    }
  } else {
    writeFileSync(resolvedOutput, serialized, { flag: 'wx', mode: 0o600 });
  }
  console.log(`Wrote ${resolvedOutput}`);
} else {
  process.stdout.write(serialized);
}
if (requireComplete && !report.complete) process.exitCode = 1;

function analyzeRegion(runDirectory) {
  const ledgerPath = path.join(runDirectory, 'attempts.jsonl');
  if (!existsSync(ledgerPath)) throw new Error(`Missing attempt ledger: ${ledgerPath}`);
  const starts = [];
  const ends = new Map();
  for (const line of readFileSync(ledgerPath, 'utf8').trim().split('\n')) {
    if (line === '') continue;
    const entry = JSON.parse(line);
    if (entry.event === 'start') {
      starts.push(entry);
    } else if (entry.event === 'end') {
      if (ends.has(entry.runId)) throw new Error(`Duplicate terminal event for ${entry.runId}`);
      ends.set(entry.runId, entry);
    } else {
      throw new Error(`Unknown attempt ledger event ${entry.event}`);
    }
  }
  if (starts.length === 0 || starts.length > 40) throw new Error('Expected 1..40 bounded attempts');
  const region = starts[0].region;
  if (!PROBE_REGIONS[region]) throw new Error(`Invalid region ${region}`);
  const revision = starts[0].revision;
  const walletBuildInputHash = starts[0].walletBuildInputHash;
  const probe = starts[0].probe;
  if (!/^[0-9a-f]{40}$/u.test(revision) ||
      !/^[0-9a-f]{64}$/u.test(walletBuildInputHash) ||
      probe?.provider !== 'cloudflare' ||
      probe.region !== region || probe.regionConstraint !== PROBE_REGIONS[region] ||
      !probe.applicationId || !probe.instanceId || !probe.location || !probe.bootId ||
      !probe.evidenceRef || !Number.isFinite(Date.parse(probe.observedAt))) {
    throw new Error(`Invalid revision or probe identity in ${region} ledger`);
  }
  const deploymentFingerprints = {};
  const samples = { d1: [], do: [] };
  const failures = [];
  const seenRunIds = new Set();
  let previousFinishedAt = -Infinity;
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const sequence = index + 1;
    const caseIndex = Math.ceil(sequence / 2);
    const arm = expectedArm(sequence);
    const expectedRunId = `${region}-case-${String(caseIndex).padStart(2, '0')}-${arm}`;
    if (start.kind !== 'r150_hosted_attempt_v1' || start.region !== region ||
        start.sequence !== sequence || start.caseIndex !== caseIndex ||
        start.arm !== arm || start.runId !== expectedRunId ||
        start.revision !== revision ||
        start.walletBuildInputHash !== walletBuildInputHash ||
        JSON.stringify(start.probe) !== JSON.stringify(probe) ||
        seenRunIds.has(start.runId)) {
      throw new Error(`Invalid pairing, provenance, or execution order at attempt ${sequence}`);
    }
    const startedAt = Date.parse(start.startedAt);
    if (!Number.isFinite(startedAt) || startedAt < previousFinishedAt) {
      throw new Error(`Overlapping or invalid attempt time for ${start.runId}`);
    }
    seenRunIds.add(start.runId);
    if (!/^[0-9a-f]{64}$/u.test(start.deploymentFingerprint)) {
      throw new Error(`Invalid deployment fingerprint for ${start.runId}`);
    }
    if (deploymentFingerprints[arm] &&
        deploymentFingerprints[arm] !== start.deploymentFingerprint) {
      throw new Error(`${arm} deployment changed within the ${region} cohort`);
    }
    deploymentFingerprints[arm] = start.deploymentFingerprint;
    const end = ends.get(start.runId);
    if (!end || end.status !== 'succeeded') {
      failures.push({ runId: start.runId, status: end?.status ?? 'unfinished' });
      if (index !== starts.length - 1) {
        throw new Error(`Attempt continued after failed or unfinished ${start.runId}`);
      }
      continue;
    }
    const finishedAt = Date.parse(end.finishedAt);
    if (!Number.isFinite(finishedAt) || finishedAt < startedAt) {
      throw new Error(`Invalid completion time for ${start.runId}`);
    }
    previousFinishedAt = finishedAt;
    const expectedArtifact = `gateway-ecdsa-unforced-timing-hosted_${arm}-${region}-${start.runId}-0.json`;
    if (end.artifact !== expectedArtifact || end.exitCode !== 0 || end.signal !== null) {
      throw new Error(`Invalid completion event for ${start.runId}`);
    }
    const artifact = JSON.parse(readFileSync(path.join(runDirectory, 'artifacts', expectedArtifact), 'utf8'));
    validateArtifact(artifact, start);
    samples[arm].push({ caseIndex, artifact });
  }
  for (const runId of ends.keys()) {
    if (!seenRunIds.has(runId)) throw new Error(`Terminal event without a started attempt: ${runId}`);
  }
  const armReports = { d1: summarizeArm(samples.d1), do: summarizeArm(samples.do) };
  const pairedCases = pairedDeltas(samples);
  const complete = starts.length === 40 && failures.length === 0 &&
    samples.d1.length === 20 && samples.do.length === 20;
  return {
    region,
    complete,
    revision,
    walletBuildInputHash,
    deploymentFingerprints,
    probe: {
      status: 'reported_by_the_container_runtime_requires_evidence_review',
      provider: probe.provider,
      region: probe.region,
      regionConstraint: probe.regionConstraint,
      location: probe.location,
      cloudflareRegion: probe.cloudflareRegion,
      countryA2: probe.countryA2,
      applicationId: probe.applicationId,
      instanceId: probe.instanceId,
      bootId: probe.bootId,
      observedAt: probe.observedAt,
      evidenceRef: probe.evidenceRef,
    },
    attemptCount: starts.length,
    failures,
    arms: armReports,
    pairedCases,
    p95DoVsD1Percent: compareP95(armReports),
  };
}

function validateArtifact(artifact, start) {
  if (artifact.kind !== 'gateway_ecdsa_unforced_hosted_timing_pilot_v1' ||
      artifact.requestedBackendProfile !== `hosted_${start.arm}` ||
      artifact.probeRegion !== start.region || artifact.runId !== start.runId ||
      artifact.repeatEachIndex !== 0 || artifact.sampleCountPerStage !== 1 ||
      artifact.signaturesVerified !== 2 ||
      artifact.timingPurpose !== 'hosted_pilot_not_release_gate' ||
      new URL(artifact.gatewayOrigin).protocol !== 'https:' ||
      new URL(artifact.gatewayOrigin).hostname.split('.')[0] !==
        `r150-bench-20260925-${start.arm}-ingress`) {
    throw new Error(`Invalid successful artifact for ${start.runId}`);
  }
  for (const phase of ['registrationReturn', 'firstSigning', 'subsequentSigning']) {
    const stage = artifact[phase];
    if (!stage || !Number.isFinite(stage.elapsedMs) || stage.elapsedMs < 0 ||
        !validCounts(stage.gatewayRequestCounts) ||
        !validCounts(stage.presignRefillRequestCounts) ||
        !Array.isArray(stage.gatewayServerTimings)) {
      throw new Error(`Invalid ${phase} measurement for ${start.runId}`);
    }
    for (const timing of stage.gatewayServerTimings) {
      if (typeof timing.path !== 'string' || !Number.isInteger(timing.status) ||
          !validCounts(timing.stagesMs, false)) {
        throw new Error(`Invalid Server-Timing measurement for ${start.runId}`);
      }
    }
  }
}

function validCounts(counts, integers = true) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return false;
  for (const value of Object.values(counts)) {
    if (!Number.isFinite(value) || value < 0 || (integers && !Number.isInteger(value))) {
      return false;
    }
  }
  return true;
}

function summarizeArm(samples) {
  const report = { sampleCount: samples.length, phases: {} };
  for (const phase of ['registrationReturn', 'firstSigning', 'subsequentSigning']) {
    const durations = [];
    const gatewayRequestTotals = {};
    const presignRefillRequestTotals = {};
    const timingValues = {};
    let samplesWithServerTiming = 0;
    for (const sample of samples) {
      const stage = sample.artifact[phase];
      durations.push(stage.elapsedMs);
      addCounts(gatewayRequestTotals, stage.gatewayRequestCounts);
      addCounts(presignRefillRequestTotals, stage.presignRefillRequestCounts);
      if (stage.gatewayServerTimings.length > 0) samplesWithServerTiming += 1;
      for (const response of stage.gatewayServerTimings) {
        for (const [name, elapsedMs] of Object.entries(response.stagesMs)) {
          if (!timingValues[name]) timingValues[name] = [];
          timingValues[name].push(elapsedMs);
        }
      }
    }
    const serverTiming = {};
    for (const [name, values] of Object.entries(timingValues)) {
      serverTiming[name] = summarizeDurations(values);
    }
    report.phases[phase] = {
      elapsedMs: summarizeDurations(durations),
      gatewayRequestTotals,
      presignRefillRequestTotals,
      samplesWithServerTiming,
      serverTiming,
    };
  }
  return report;
}

function addCounts(total, counts) {
  for (const [name, count] of Object.entries(counts)) {
    total[name] = (total[name] ?? 0) + count;
  }
}

function summarizeDurations(values) {
  if (values.length === 0) return { n: 0, p50: null, p95: null };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    n: values.length,
    p50: sorted[Math.ceil(0.5 * sorted.length) - 1],
    p95: sorted[Math.ceil(0.95 * sorted.length) - 1],
  };
}

function pairedDeltas(samples) {
  const doByCase = new Map();
  for (const sample of samples.do) doByCase.set(sample.caseIndex, sample.artifact);
  const deltas = { registrationReturn: [], firstSigning: [], subsequentSigning: [] };
  let pairedCount = 0;
  for (const d1Sample of samples.d1) {
    const doArtifact = doByCase.get(d1Sample.caseIndex);
    if (!doArtifact) continue;
    pairedCount += 1;
    for (const phase of Object.keys(deltas)) {
      deltas[phase].push(doArtifact[phase].elapsedMs - d1Sample.artifact[phase].elapsedMs);
    }
  }
  return {
    n: pairedCount,
    doMinusD1Ms: {
      registrationReturn: summarizeDurations(deltas.registrationReturn),
      firstSigning: summarizeDurations(deltas.firstSigning),
      subsequentSigning: summarizeDurations(deltas.subsequentSigning),
    },
  };
}

function compareP95(arms) {
  const comparison = {};
  for (const phase of ['registrationReturn', 'firstSigning', 'subsequentSigning']) {
    const d1 = arms.d1.phases[phase].elapsedMs.p95;
    const walletDo = arms.do.phases[phase].elapsedMs.p95;
    comparison[phase] = d1 && walletDo !== null ? 100 * (walletDo / d1 - 1) : null;
  }
  return comparison;
}

function expectedArm(sequence) {
  const caseIndex = Math.ceil(sequence / 2);
  const firstArm = caseIndex % 2 === 1 ? 'd1' : 'do';
  if (sequence % 2 === 1) return firstArm;
  return firstArm === 'd1' ? 'do' : 'd1';
}
