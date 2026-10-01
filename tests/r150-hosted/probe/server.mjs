#!/usr/bin/env node
// The R150 probe container's server. The probe Worker's container object
// forwards to it:
//   GET  /identity       the container's runtime identity and the source
//                        fingerprint the image was built from
//   POST /attempts       starts one benchmark attempt (body: the attempt)
//   GET  /attempts/<id>  that attempt's status, and its result once finished
//
// It runs one attempt at a time: the same Playwright scenario, with the same
// environment, as a probe host has always run. The arm's access token arrives
// in the request body and reaches only the browser run's environment.
// Each attempt retains its timing and private lifecycle/failure evidence.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 8080;
const MAX_BODY_BYTES = 64 * 1024;
// Enough for a failing attempt's whole recorded console, which names the cause.
const OUTPUT_TAIL_BYTES = 2 * 1024 * 1024;
/** Identifies this boot of the container: a restart is a different probe. */
const bootId = randomUUID();
const source = JSON.parse(
  readFileSync(path.join(repoRoot, '.runtime', 'r150-hosted', 'probe-source.json'), 'utf8'),
);
const attempts = new Map();
let running = null;

function identity() {
  return {
    kind: 'r150_hosted_probe_identity_v1',
    provider: 'cloudflare',
    applicationId: process.env.CLOUDFLARE_APPLICATION_ID ?? null,
    instanceId: process.env.CLOUDFLARE_DURABLE_OBJECT_ID ?? null,
    location: process.env.CLOUDFLARE_LOCATION ?? null,
    cloudflareRegion: process.env.CLOUDFLARE_REGION ?? null,
    countryA2: process.env.CLOUDFLARE_COUNTRY_A2 ?? null,
    bootId,
    source: { revision: source.revision, walletBuildInputHash: source.walletBuildInputHash },
  };
}

const IDENTITY_FIELDS = [
  'applicationId',
  'instanceId',
  'location',
  'cloudflareRegion',
  'countryA2',
  'bootId',
];

function parseAttempt(body) {
  const request = JSON.parse(body);
  const { runId, arm, region, selected, expectedIdentity, workload } = request;
  if (!['unforced', 'first_warm_burst', 'linked_chain', 'placement_pair', 'activation_resume'].includes(workload))
    throw new Error('attempt workload is invalid');
  if (!/^[a-z0-9-]+$/u.test(runId ?? '') || !['d1', 'do'].includes(arm)) {
    throw new Error('attempt run id or arm is invalid');
  }
  if (!['apac', 'weur', 'enam'].includes(region)) throw new Error('attempt region is invalid');
  for (const name of [
    'ingressUrl',
    'environmentId',
    'publishableKey',
    'signingWorkerId',
    'accessToken',
  ]) {
    if (typeof selected?.[name] !== 'string' || selected[name].length === 0) {
      throw new Error(`attempt is missing ${name}`);
    }
  }
  const current = identity();
  for (const name of IDENTITY_FIELDS) {
    if (expectedIdentity?.[name] !== current[name]) {
      throw new Error(`this container's ${name} differs from the probe the attempt names`);
    }
  }
  return { runId, arm, region, selected, workload };
}

function workloadConfiguration(workload) {
  switch (workload) {
    case 'unforced':
      return {
        artifactPrefix: 'gateway-ecdsa-unforced-timing',
        directory: 'r150',
        file: 'passkey.presign-pool.contract.test.ts',
        selection: 'unforced ECDSA registration and repeated signing',
      };
    case 'first_warm_burst':
      return {
        artifactPrefix: 'gateway-ecdsa-first-warm-burst',
        directory: 'r151',
        file: 'passkey.presign-pool.contract.test.ts',
        selection: 'first, warm, and concurrent burst',
      };
    case 'linked_chain':
      return {
        artifactPrefix: 'gateway-ecdsa-linked-chain',
        directory: 'r151',
        file: 'passkey.device-linking.contract.test.ts',
        selection: 'a linked device links a third device on an ECDSA-only wallet',
      };
    case 'activation_resume':
      return {
        artifactPrefix: 'registration-activation-resume-ecdsa_only',
        directory: 'r150',
        file: 'passkey.registration.activation-resume.contract.test.ts',
        selection: 'Passkey ecdsa_only activation response loss resumes the same wallet',
      };
    case 'placement_pair':
      return {
        artifactPrefix: 'gateway-ecdsa-placement-pair',
        directory: 'r151',
        file: 'passkey.presign-pool.contract.test.ts',
        selection: 'same wallet warm signing across controlled Gateway placements',
      };
    default:
      throw new Error('attempt workload is invalid');
  }
}

function startAttempt(attempt) {
  const workload = workloadConfiguration(attempt.workload);
  const artifactName = `${workload.artifactPrefix}-hosted_${attempt.arm}-${attempt.region}-${attempt.runId}-0.json`;
  const artifactPath = path.join(repoRoot, '.artifacts', workload.directory, artifactName);
  const diagnosticsDirectory = path.join(repoRoot, '.runtime', 'probe-attempts', attempt.runId);
  if (existsSync(artifactPath)) throw new Error(`artifact ${artifactName} already exists`);
  const state = { status: 'running', startedAt: new Date().toISOString(), result: null };
  attempts.set(attempt.runId, state);
  const env = {
    ...process.env,
    // Activation traces can exceed Node's default response-header limit.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-http-header-size=131072`.trim(),
    // The only origins each arm's ingress and Gateway accept.
    SEAMS_INTENDED_APP_URL: 'http://localhost:4201',
    SEAMS_INTENDED_WALLET_ORIGIN: 'http://localhost:4202',
    SEAMS_INTENDED_EXTERNAL_GATEWAY: '1',
    SEAMS_INTENDED_ROUTER_URL: attempt.selected.ingressUrl,
    SEAMS_INTENDED_BENCHMARK_ARM: attempt.arm,
    SEAMS_INTENDED_PROBE_REGION: attempt.region,
    SEAMS_INTENDED_BENCHMARK_RUN_ID: attempt.runId,
    SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID: attempt.selected.environmentId,
    SEAMS_INTENDED_PUBLISHABLE_KEY: attempt.selected.publishableKey,
    SEAMS_INTENDED_SIGNING_WORKER_ID: attempt.selected.signingWorkerId,
    SEAMS_INTENDED_BENCHMARK_ACCESS_TOKEN: attempt.selected.accessToken,
    SEAMS_INTENDED_PERSIST_TRACE: '1',
    SEAMS_INTENDED_TRACE_DIR: path.join(diagnosticsDirectory, 'lifecycle'),
    SEAMS_INTENDED_PLACEMENT_DIRECTORY: path.join(diagnosticsDirectory, 'placement'),
  };
  let output = '';
  const child = spawn(
    'pnpm',
    [
      '-C',
      'tests',
      'exec',
      'playwright',
      'test',
      '-c',
      'playwright.wallet-intended.ci.config.ts',
      `e2e/intended-behaviours/${workload.file}`,
      '--grep',
      workload.selection,
      '--output',
      path.join(diagnosticsDirectory, 'playwright'),
    ],
    { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const keep = (chunk) => {
    output = `${output}${chunk}`.slice(-OUTPUT_TAIL_BYTES);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  running = child;
  child.on('close', (exitCode, signal) => {
    running = null;
    let artifact = null;
    if (existsSync(artifactPath)) {
      try {
        artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      } catch {
        artifact = null;
      }
    }
    state.status = 'finished';
    state.result = {
      exitCode,
      signal,
      artifactName,
      artifact,
      diagnostics: readAttemptDiagnostics(diagnosticsDirectory, attempt.selected.accessToken),
      identity: identity(),
      // The access token is never printed by the run; strip it regardless.
      outputTail: output.split(attempt.selected.accessToken).join('<redacted>'),
      finishedAt: new Date().toISOString(),
    };
  });
}

function readAttemptDiagnostics(directory, accessToken) {
  const files = [];
  let remainingBytes = 8 * 1024 * 1024;
  if (!existsSync(directory)) return files;
  for (const name of readdirSync(directory, { recursive: true }).sort()) {
    if (
      !(name.startsWith(`lifecycle${path.sep}`) && name.endsWith('.json')) &&
      !name.endsWith('error-context.md')
    )
      continue;
    const filePath = path.join(directory, name);
    const bytes = statSync(filePath).size;
    if (bytes > remainingBytes) {
      files.push({ name, bytes, content: null, omission: 'diagnostic_size_limit' });
      continue;
    }
    remainingBytes -= bytes;
    files.push({
      name,
      bytes,
      content: readFileSync(filePath, 'utf8').split(accessToken).join('<redacted>'),
      omission: null,
    });
  }
  return files;
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function placementRequest(runId) {
  const directory = path.join(repoRoot, '.runtime', 'probe-attempts', runId, 'placement');
  const requestedFile = path.join(directory, 'requested.json');
  if (!existsSync(requestedFile)) return null;
  const { placement } = JSON.parse(readFileSync(requestedFile, 'utf8'));
  if (!['default', 'tokyo'].includes(placement)) throw new Error('Invalid placement checkpoint');
  return { placement, released: existsSync(path.join(directory, `${placement}.ready`)) };
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://probe');
  if (request.method === 'GET' && url.pathname === '/identity') {
    send(response, 200, identity());
    return;
  }
  const attemptMatch = /^\/attempts\/([a-z0-9-]+)$/u.exec(url.pathname);
  if (request.method === 'GET' && attemptMatch) {
    const state = attempts.get(attemptMatch[1]);
    send(
      response,
      state ? 200 : 404,
      state
        ? { ...state, placement: placementRequest(attemptMatch[1]) }
        : { error: 'unknown attempt' },
    );
    return;
  }
  const placementMatch = /^\/attempts\/([a-z0-9-]+)\/placement\/(default|tokyo)$/u.exec(
    url.pathname,
  );
  if (request.method === 'POST' && placementMatch) {
    const [, runId, placement] = placementMatch;
    const state = attempts.get(runId);
    const checkpoint = state ? placementRequest(runId) : null;
    if (state?.status !== 'running' || checkpoint?.placement !== placement || checkpoint.released) {
      send(response, 409, { error: 'Placement checkpoint is absent or already released' });
      return;
    }
    writeFileSync(
      path.join(repoRoot, '.runtime', 'probe-attempts', runId, 'placement', `${placement}.ready`),
      '',
      { flag: 'wx' },
    );
    send(response, 200, { released: placement });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/attempts') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) request.destroy();
    });
    request.on('end', () => {
      try {
        if (running) throw new Error('another attempt is running');
        const attempt = parseAttempt(body);
        if (attempts.has(attempt.runId)) throw new Error('this attempt already ran here');
        startAttempt(attempt);
        send(response, 202, { status: 'running', runId: attempt.runId });
      } catch (error) {
        send(response, 409, { error: error instanceof Error ? error.message : String(error) });
      }
    });
    return;
  }
  send(response, 404, { error: 'not found' });
}).listen(PORT, '0.0.0.0');
