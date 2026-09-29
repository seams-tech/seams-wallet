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
// in the request body and reaches only the browser run's environment; the
// server writes nothing but the run's own timing artifact.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 8080;
const MAX_BODY_BYTES = 64 * 1024;
const OUTPUT_TAIL_BYTES = 16 * 1024;
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
  const { runId, arm, region, selected, expectedIdentity } = request;
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
  return { runId, arm, region, selected };
}

function startAttempt(attempt) {
  const artifactName = `gateway-ecdsa-unforced-timing-hosted_${attempt.arm}-${attempt.region}-${attempt.runId}-0.json`;
  const artifactPath = path.join(repoRoot, '.artifacts', 'r150', artifactName);
  if (existsSync(artifactPath)) throw new Error(`artifact ${artifactName} already exists`);
  const state = { status: 'running', startedAt: new Date().toISOString(), result: null };
  attempts.set(attempt.runId, state);
  const env = {
    ...process.env,
    SEAMS_INTENDED_EXTERNAL_GATEWAY: '1',
    SEAMS_INTENDED_ROUTER_URL: attempt.selected.ingressUrl,
    SEAMS_INTENDED_BENCHMARK_ARM: attempt.arm,
    SEAMS_INTENDED_PROBE_REGION: attempt.region,
    SEAMS_INTENDED_BENCHMARK_RUN_ID: attempt.runId,
    SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID: attempt.selected.environmentId,
    SEAMS_INTENDED_PUBLISHABLE_KEY: attempt.selected.publishableKey,
    SEAMS_INTENDED_SIGNING_WORKER_ID: attempt.selected.signingWorkerId,
    SEAMS_INTENDED_BENCHMARK_ACCESS_TOKEN: attempt.selected.accessToken,
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
      'e2e/intended-behaviours/passkey.presign-pool.contract.test.ts',
      '--grep',
      'unforced ECDSA registration and repeated signing',
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
      identity: identity(),
      // The access token is never printed by the run; strip it regardless.
      outputTail: output.split(attempt.selected.accessToken).join('<redacted>'),
      finishedAt: new Date().toISOString(),
    };
  });
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
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
    send(response, state ? 200 : 404, state ?? { error: 'unknown attempt' });
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
