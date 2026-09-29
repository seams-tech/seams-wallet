#!/usr/bin/env node
// Records one probe region's container and writes the region's private runner
// input: node tests/r150-hosted/probe/prepare-probe-input.mjs <apac|weur|enam>
//
// It asks the probe Worker for the region's container identity, which starts
// the container: its application, Durable Object, location, region, country
// and boot. The container's placement is Cloudflare's choice inside the
// region constraint, so the recorded location is the cohort's evidence. Every
// attempt must then run on this same container and image.
//
// Reads, under .runtime/r150-hosted/: probe/worker.json, and each arm's
// rendered/probe-values/<arm>.json and rendered/ingress-secrets/<arm>.json.
// Writes probe/<region>/evidence.json and probe/<region>/input.json, mode
// 0600, and replaces neither: a new cohort needs a new directory.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeRoot = path.join(repoRoot, '.runtime', 'r150-hosted');
const PROBE_REGIONS = { apac: 'APAC', weur: 'WEUR', enam: 'ENAM' };
const IDENTITY_FIELDS = [
  'applicationId',
  'instanceId',
  'location',
  'cloudflareRegion',
  'countryA2',
  'bootId',
];
const [region] = process.argv.slice(2);
if (process.argv.length !== 3 || !PROBE_REGIONS[region]) {
  throw new Error('Usage: node tests/r150-hosted/probe/prepare-probe-input.mjs <apac|weur|enam>');
}
process.umask(0o077);

const worker = readPrivateJson(path.join(runtimeRoot, 'probe', 'worker.json'));
if (worker.kind !== 'r150_hosted_probe_worker_v1' || typeof worker.workerUrl !== 'string') {
  throw new Error('Deploy the probe Worker and record its URL first');
}
const response = await fetch(new URL(`${region}/identity`, worker.workerUrl), {
  headers: { authorization: `Bearer ${worker.accessToken}` },
});
if (!response.ok) {
  throw new Error(`The probe answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
}
const identity = await response.json();
if (identity.kind !== 'r150_hosted_probe_identity_v1' || identity.provider !== 'cloudflare') {
  throw new Error('The probe did not report a Cloudflare container identity');
}
for (const name of IDENTITY_FIELDS) {
  if (typeof identity[name] !== 'string' || identity[name].length === 0) {
    throw new Error(`The probe container reports no ${name}`);
  }
}
if (
  identity.source?.revision !== worker.source.revision ||
  identity.source?.walletBuildInputHash !== worker.source.walletBuildInputHash
) {
  throw new Error('The probe container runs another image than the one prepared');
}

const observedAt = new Date().toISOString();
const regionRoot = path.join(runtimeRoot, 'probe', region);
mkdirSync(regionRoot, { recursive: true, mode: 0o700 });
writePrivate(path.join(regionRoot, 'evidence.json'), {
  kind: 'r150_hosted_probe_evidence_v1',
  region,
  regionConstraint: PROBE_REGIONS[region],
  workerUrl: worker.workerUrl,
  observedAt,
  identity,
});
const arms = {};
for (const arm of ['d1', 'do']) {
  const values = readPrivateJson(path.join(runtimeRoot, 'rendered', 'probe-values', `${arm}.json`));
  const secrets = readPrivateJson(
    path.join(runtimeRoot, 'rendered', 'ingress-secrets', `${arm}.json`),
  );
  arms[arm] = {
    ingressUrl: new URL(values.ingressUrl).href,
    environmentId: values.environmentId,
    publishableKey: values.publishableKey,
    signingWorkerId: values.signingWorkerId,
    deploymentFingerprint: values.deploymentFingerprint,
    accessToken: secrets.BENCHMARK_ACCESS_TOKEN,
  };
}
writePrivate(path.join(regionRoot, 'input.json'), {
  kind: 'r150_hosted_probe_input_v1',
  region,
  source: worker.source,
  probeAccessToken: worker.accessToken,
  probe: {
    provider: 'cloudflare',
    region,
    regionConstraint: PROBE_REGIONS[region],
    workerUrl: worker.workerUrl,
    ...Object.fromEntries(IDENTITY_FIELDS.map((name) => [name, identity[name]])),
    observedAt,
    evidenceRef: 'evidence.json',
  },
  arms,
});
console.log(
  `Recorded ${region}: ${identity.location} (${identity.countryA2}, ${identity.cloudflareRegion}), object ${identity.instanceId.slice(0, 12)}`,
);

function readPrivateJson(filePath) {
  if ((statSync(filePath).mode & 0o077) !== 0) throw new Error(`${filePath} must be private`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writePrivate(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
