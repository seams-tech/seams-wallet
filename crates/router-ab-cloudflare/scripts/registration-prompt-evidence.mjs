// Real Workers, durable objects, and D1: prepare before input, then claim once.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { Miniflare } from 'miniflare';
import {
  loadFixture, configureRouterJwt, routerWorker, deriverAWorker, deriverBWorker,
  signingWorker, tenantRootControlPlaneWorker, applyMigrations,
  testTenantRootCreationOperatingPath, buildEd25519ExecuteRequest,
} from './test-private-d1.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const preparePath = '/router-ab/router/ed25519-yao/registration/prepare';
const executePath = '/router-ab/router/ed25519-yao/execute';
const connectionPath = '/router-ab/internal/ed25519-yao/registration/connect';
const evidence = [];
const probeRoot = resolve(root, '.artifacts/registration-bound-input');

class RootReadControl {
  entered = Promise.withResolvers();
  released = Promise.withResolvers();

  async fetch(request) {
    this.entered.resolve(await request.json());
    await this.released.promise;
    return new Response('released');
  }

  release() {
    this.released.resolve();
  }
}

class PreparationRequests {
  b = null;
  captureOnly = false;

  async deriverA(request, topology) {
    if (new URL(request.url).pathname.endsWith('/ed25519-yao/execute-pair')) {
      return new Response('Injected interruption before claim', { status: 503 });
    }
    return (await topology.getWorker('deriver-a')).fetch(request);
  }

  async deriverB(request, topology) {
    if (new URL(request.url).pathname.endsWith('/ed25519-yao/prepare-pair')) {
      this.b = { url: request.url, headers: Object.fromEntries(request.headers), body: await request.clone().json() };
      if (this.captureOnly) return new Response('Captured competing input', { status: 503 });
    }
    return (await topology.getWorker('deriver-b')).fetch(request);
  }
}

async function replayPreparation(topology, captured) {
  const worker = await topology.getWorker('deriver-b');
  const response = await worker.fetch(captured.url, {
    method: 'POST', headers: captured.headers, body: JSON.stringify(captured.body),
  });
  return { status: response.status, text: await response.text() };
}

async function checkPendingRelocation(topology, fixture, object, preparation) {
  const worker = await topology.getWorker('deriver-b');
  const response = await worker.fetch('https://probe/router-ab/internal/deriver-b/wallet/relocation-context', {
    method: 'POST',
    headers: { 'content-type': 'application/json',
      'x-router-ab-internal-service-auth': fixture.deriver_b_env.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET },
    body: JSON.stringify({ kind: 'cipher' }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const context = await response.json();
  const identity = preparation.request.tenant_root.identity;
  const command = {
    owner: { org_id: identity.orgId, project_id: identity.projectId, env_id: identity.envId,
      wallet_id: preparation.request.binding.lifecycle.account_id },
    move_id: `wmove_${'p'.repeat(43)}`, request_digest_hex: 'de'.repeat(32),
    cipher_context_digest_hex: context.digest_hex, source_generation: 1, destination_generation: 2,
  };
  const relocation = await object.fetch('https://probe/router-ab/internal/deriver-b/wallet/fence-relocation', {
    method: 'POST', body: JSON.stringify(command),
  });
  assert.equal(relocation.status, 200, await relocation.clone().text());
  const pending = await relocation.json();
  assert.equal(pending.kind, 'pending');
  assert.ok(pending.pending_pairs > 0, 'Consumed grant blocks relocation before a pair exists');
}

async function checkBindingRestart(topology, workers, requests, fixture, roots, addresses, envelope, sessionHex) {
  const original = structuredClone(requests.b);
  assert.ok(original);
  const before = await inspectRole(topology, 'deriver-b', addresses, sessionHex);
  assert.equal(JSON.parse(before.state.binding[0].use_json).kind, 'bound');
  assert.equal(before.state.pairs.length, 0, 'Interruption precedes durable protocol claim');
  await topology.setOptions({ workers: workers.map(restartedWorker) });
  const after = await inspectRole(topology, 'deriver-b', addresses, sessionHex);
  assert.notEqual(after.state.instance, before.state.instance);
  assert.deepEqual(after.state.binding, before.state.binding);
  assert.equal(after.state.rootReads, 0);

  // A new native Router constructs a fully valid pair from newly encrypted
  // inputs for the same ceremony. Only the test transport redirects its
  // wallet route back to the original owner before the role validates it.
  requests.captureOnly = true;
  const alternate = buildEd25519ExecuteRequest(fixture, 'activation', roots.tenantRoot);
  alternate.target = fixture.activation.reencrypted_gateway_request;
  assert.deepEqual(alternate.target.binding, envelope.target.binding);
  assert.notDeepEqual(alternate.target.deriver_b_input, envelope.target.deriver_b_input);
  const routerNamespace = await topology.getDurableObjectNamespace('ROUTER_WALLET_DO', 'router');
  const alternateAddresses = { ...addresses, router: routerNamespace.newUniqueId().toString() };
  const router = await topology.getWorker('router');
  await post(router, fixture, alternateAddresses, executePath, alternate);
  const competing = structuredClone(requests.b);
  assert.notDeepEqual(competing.body.pair_binding, original.body.pair_binding);
  competing.body.tenant_root.wallet_route = original.body.tenant_root.wallet_route;
  const refused = await replayPreparation(topology, competing);
  assert.notEqual(refused.status, 200, refused.text);
  const rejected = await inspectRole(topology, 'deriver-b', addresses, sessionHex);
  assert.match(rejected.state.lastFailure, /Registration input differs from its durable binding/);
  assert.equal(rejected.state.rootReads, 0, 'Conflicting input fails before the root read');
  assert.deepEqual(rejected.state.binding, before.state.binding);
  const replay = await replayPreparation(topology, original);
  assert.equal(replay.status, 200, replay.text);
  const replayed = await inspectRole(topology, 'deriver-b', addresses, sessionHex);
  assert.equal(replayed.state.rootReads, 1, 'Exact replay restores authority and reads the D1 grant');
  evidence.push({ kind: 'restart-binding', passed: true, unclaimedBindingSurvivesRestart: true,
    exactRoleReplayStatus: replay.status, validCompetingInputRefused: true });
}

async function observedRole(worker, className, role, kind, control) {
  const path = resolve(probeRoot, kind, `${role}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  const helper = resolve(root, 'crates/router-ab-cloudflare/scripts/registration-preparation-test-worker.mjs');
  const originalImport = relative(dirname(path), worker.scriptPath);
  const helperImport = relative(dirname(path), helper);
  await writeFile(path, `
    import { ${className} as Original } from ${JSON.stringify(originalImport)};
    export * from ${JSON.stringify(originalImport)};
    export { default } from ${JSON.stringify(originalImport)};
    import { gatedEnvironment, inspectPreparation } from ${JSON.stringify(helperImport)};
    export class ${className} extends Original {
      constructor(state, env) {
        const diagnostics = { rootReads: 0 };
        super(state, gatedEnvironment(state, env, ${JSON.stringify(role)}, diagnostics));
        this.probeState = state;
        this.probeDiagnostics = diagnostics;
        this.probeInstance = crypto.randomUUID();
        this.probeLastFailure = null;
      }
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/__registration_probe/state') {
          return Response.json({ instance: this.probeInstance, lastFailure: this.probeLastFailure,
            ...this.probeDiagnostics, ...inspectPreparation(this.probeState, url.searchParams.get('session')) });
        }
        if (url.pathname === '/__registration_probe/alarm') {
          await super.alarm();
          return new Response('alarm completed');
        }
        try {
          return await super.fetch(request);
        } catch (error) {
          this.probeLastFailure = String(error);
          throw error;
        }
      }
    }
  `);
  let gate = 'none';
  if (kind === 'consumed-expiry') gate = 'before';
  if (kind === 'cancel-after-read') gate = 'after';
  return {
    ...worker, scriptPath: path,
    bindings: { ...worker.bindings, REGISTRATION_READ_GATE: gate },
    serviceBindings: { ...worker.serviceBindings, REGISTRATION_TEST_CONTROL: control.fetch.bind(control) },
  };
}

function restartedWorker(worker) {
  return { ...worker, bindings: { ...worker.bindings, REGISTRATION_TEST_RESTART: 'after-completion' } };
}

async function inspectRole(topology, role, addresses, session) {
  const binding = role === 'deriver-a' ? 'DERIVER_A_WALLET_DO' : 'DERIVER_B_WALLET_DO';
  const namespace = await topology.getDurableObjectNamespace(binding, role);
  const address = role === 'deriver-a' ? addresses.deriver_a : addresses.deriver_b;
  const stub = namespace.get(namespace.idFromString(address));
  const response = await stub.fetch(`https://probe/__registration_probe/state?session=${session}`);
  assert.equal(response.status, 200);
  return { stub, state: await response.json() };
}

class PeerCalls {
  paths = [];
  async fetch(request) {
    this.paths.push(new URL(request.url).pathname);
    return new Response('ok');
  }
}

async function post(router, fixture, addresses, path, body) {
  const response = await router.fetch(`https://router.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': fixture.router_env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET,
      'x-seams-wallet-home-region': 'US',
      'x-seams-wallet-object-addresses': JSON.stringify(addresses),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

async function run(kind) {
  const fixture = loadFixture();
  configureRouterJwt(fixture);
  const control = new RootReadControl();
  const requests = new PreparationRequests();
  const routerOptions = routerWorker(fixture);
  if (kind === 'restart-binding') {
    routerOptions.serviceBindings.DERIVER_A = requests.deriverA.bind(requests);
    routerOptions.serviceBindings.DERIVER_B = requests.deriverB.bind(requests);
  }
  const a = await observedRole(deriverAWorker(fixture), 'RouterAbDeriverAWalletDurableObject', 'deriver_a', kind, control);
  const b = await observedRole(deriverBWorker(fixture), 'RouterAbDeriverBWalletDurableObject', 'deriver_b', kind, control);
  a.serviceBindings.DERIVER_B = 'peer-observer';
  const calls = new PeerCalls();
  const workers = [
    routerOptions, a, b, tenantRootControlPlaneWorker(fixture),
    signingWorker('fixture-signing-worker', 'registration-signing-worker', fixture),
    { name: 'peer-observer', modules: true, compatibilityDate: '2026-06-12',
      script: `export default { async fetch(request, env) {
        await env.COUNTS.fetch('https://count' + new URL(request.url).pathname);
        return env.REAL.fetch(request);
      }};`,
      serviceBindings: { COUNTS: calls.fetch.bind(calls), REAL: 'deriver-b' },
    },
  ];
  const topology = new Miniflare({ workers });
  try {
    await topology.ready;
    const migrations = resolve(root, 'crates/router-ab-cloudflare/migrations');
    const databases = {
      deriverA: await applyMigrations(topology, 'DERIVER_ROLE_PRIVATE_DB', 'deriver-a', resolve(migrations, 'deriver-a')),
      deriverB: await applyMigrations(topology, 'DERIVER_ROLE_PRIVATE_DB', 'deriver-b', resolve(migrations, 'deriver-b')),
    };
    await applyMigrations(topology, 'SIGNING_WORKER_PRIVATE_DB', 'fixture-signing-worker', resolve(migrations, 'signing-worker'));
    const roots = await testTenantRootCreationOperatingPath(topology, fixture, databases);
    const router = await topology.getWorker('router');
    const addresses = {};
    for (const [role, binding, worker] of [
      ['router', 'ROUTER_WALLET_DO', 'router'], ['deriver_a', 'DERIVER_A_WALLET_DO', 'deriver-a'],
      ['deriver_b', 'DERIVER_B_WALLET_DO', 'deriver-b'],
      ['signing_worker', 'SIGNING_WORKER_WALLET_DO', 'fixture-signing-worker'],
    ]) {
      addresses[role] = (await topology.getDurableObjectNamespace(binding, worker)).newUniqueId().toString();
    }
    const envelope = buildEd25519ExecuteRequest(fixture, 'activation', roots.tenantRoot);
    const preparation = {
      tenant_root: envelope.tenant_root, application: envelope.application,
      participant_ids: envelope.participant_ids, binding: envelope.target.binding,
      ownership_generation: envelope.target.ownership_generation,
      expires_at_ms: Date.now() + preparationLifetime(kind),
    };
    if (kind === 'admission-failure') {
      for (const database of Object.values(databases)) {
        await database.prepare(`CREATE TRIGGER refuse_preparation BEFORE INSERT ON tenant_root_root_use_admissions
          BEGIN SELECT RAISE(ABORT, 'injected_preparation_failure'); END`).run();
      }
      const failed = await post(router, fixture, addresses, preparePath, preparation);
      assert.notEqual(failed.status, 200, JSON.stringify(failed));
      for (const database of Object.values(databases)) {
        await database.prepare('DROP TRIGGER refuse_preparation').run();
      }
      const result = await post(router, fixture, addresses, executePath, envelope);
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
      evidence.push({ kind, passed: true, onlineFallbackAfterAdmissionFailure: true });
      return;
    }
    const unauthenticated = await router.fetch(`https://router.test${preparePath}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(preparation),
    });
    assert.equal(unauthenticated.status, 403, 'Preparation requires the Gateway service credential');
    const first = await post(router, fixture, addresses, preparePath, preparation);
    assert.equal(first.status, 200, JSON.stringify(first));
    assert.equal(calls.paths.filter(isPreparedConnection).length, 1);
    const sessionHex = Buffer.from(preparation.binding.session_id).toString('hex');
    for (const database of Object.values(databases)) {
      const row = await database.prepare(`SELECT status, preparation_digest_hex FROM tenant_root_root_use_admissions
        WHERE attempt_key_hex = ?`).bind(sessionHex).first();
      assert.equal(row.status, 'admitted');
      assert.match(row.preparation_digest_hex, /^[a-f0-9]{64}$/);
    }
    const retry = await post(router, fixture, addresses, preparePath, preparation);
    assert.equal(retry.status, 200, JSON.stringify(retry));
    assert.equal(calls.paths.filter(isPreparedConnection).length, 1, 'Setup replay must reuse its connection');
    if (kind === 'expired' || kind === 'abandoned') {
      await setTimeout(2_500);
      // Real alarms remove abandoned admissions. An execute can also perform this cleanup inline.
      for (const database of Object.values(databases)) {
        const row = await database.prepare('SELECT count(*) AS count FROM tenant_root_root_use_admissions WHERE attempt_key_hex = ?').bind(sessionHex).first();
        assert.equal(row.count, 0, 'Abandoned preparations must release both admissions');
      }
    }
    const readOnlyPrepared = ['prepared', 'consumed-expiry', 'cancel-after-read', 'restart-binding'].includes(kind);
    if (readOnlyPrepared) {
      for (const database of Object.values(databases)) {
        await database.prepare(`CREATE TRIGGER refuse_input_binding BEFORE UPDATE OF
          attempt_digest_hex, first_binding_digest_hex, preparation_digest_hex, expires_at_ms
          ON tenant_root_root_use_admissions
          BEGIN SELECT RAISE(ABORT, 'registration_input_must_bind_locally'); END`).run();
      }
    }
    if (kind === 'cancelled') {
      for (const database of Object.values(databases)) {
        await database.prepare("UPDATE tenant_root_root_use_admissions SET status = 'cancelled' WHERE attempt_key_hex = ?")
          .bind(sessionHex).run();
      }
      const refused = await post(router, fixture, addresses, executePath, envelope);
      assert.notEqual(refused.body.status, 'succeeded', JSON.stringify(refused));
      for (const database of Object.values(databases)) {
        const row = await database.prepare('SELECT status FROM tenant_root_root_use_admissions WHERE attempt_key_hex = ?')
          .bind(sessionHex).first();
        assert.equal(row.status, 'cancelled', 'Execute must not revive a cancelled preparation');
      }
    } else if (kind !== 'abandoned') {
      const execution = post(router, fixture, addresses, executePath, envelope);
      if (kind === 'consumed-expiry' || kind === 'cancel-after-read') {
        const entered = await Promise.race([
          control.entered.promise,
          execution.then(unexpectedEarlyExecution),
        ]);
        assert.equal(entered.objectId, addresses.deriver_b);
        const before = await inspectRole(topology, 'deriver-b', addresses, sessionHex);
        const bound = JSON.parse(before.state.binding[0].use_json);
        assert.equal(bound.kind, 'bound');
        if (kind === 'consumed-expiry') {
          await setTimeout(Math.max(0, bound.preparation.custody_binding.expires_at_ms - Date.now()) + 100);
          await before.stub.fetch('https://probe/__registration_probe/alarm');
          const expired = await inspectRole(topology, 'deriver-b', addresses, sessionHex);
          assert.equal(expired.state.preparation.length, 0);
          assert.deepEqual(expired.state.binding, before.state.binding, 'Expiry must retain the consumed input binding');
          assert.equal(expired.state.pairs.length, 0);
          await checkPendingRelocation(topology, fixture, expired.stub, bound.preparation);
          const grant = await databases.deriverB.prepare('SELECT status FROM tenant_root_root_use_admissions WHERE attempt_key_hex = ?').bind(sessionHex).first();
          assert.equal(grant.status, 'admitted', 'Expiry must not delete a consumed D1 grant');
        } else {
          const fence = await before.stub.fetch('https://probe/router-ab/internal/deriver-b/wallet-pair/reconcile', {
            method: 'POST', body: JSON.stringify({ session_hex: sessionHex, fence: true, peer_settled: false, now_ms: Date.now() }),
          });
          assert.equal(fence.status, 200);
          await databases.deriverB.prepare("UPDATE tenant_root_root_use_admissions SET status = 'cancelled' WHERE attempt_key_hex = ?").bind(sessionHex).run();
        }
        control.release();
      }
      const result = await execution;
      if (kind === 'restart-binding') {
        assert.notEqual(result.body.status, 'succeeded');
        await checkBindingRestart(topology, workers, requests, fixture, roots, addresses, envelope, sessionHex);
        return;
      }
      if (kind === 'cancel-after-read') {
        assert.notEqual(result.body.status, 'succeeded', JSON.stringify(result));
        const grant = await databases.deriverB.prepare('SELECT status FROM tenant_root_root_use_admissions WHERE attempt_key_hex = ?').bind(sessionHex).first();
        assert.equal(grant.status, 'cancelled');
        evidence.push({ kind, passed: true, cancellationAfterSnapshotRefused: true });
        return;
      }
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
      const pathsAfterExecution = [...calls.paths];
      assert.deepEqual(await post(router, fixture, addresses, executePath, envelope), result);
      assert.deepEqual(calls.paths, pathsAfterExecution, 'Exact replay must not reconnect or execute');
      for (const database of Object.values(databases)) {
        const row = await database.prepare(`SELECT status, preparation_digest_hex FROM tenant_root_root_use_admissions
          WHERE attempt_key_hex = ?`).bind(sessionHex).first();
        if (readOnlyPrepared) assert.match(row.preparation_digest_hex, /^[a-f0-9]{64}$/, 'D1 retains its input-free grant');
        else assert.equal(row.preparation_digest_hex, null, 'Online admission binds the input directly');
      }
      if (kind === 'prepared') {
        assert.equal(calls.paths.filter(isDuplex).length, 0, 'Execute must use the early connection');
        const before = await inspectRole(topology, 'deriver-b', addresses, sessionHex);
        await topology.setOptions({ workers: workers.map(restartedWorker) });
        const after = await inspectRole(topology, 'deriver-b', addresses, sessionHex);
        assert.notEqual(after.state.instance, before.state.instance, 'The object must reconstruct after eviction');
        assert.deepEqual(after.state.binding, before.state.binding, 'Input binding survives eviction');
        const restartedRouter = await topology.getWorker('router');
        assert.deepEqual(await post(restartedRouter, fixture, addresses, executePath, envelope), result);
        const changed = structuredClone(envelope);
        changed.target.deriver_b_input.ciphertext[0] ^= 1;
        const conflict = await post(restartedRouter, fixture, addresses, executePath, changed);
        assert.notEqual(conflict.body.status, 'succeeded', 'Changed input must not replay a completed registration');
        const retained = await inspectRole(topology, 'deriver-b', addresses, sessionHex);
        assert.deepEqual(retained.state.binding, before.state.binding);
      }
    }
    evidence.push({ kind, paths: calls.paths, passed: true, unauthenticatedPreparationRefused: true });
  } finally {
    control.release();
    await topology.dispose();
  }
}

function isPreparedConnection(path) { return path === connectionPath; }
function isDuplex(path) { return path.includes('duplex'); }

function unexpectedEarlyExecution(result) {
  throw new Error(`Execution ended before the injected root read: ${JSON.stringify(result)}`);
}

function preparationLifetime(kind) {
  if (kind === 'consumed-expiry') return 8_000;
  if (['expired', 'abandoned', 'admission-failure'].includes(kind)) return 2_000;
  return 29_000;
}

for (const kind of ['prepared', 'restart-binding', 'consumed-expiry', 'cancel-after-read', 'expired', 'abandoned', 'cancelled', 'admission-failure']) {
  await run(kind);
  console.log(`Registration preparation scenario passed: ${kind}`);
}
const output = resolve(root, '.artifacts/r155h-prompt-preparation/worker-evidence.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ evidence }, null, 2)}\n`);
console.log(`Registration prompt evidence: ${output}`);
