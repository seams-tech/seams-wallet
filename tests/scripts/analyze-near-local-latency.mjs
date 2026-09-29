#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [reportPath, outputPath] = process.argv.slice(2);
if (!reportPath || !outputPath) {
  throw new Error('Usage: analyze-near-local-latency.mjs <playwright.json> <summary.json>');
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const results = collectResults(report.suites);
const samples = results.map(readSample);
const completed = samples.filter(isCompleted);
const cohorts = {};
for (const kind of ['near_only', 'mixed']) {
  const selected = completed.filter(matchesKind.bind(undefined, kind));
  const identities = new Set(selected.map(sampleNumber));
  if (identities.size !== selected.length) throw new Error(`Duplicate sample in ${kind}`);
  const metrics = new Map();
  for (const sample of selected) collectMetrics(metrics, sample.measurements);
  cohorts[kind] = {
    completed: selected.length,
    metrics: Object.fromEntries([...metrics].map(summarizeMetric)),
  };
}
const summary = {
  kind: 'near_local_latency_baseline_v1',
  report: path.basename(reportPath),
  expectedSamples: 40,
  attempted: samples.length,
  completed: completed.length,
  failed: samples.length - completed.length,
  cohorts,
  samples,
};
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      attempted: summary.attempted,
      completed: summary.completed,
      failed: summary.failed,
      cohorts,
    },
    null,
    2,
  ),
);
if (summary.failed || cohorts.near_only.completed !== 20 || cohorts.mixed.completed !== 20) {
  process.exitCode = 1;
}

function collectResults(suites) {
  const results = [];
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      if (!spec.title.startsWith('local NEAR ')) continue;
      for (const test of spec.tests) {
        for (const result of test.results) {
          results.push({
            title: spec.title,
            status: result.status,
            attachments: result.attachments,
          });
        }
      }
    }
    results.push(...collectResults(suite.suites));
  }
  return results;
}

function isLatencyAttachment(attachment) {
  return attachment.name === 'near-local-latency';
}

function readSample(result) {
  const attachment = result.attachments.find(isLatencyAttachment);
  if (!attachment) {
    return { title: result.title, status: result.status, measurements: null };
  }
  const text = attachment.body
    ? Buffer.from(attachment.body, 'base64').toString('utf8')
    : readFileSync(attachment.path, 'utf8');
  const measurements = JSON.parse(text);
  if (
    !['near_only', 'mixed'].includes(measurements.kind) ||
    !Number.isSafeInteger(measurements.sample) ||
    !Array.isArray(measurements.registration) ||
    !Array.isArray(measurements.signing)
  )
    throw new Error(`Invalid timing attachment: ${result.title}`);
  const lifecycle = result.attachments.find(isLifecycleAttachment);
  if (lifecycle && result.status === 'passed') {
    const trace = JSON.parse(readAttachmentText(lifecycle)).trace;
    const counts = signingStatusRequestCounts(trace);
    if (counts.length !== measurements.signing.length)
      throw new Error('Signing request count boundaries do not match samples');
    for (let index = 0; index < counts.length; index += 1) {
      measurements.signing[index].walletSessionStatusRequests = counts[index];
    }
  }
  return { title: result.title, status: result.status, measurements };
}

function isLifecycleAttachment(attachment) {
  return attachment.name === 'intended-lifecycle-trace.json';
}

function readAttachmentText(attachment) {
  return attachment.body
    ? Buffer.from(attachment.body, 'base64').toString('utf8')
    : readFileSync(attachment.path, 'utf8');
}

function signingStatusRequestCounts(trace) {
  const counts = [];
  let active = null;
  for (const event of trace) {
    if (event.kind === 'console' && event.message.includes('"event":"near_sdk_signing_started"'))
      active = 0;
    if (active === null) continue;
    if (event.kind === 'request' && event.message === 'POST /wallet/session/status') active += 1;
    if (event.kind === 'console' && event.message.includes('"event":"near_sdk_signing_timing"')) {
      counts.push(active);
      active = null;
    }
  }
  return counts;
}

function isCompleted(sample) {
  return sample.status === 'passed' && sample.measurements?.outcome === 'succeeded';
}

function matchesKind(kind, sample) {
  return sample.measurements.kind === kind;
}

function sampleNumber(sample) {
  return sample.measurements.sample;
}

function addMetric(metrics, name, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(`Invalid duration for ${name}`);
  }
  const values = metrics.get(name) ?? [];
  values.push(durationMs);
  metrics.set(name, values);
}

function collectMetrics(metrics, sample) {
  if (
    sample.signing.length !== 2 ||
    sample.signing[0].phase !== 'first' ||
    sample.signing[1].phase !== 'warm'
  )
    throw new Error('A baseline sample requires first and warm signing');
  addMetric(metrics, 'registration/harness_return', sample.registrationHarnessMs);
  addMetric(metrics, 'registration/harness_near_ready', sample.readinessHarnessMs);
  for (const timing of sample.registration) {
    addMetric(metrics, `registration/${timing.stage}`, timing.durationMs);
  }
  for (const signing of sample.signing) {
    const prefix = `signing/${signing.phase}`;
    addMetric(metrics, `${prefix}/sdk_total`, signing.sdkElapsedMs);
    addMetric(metrics, `${prefix}/harness_total`, signing.harnessElapsedMs);
    for (const timing of signing.timings) {
      addMetric(metrics, `${prefix}/${timing.stage}`, timing.durationMs);
    }
    const durations = new Map(signing.timings.map(timingEntry));
    const promptWait = durations.get('prompt.decisionWaitMs');
    if (promptWait !== undefined) {
      addMetric(
        metrics,
        `${prefix}/outside_prompt_decision_wait`,
        signing.sdkElapsedMs - promptWait,
      );
      const attributed = [
        'preparation_modal',
        'authorization_probe',
        'execution_setup',
        'lane_preparation',
        'pre_confirmation',
        'confirmation',
        'confirmed_to_signed',
      ];
      if (attributed.every(hasTiming.bind(undefined, durations))) {
        const total = attributed.reduce(sumTiming.bind(undefined, durations), 0);
        addMetric(metrics, `${prefix}/unattributed_sdk`, signing.sdkElapsedMs - total);
      }
    }
    const totals = signing.timings.filter(isSignatureTotal);
    if (totals.length !== 1 || !signing.signatureVerified) {
      throw new Error('Each signing sample needs one verified signature');
    }
    addMetric(
      metrics,
      `${prefix}/outside_signature_total`,
      signing.sdkElapsedMs - totals[0].durationMs,
    );
  }
}

function timingEntry(timing) {
  return [timing.stage, timing.durationMs];
}

function hasTiming(durations, stage) {
  return durations.has(stage);
}

function sumTiming(durations, total, stage) {
  return total + durations.get(stage);
}

function isSignatureTotal(timing) {
  return timing.stage === 'signature_total';
}

function compareNumbers(left, right) {
  return left - right;
}

function exceedsSigningBudget(value) {
  return value > 2000;
}

function summarizeMetric([name, values]) {
  const sorted = [...values].sort(compareNumbers);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return [
    name,
    {
      count: sorted.length,
      p50Ms: median,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxMs: sorted[sorted.length - 1],
      above2000Ms: sorted.filter(exceedsSigningBudget).length,
    },
  ];
}
