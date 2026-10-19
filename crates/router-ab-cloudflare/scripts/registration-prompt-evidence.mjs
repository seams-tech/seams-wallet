// Real Workers, durable objects, and D1: prepare before input, then claim once.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
  const a = deriverAWorker(fixture);
  a.serviceBindings.DERIVER_B = 'peer-observer';
  const calls = new PeerCalls();
  const topology = new Miniflare({ workers: [
    routerWorker(fixture), a, deriverBWorker(fixture), tenantRootControlPlaneWorker(fixture),
    signingWorker('fixture-signing-worker', 'registration-signing-worker', fixture),
    { name: 'peer-observer', modules: true, compatibilityDate: '2026-06-12',
      script: `export default { async fetch(request, env) {
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
    const startupEvidence = kind === 'initialized-owner'
      ? await checkStartedOwner(topology, router, fixture, addresses, envelope)
      : null;
    const preparation = {
      tenant_root: envelope.tenant_root, application: envelope.application,
      participant_ids: envelope.participant_ids, binding: envelope.target.binding,
      ownership_generation: envelope.target.ownership_generation,
      expires_at_ms: Date.now() + (['prepared', 'cancelled', 'initialized-owner'].includes(kind) ? 29_000 : 2_000),
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
    evidence.push({ kind, paths: calls.paths, passed: true, startupEvidence,
      unauthenticatedPreparationRefused: true });
  } finally {
    await topology.dispose();
  }
}

function isPreparedConnection(path) { return path === connectionPath; }
function isDuplex(path) { return path.includes('duplex'); }

async function checkStartedOwner(topology, router, fixture, addresses, envelope) {
  const identity = envelope.tenant_root.identity;
  const startup = {
    owner: {
      org_id: identity.orgId,
      project_id: identity.projectId,
      env_id: identity.envId,
      wallet_id: envelope.target.binding.lifecycle.account_id,
    },
    ownership_generation: envelope.target.ownership_generation,
  };
  const path = '/router-ab/router/wallet/start';
  const started = await post(router, fixture, addresses, path, startup);
  assert.deepEqual(started, { status: 200, body: true });
  assert.deepEqual(await post(router, fixture, addresses, path, startup), started);
  const namespace = await topology.getDurableObjectNamespace('ROUTER_WALLET_DO', 'router');
  const object = namespace.get(namespace.idFromString(addresses.router));
  const changedOwner = structuredClone(startup);
  changedOwner.owner.wallet_id += '-other';
  const wrongOwner = await startRouterObject(object, changedOwner);
  assert.equal(wrongOwner.status, 409, 'Startup must pin the owner before any execution');
  const changedGeneration = structuredClone(startup);
  changedGeneration.ownership_generation += 1;
  const wrongGeneration = await startRouterObject(object, changedGeneration);
  assert.equal(wrongGeneration.status, 409, 'Startup must preserve the stored generation');

  const unused = namespace.get(namespace.newUniqueId());
  assert.equal((await startRouterObject(unused, startup)).status, 200);
  const frozen = await unused.fetch('https://router-object/router-ab/router/wallet/freeze', {
    method: 'POST',
    body: JSON.stringify({
      owner: startup.owner,
      move_id: `wmove_${'s'.repeat(43)}`,
      request_digest_hex: 'ab'.repeat(32),
      source_generation: startup.ownership_generation,
      destination_generation: startup.ownership_generation + 1,
    }),
  });
  assert.equal(frozen.status, 200);
  const frozenState = await frozen.json();
  assert.equal(frozenState.state, 'frozen');
  assert.equal(frozenState.receipt.record_count, 0, 'Startup must create no execution claim');
  assert.equal((await startRouterObject(unused, startup)).status, 409, 'Startup must reject a frozen object');
  return {
    ownerPinnedBeforeExecution: true,
    mismatchingOwnerAndGenerationRefused: true,
    frozenObjectRefused: true,
    executionClaimsBeforeProof: frozenState.receipt.record_count,
  };
}

function startRouterObject(object, startup) {
  return object.fetch('https://router-object/router-ab/internal/wallet/start', {
    method: 'POST', body: JSON.stringify(startup),
  });
}

const scenarios = ['prepared', 'expired', 'abandoned', 'cancelled', 'admission-failure', 'initialized-owner'];
const requested = process.argv.slice(2);
for (const kind of requested) assert.ok(scenarios.includes(kind), `Unknown scenario: ${kind}`);
for (const kind of requested.length ? requested : scenarios) await run(kind);
const output = resolve(root, '.artifacts/r155h-prompt-preparation/worker-evidence.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ evidence }, null, 2)}\n`);
console.log(`Registration prompt evidence: ${output}`);
