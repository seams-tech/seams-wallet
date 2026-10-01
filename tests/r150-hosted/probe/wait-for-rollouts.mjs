#!/usr/bin/env node
// Waits for the requested image and completed application versions before a
// probe starts wallet work. Wrangler owns credential discovery and refresh.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [accountId, imageDigest, evidencePath, ...applicationIds] = process.argv.slice(2);
if (
  !/^[a-f0-9]{32}$/u.test(accountId ?? '') ||
  !/^[a-f0-9]{64}$/u.test(imageDigest ?? '') ||
  !evidencePath ||
  applicationIds.length === 0 ||
  new Set(applicationIds).size !== applicationIds.length ||
  !applicationIds.every(isApplicationId)
) {
  throw new Error(
    'Usage: wait-for-rollouts.mjs <account-id> <image-sha256> <evidence.json> <application-id> ...',
  );
}
process.umask(0o077);
mkdirSync(path.dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, '[]\n', { flag: 'wx', mode: 0o600 });
const observations = [];
const deadline = Date.now() + 10 * 60_000;
let previousReady = null;
let consecutiveErrors = 0;
while (Date.now() < deadline) {
  try {
    const token = wranglerToken();
    const applications = [];
    for (const id of applicationIds) applications.push(await applicationState(id, token));
    const ready = applications.every(isReady);
    record({ at: new Date().toISOString(), applications, ready });
    consecutiveErrors = 0;
    const fingerprint = ready ? JSON.stringify(applications) : null;
    if (fingerprint !== null && fingerprint === previousReady) {
      console.log('Requested probe images and completed rollout versions are stable');
      process.exit(0);
    }
    previousReady = fingerprint;
    console.log(applications.map(describe).join(', '));
  } catch (error) {
    previousReady = null;
    consecutiveErrors += 1;
    record({ at: new Date().toISOString(), error: String(error) });
    if (consecutiveErrors >= 3) throw error;
  }
  await delay(previousReady === null ? 30_000 : 5_000);
}
throw new Error('Probe rollouts did not become ready within ten minutes');

function isApplicationId(value) {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
}

function wranglerToken() {
  const result = spawnSync('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error('Wrangler authentication failed');
  const credentials = JSON.parse(result.stdout);
  if (
    !['oauth', 'api_token'].includes(credentials.type) ||
    typeof credentials.token !== 'string' ||
    credentials.token.length === 0
  ) {
    throw new Error('Wrangler must provide an OAuth or API token');
  }
  return credentials.token;
}

async function api(url, token) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Cloudflare rollout read returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.success !== true) throw new Error('Cloudflare rollout read failed');
  return body.result;
}

async function applicationState(id, token) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/containers/applications/${id}`;
  const current = await api(url, token);
  const rollouts = await api(`${url}/rollouts`, token);
  // Completed applications can clear active_rollout_id; retain the latest record.
  if (!Array.isArray(rollouts) || rollouts.length === 0) throw new Error('Missing rollout history');
  rollouts.sort(byCreationDescending);
  const latest = rollouts[0];
  if (
    typeof current.name !== 'string' ||
    !current.name.startsWith('r150-bench-20260925-probe-') ||
    !Number.isSafeInteger(current.version) ||
    typeof current.configuration?.image !== 'string' ||
    !Number.isSafeInteger(latest.target_version) ||
    typeof latest.target_configuration?.image !== 'string' ||
    typeof latest.id !== 'string' ||
    typeof latest.status !== 'string'
  ) {
    throw new Error('Invalid isolated probe application or rollout record');
  }
  return {
    id,
    name: current.name,
    version: current.version,
    image: current.configuration.image,
    rolloutId: latest.id,
    status: latest.status,
    targetVersion: latest.target_version,
    targetImage: latest.target_configuration.image,
  };
}

function byCreationDescending(a, b) {
  return b.created_at.localeCompare(a.created_at);
}

function isReady(application) {
  return (
    application.status === 'completed' &&
    application.version === application.targetVersion &&
    application.image === application.targetImage &&
    application.image.endsWith(`@sha256:${imageDigest}`)
  );
}

function describe(application) {
  return `${application.name}: ${application.status}, version ${application.version}/${application.targetVersion}`;
}

function record(observation) {
  observations.push(observation);
  writeFileSync(evidencePath, `${JSON.stringify(observations, null, 2)}\n`);
}
