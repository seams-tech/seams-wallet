import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Miniflare } from 'miniflare';
import { signTenantRootCreationGrantV1 } from '@seams/wallet-server/cloud-host';
import {
  configureRouterJwt,
  loadFixture,
  routerWorker,
  tenantRootControlPlaneWorker,
} from './test-private-d1.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = join(repository, '.artifacts/grant-renewal', String(Date.now()));
const binding = 'ROUTER_TENANT_ROOT_CREATION_DO';
const auth = {
  'content-type': 'application/json',
  'x-router-ab-internal-service-auth': 'private-d1-integration-auth',
};
const renewalPath = '/router-ab/internal/tenant-root/creation/v1/renewal-fence';
const createPath = '/tenant-root-control-plane/creation/v1/create';
const progressPath = '/router-ab/internal/tenant-root/creation/v1/progress/read';

function creationGrant() {
  return JSON.parse(
    execFileSync(
      'cargo',
      [
        'run',
        '--quiet',
        '--manifest-path',
        join(repository, 'crates/router-ab-dev/Cargo.toml'),
        '--example',
        'cloudflare_private_d1_fixture',
        '--',
        '--creation-grant',
        'unused-grant-renewal',
        '10000',
      ],
      { encoding: 'utf8' },
    ),
  );
}

function post(worker, path, body) {
  return worker.fetch(`https://acceptance.internal${path}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(body),
  });
}

async function heldTransaction(object) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await (await post(object, '/acceptance/status', {})).json();
    if (state.kind === 'held') return state;
    await sleep(20);
  }
  throw new Error('Creation transaction did not reach the hold');
}

function capturedResponse(response) {
  return { kind: 'response', response };
}

function capturedFailure(error) {
  return { kind: 'failure', error };
}

function grantFields(encoded) {
  const bytes = Buffer.from(encoded, 'base64url');
  const fields = [];
  let offset = 0;
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset);
    offset += 4;
    fields.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  assert.equal(fields.length, 9);
  return fields;
}

async function run() {
  const fixture = loadFixture();
  fixture.router_env.TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON =
    fixture.tenant_root_control_plane_env.TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON;
  configureRouterJwt(fixture);
  const router = routerWorker(fixture);
  const runtimeImport = relative(output, resolve(dirname(router.scriptPath), '../index.js'));
  const fixtureSource = await readFile(
    join(repository, 'tests/fixtures/grant-renewal-worker.mjs'),
    'utf8',
  );
  const workerSource = fixtureSource.replaceAll(
    '../../crates/router-ab-cloudflare/build/dev/router/index.js',
    runtimeImport,
  );
  assert.notEqual(
    workerSource,
    fixtureSource,
    'The storage-gate fixture must use the selected Worker build',
  );
  await mkdir(output, { recursive: true });
  router.scriptPath = join(output, 'storage-gate-worker.mjs');
  await writeFile(router.scriptPath, workerSource);
  router.serviceBindings = {
    DERIVER_A: 'unused',
    DERIVER_B: 'unused',
    SIGNING_WORKER: 'unused',
    TENANT_ROOT_CONTROL_PLANE: 'tenant-root-control-plane',
  };
  const topology = new Miniflare({
    workers: [
      router,
      tenantRootControlPlaneWorker(fixture),
      {
        name: 'unused',
        modules: true,
        script: 'export default { fetch() { throw new Error("Unexpected custody role call"); } };',
      },
    ],
  });
  try {
    await topology.ready;
    const grant = creationGrant();
    const namespace = await topology.getDurableObjectNamespace(binding, 'router');
    const object = namespace.get(namespace.idFromName(grant.creation_object_name));
    const controlPlane = await topology.getWorker('tenant-root-control-plane');
    const gateway = await topology.getWorker('router');
    const original = { creation_grant_b64u: grant.creation_grant_b64u };
    const unauthorized = await gateway.fetch(`https://acceptance.internal${renewalPath}`, {
      method: 'POST',
      body: JSON.stringify(original),
    });
    assert.equal(unauthorized.status, 403);
    const premature = await post(gateway, renewalPath, original);
    assert.ok(!premature.ok, 'A live authorization must remain valid until its expiry');
    const forgedBytes = Buffer.from(grant.creation_grant_b64u, 'base64url');
    forgedBytes[forgedBytes.length - 1] ^= 1;
    const forged = await post(gateway, renewalPath, {
      creation_grant_b64u: forgedBytes.toString('base64url'),
    });
    assert.ok(!forged.ok, 'A forged authorization must not install a fence');
    const armed = await post(object, '/acceptance/arm', {});
    assert.equal(armed.status, 200, await armed.clone().text());
    console.log('Creation transaction gate armed');
    const delayed = post(controlPlane, createPath, original).then(
      capturedResponse,
      capturedFailure,
    );
    const held = await heldTransaction(object);
    assert.ok(
      held.heldAtMs < grant.expires_at_ms,
      'Rust must capture a still-valid admission time before the hold',
    );
    await sleep(Math.max(0, grant.expires_at_ms + 100 - Date.now()));
    const fenceResponse = await post(gateway, renewalPath, original);
    assert.equal(fenceResponse.status, 200, await fenceResponse.clone().text());
    const fence = await fenceResponse.json();
    assert.equal(fence.kind, 'renewal_permitted');
    assert.equal(
      fence.grant_digest_b64u,
      createHash('sha256')
        .update(Buffer.from(grant.creation_grant_b64u, 'base64url'))
        .digest('base64url'),
    );
    assert.ok(fence.expired_through_ms >= grant.expires_at_ms);
    await post(object, '/acceptance/release', {});
    const late = await delayed;
    if (late.kind === 'failure') throw late.error;
    const lateResponse = late.response;
    assert.ok(!lateResponse.ok, 'The old request must fail despite its pre-expiry admission time');
    const lateBody = await lateResponse.text();
    assert.match(lateBody, /408/);
    const scope = {
      identity_digest_b64u: grant.identity_digest_b64u,
      custody_lineage_b64u: grant.custody_lineage_b64u,
    };
    assert.equal((await (await post(object, progressPath, scope)).json()).kind, 'not_started');
    const fields = grantFields(grant.creation_grant_b64u);
    const issuedAtMs = Date.now() - 1;
    const renewed = await signTenantRootCreationGrantV1({
      identity: grant.identity,
      custodyLineage: fields[3],
      grantNonce: fields[4],
      grantKeyId: fields[7].toString(),
      issuedAtMs,
      expiresAtMs: issuedAtMs + 60_000,
      signingSeedB64u: Buffer.alloc(32, 0xc2).toString('base64url'),
    });
    const fresh = { creation_grant_b64u: renewed.grantB64u };
    const readyResponse = await post(controlPlane, createPath, fresh);
    assert.equal(readyResponse.status, 200, await readyResponse.clone().text());
    const ready = await readyResponse.json();
    const replay = await (await post(controlPlane, createPath, fresh)).json();
    assert.equal(replay.journal_digest_b64u, ready.journal_digest_b64u);
    assert.equal(replay.replayed, true);
    assert.equal((await (await post(gateway, renewalPath, fresh)).json()).kind, 'started');
    const artifact = {
      kind: 'creation_grant_renewal_workers_e2e_v1',
      heldAtMs: held.heldAtMs,
      originalExpiresAtMs: grant.expires_at_ms,
      fence,
      lateStatus: lateResponse.status,
      lateBody,
      renewedGrantDigestB64u: renewed.grantDigestB64u,
      journalDigestB64u: ready.journal_digest_b64u,
      sameIdentity: renewed.identityDigestB64u === grant.identity_digest_b64u,
      sameLineage: renewed.custodyLineageB64u === grant.custody_lineage_b64u,
      exactJournalReplay: true,
      unauthorizedRequestRefused: true,
      prematureRenewalRefused: true,
      forgedAuthorizationRefused: true,
      startedRenewalRefused: true,
      reproduce: `ROUTER_AB_WORKER_BUILD_PROFILE=${process.env.ROUTER_AB_WORKER_BUILD_PROFILE} node crates/router-ab-cloudflare/scripts/test-grant-renewal.mjs`,
      limits: [
        'Local workerd with real Router, control plane, Wasm and SQLite. The test fixture holds one storage transaction.',
        'No Deriver role, funded transaction or registration latency is measured.',
      ],
    };
    assert.ok(artifact.sameIdentity && artifact.sameLineage);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'evidence.json'), JSON.stringify(artifact, null, 2) + '\n');
    console.log(JSON.stringify({ outcome: 'passed', output, ...artifact }));
  } finally {
    await topology.dispose();
  }
}

await run();
