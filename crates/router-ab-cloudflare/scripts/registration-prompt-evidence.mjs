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
import { heldRootReadWorker, observedPreparedPeer } from './registration-peer-read-worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const preparePath = '/router-ab/router/ed25519-yao/registration/prepare';
const executePath = '/router-ab/router/ed25519-yao/execute';
const connectionPath = '/router-ab/internal/ed25519-yao/registration/connect';
const evidence = [];

class PeerCalls {
  paths = [];
  holdRead = false;
  readArrived = Promise.withResolvers();
  prefaceArrived = Promise.withResolvers();
  releaseRead = Promise.withResolvers();
  start = null;
  async fetch(request) {
    const path = new URL(request.url).pathname;
    this.paths.push(path);
    if (path === '/a-start') this.start = await request.json();
    if (path === '/root-read' && this.holdRead) {
      this.readArrived.resolve();
      const status = await this.releaseRead.promise;
      return new Response('released', { status });
    }
    if (path === '/a-preface') this.prefaceArrived.resolve();
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
  if (kind === 'failed-read') fixture.router_env.ROUTER_YAO_REGISTRATION_LEASE_MS = '1000';
  const a = deriverAWorker(fixture);
  a.serviceBindings.DERIVER_B = 'peer-observer';
  const calls = new PeerCalls();
  const b = deriverBWorker(fixture);
  const readScenario = kind === 'delayed-read' || kind === 'failed-read';
  if (readScenario) {
    const wrapper = resolve(root, '.artifacts/registration-peer-read/worker.mjs');
    await mkdir(dirname(wrapper), { recursive: true });
    await writeFile(wrapper, heldRootReadWorker(relative(dirname(wrapper), b.scriptPath)));
    b.scriptPath = wrapper;
    b.serviceBindings.READ_OBSERVER = calls.fetch.bind(calls);
  }
  const topology = new Miniflare({ workers: [
    routerWorker(fixture), a, b, tenantRootControlPlaneWorker(fixture),
    signingWorker('fixture-signing-worker', 'registration-signing-worker', fixture),
    { name: 'peer-observer', modules: true, compatibilityDate: '2026-06-12',
      script: readScenario ? observedPreparedPeer : `export default { async fetch(request, env) {
        await env.COUNTS.fetch('https://count' + new URL(request.url).pathname);
        return env.REAL.fetch(request);
      }};`,
      serviceBindings: { COUNTS: calls.fetch.bind(calls), REAL: 'deriver-b' },
    },
  ] });
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
      expires_at_ms: Date.now() + (readScenario || ['prepared', 'cancelled'].includes(kind) ? 29_000 : 2_000),
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
    if (readScenario) {
      calls.holdRead = true;
      const proxy = await topology.getWorker('peer-observer');
      const execution = post(router, fixture, addresses, executePath, envelope);
      let heldFrames;
      try {
        await Promise.race([
          calls.readArrived.promise,
          setTimeout(10_000).then(readDeadline),
        ]);
        await Promise.race([
          calls.prefaceArrived.promise,
          setTimeout(10_000).then(readDeadline),
        ]);
        assert.equal(calls.paths.filter(isRootRead).length, 1);
        heldFrames = await (await proxy.fetch('https://proxy/evidence')).json();
        assert.deepEqual(heldFrames, { connections: 1, aPrefaces: 1, bStarted: 1, bProofs: 0 },
          'A claims and sends its proof while B waits for its root read');
      } finally {
        calls.releaseRead.resolve(kind === 'failed-read' ? 503 : 200);
      }
      const result = await execution;
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.status, kind === 'failed-read' ? 'recoverable_failure' : 'succeeded', JSON.stringify(result));
      const expectedState = kind === 'failed-read' ? 'burned' : 'completed';
      const roleStates = await readRoleStates(topology, fixture, calls.start.scope.scope);
      assert.deepEqual(roleStates, { 'deriver-a': expectedState, 'deriver-b': expectedState });
      const pathsAfterExecution = [...calls.paths];
      const framesAfterExecution = await (await proxy.fetch('https://proxy/evidence')).json();
      const replay = await post(router, fixture, addresses, executePath, envelope);
      if (kind === 'failed-read') {
        assert.equal(replay.body.status, 'recoverable_failure');
        assert.equal(replay.body.code, 'execution_in_progress');
        await setTimeout(1_100);
        const terminal = await post(router, fixture, addresses, executePath, envelope);
        assert.equal(terminal.body.status, 'burned', JSON.stringify(terminal));
        assert.deepEqual(await post(router, fixture, addresses, executePath, envelope), terminal);
      } else {
        assert.deepEqual(replay, result);
      }
      assert.deepEqual(calls.paths, pathsAfterExecution, 'A failed read cannot restart the spent execution');
      assert.deepEqual(await (await proxy.fetch('https://proxy/evidence')).json(), framesAfterExecution);
      evidence.push({ kind, passed: true, result: result.body.status, roleStates, heldFrames,
        framesAfterExecution, paths: calls.paths,
        aClaimOverlapsBRead: true, bProofRequiresRootRead: true, exactReplayPreserved: true });
      return;
    }
    if (kind === 'expired' || kind === 'abandoned') {
      await setTimeout(2_500);
      // Real alarms remove abandoned admissions. An execute can also perform this cleanup inline.
      for (const database of Object.values(databases)) {
        const row = await database.prepare('SELECT count(*) AS count FROM tenant_root_root_use_admissions WHERE attempt_key_hex = ?').bind(sessionHex).first();
        assert.equal(row.count, 0, 'Abandoned preparations must release both admissions');
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
      const result = await post(router, fixture, addresses, executePath, envelope);
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
      const pathsAfterExecution = [...calls.paths];
      assert.deepEqual(await post(router, fixture, addresses, executePath, envelope), result);
      assert.deepEqual(calls.paths, pathsAfterExecution, 'Exact replay must not reconnect or execute');
      for (const database of Object.values(databases)) {
        const row = await database.prepare(`SELECT status, preparation_digest_hex FROM tenant_root_root_use_admissions
          WHERE attempt_key_hex = ?`).bind(sessionHex).first();
        assert.equal(row.preparation_digest_hex, null, 'Input binding consumes preparation exactly once');
      }
      if (kind === 'prepared') assert.equal(calls.paths.filter(isDuplex).length, 0, 'Execute must use the early connection');
    }
    evidence.push({ kind, paths: calls.paths, passed: true, unauthenticatedPreparationRefused: true });
  } finally {
    await topology.dispose();
  }
}

function isPreparedConnection(path) { return path === connectionPath; }
function isDuplex(path) { return path.includes('duplex'); }
function isRootRead(path) { return path === '/root-read'; }
function readDeadline() { throw new Error('Prepared-peer read ordering timed out'); }

async function readRoleStates(topology, fixture, scope) {
  const states = {};
  for (const role of ['deriver-a', 'deriver-b']) {
    const worker = await topology.getWorker(role);
    const response = await worker.fetch(`https://role/router-ab/${role}/ed25519-yao/read-pair-status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-router-ab-internal-service-auth': fixture.deriver_a_env.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET,
        'x-seams-wallet-home-region': scope.wallet_route.home,
        'x-seams-wallet-object-addresses': JSON.stringify(scope.wallet_route.addresses),
      },
      body: JSON.stringify(scope),
    });
    assert.equal(response.status, 200);
    states[role] = (await response.json()).status;
  }
  return states;
}

const scenarios = ['prepared', 'expired', 'abandoned', 'cancelled', 'admission-failure', 'delayed-read', 'failed-read'];
const requested = process.argv.slice(2);
for (const kind of requested) assert.ok(scenarios.includes(kind), `Unknown scenario: ${kind}`);
for (const kind of requested.length ? requested : scenarios) await run(kind);
const output = resolve(root, '.artifacts/r155h-prompt-preparation/worker-evidence.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ evidence }, null, 2)}\n`);
console.log(`Registration prompt evidence: ${output}`);
