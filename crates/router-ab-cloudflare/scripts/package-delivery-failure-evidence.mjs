// Exercise failure propagation through the actual Router Worker and wallet object.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { Miniflare } from 'miniflare';
import {
  loadFixture,
  configureRouterJwt,
  routerWorker,
  deriverAWorker,
  deriverBWorker,
  signingWorker,
  tenantRootControlPlaneWorker,
  applyMigrations,
  testTenantRootCreationOperatingPath,
  buildEd25519ExecuteRequest,
} from './test-private-d1.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const executePath = '/router-ab/router/ed25519-yao/execute';
const deliveryPath = '/router-ab/signing-worker/ed25519-yao/activation/packages';
const evidence = [];

class Fault {
  constructor(kind) {
    this.kind = kind;
    this.release = Promise.withResolvers();
    this.started = Promise.withResolvers();
    this.held = false;
    this.executionCalls = 0;
    this.packagesReceived = false;
  }

  async execution(request, topology) {
    if (new URL(request.url).pathname.endsWith('/execute-pair')) {
      this.executionCalls += 1;
      if (['delivery-fails', 'superseded'].includes(this.kind)) {
        this.held = true;
        this.started.resolve();
        await this.release.promise;
      }
      if (this.kind !== 'success' && this.kind !== 'delivery-after-execution') {
        return Response.json(
          { status: 'recoverable_failure', code: 'service_unavailable', retry_after_ms: 1000 },
          { status: 503 },
        );
      }
    }
    const worker = await topology.getWorker('deriver-a');
    return worker.fetch(request);
  }

  async control(request) {
    const path = new URL(request.url).pathname;
    if (path === '/a-ready') await this.started.promise;
    if (path === '/hold') {
      this.held = true;
      await this.release.promise;
    }
    if (path === '/packages') this.packagesReceived = true;
    return new Response('ok');
  }
}

// Fault replies use a native Worker binding. A Node HTTP bridge can hold its
// response body while the incoming upload remains pending.
const deliveryWorker = `
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '${deliveryPath}' || env.MODE === 'success') {
      return env.REAL.fetch(request);
    }
    if (env.MODE === 'delivery-after-execution') {
      await request.json();
      await env.CONTROL.fetch('https://control/packages');
    } else if (env.MODE === 'ceremony-fails') {
      await env.CONTROL.fetch('https://control/hold');
    } else {
      await env.CONTROL.fetch('https://control/a-ready');
    }
    const body = env.MODE === 'superseded'
      ? 'SupersededAttempt: injected refusal'
      : 'injected delivery failure';
    return new Response(body, { status: 500 });
  }
};
`;

async function execute(router, fixture, envelope, addresses) {
  const response = await router.fetch(`https://router.test${executePath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': fixture.router_env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET,
      'x-seams-wallet-home-region': 'US',
      'x-seams-wallet-object-addresses': JSON.stringify(addresses),
    },
    body: JSON.stringify(envelope),
  });
  const text = await response.text();
  const body = response.headers.get('content-type')?.includes('application/json')
    ? JSON.parse(text)
    : text;
  return { status: response.status, body };
}

async function timeout(durationMs) {
  await setTimeout(durationMs, undefined, { ref: false });
  throw new Error(`Router did not complete within ${durationMs} ms`);
}

async function run(kind) {
  const fixture = loadFixture();
  configureRouterJwt(fixture);
  fixture.router_env.ROUTER_YAO_REGISTRATION_LEASE_MS = '2000';
  const fault = new Fault(kind);
  const router = routerWorker(fixture);
  router.serviceBindings.DERIVER_A = fault.execution.bind(fault);
  router.serviceBindings.SIGNING_WORKER = 'delivery-fault';
  const topology = new Miniflare({ workers: [
    router,
    deriverAWorker(fixture),
    deriverBWorker(fixture),
    tenantRootControlPlaneWorker(fixture),
    signingWorker('fixture-signing-worker', 'failure-signing-worker', fixture),
    {
      name: 'delivery-fault',
      modules: true,
      script: deliveryWorker,
      compatibilityDate: '2026-06-12',
      bindings: { MODE: kind },
      serviceBindings: { REAL: 'fixture-signing-worker', CONTROL: fault.control.bind(fault) },
    }] });
  try {
    await topology.ready;
    const migrations = resolve(root, 'crates/router-ab-cloudflare/migrations');
    const databases = {
      deriverA: await applyMigrations(topology, 'DERIVER_ROLE_PRIVATE_DB', 'deriver-a', resolve(migrations, 'deriver-a')),
      deriverB: await applyMigrations(topology, 'DERIVER_ROLE_PRIVATE_DB', 'deriver-b', resolve(migrations, 'deriver-b')),
    };
    await applyMigrations(topology, 'SIGNING_WORKER_PRIVATE_DB', 'fixture-signing-worker', resolve(migrations, 'signing-worker'));
    const roots = await testTenantRootCreationOperatingPath(topology, fixture, databases);
    const binding = await topology.getWorker('router');
    const addresses = {};
    for (const [role, namespaceName, workerName] of [
      ['router', 'ROUTER_WALLET_DO', 'router'],
      ['deriver_a', 'DERIVER_A_WALLET_DO', 'deriver-a'],
      ['deriver_b', 'DERIVER_B_WALLET_DO', 'deriver-b'],
      ['signing_worker', 'SIGNING_WORKER_WALLET_DO', 'fixture-signing-worker'],
    ]) {
      const namespace = await topology.getDurableObjectNamespace(namespaceName, workerName);
      addresses[role] = namespace.newUniqueId().toString();
    }
    const envelope = buildEd25519ExecuteRequest(fixture, 'activation', roots.tenantRoot);
    const started = performance.now();
    const deadlineMs = ['success', 'delivery-after-execution'].includes(kind) ? 60_000 : 5_000;
    const result = await Promise.race([
      execute(binding, fixture, envelope, addresses),
      timeout(deadlineMs),
    ]);
    const elapsedMs = Math.round(performance.now() - started);
    if (kind === 'success') {
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'succeeded');
      const replay = await execute(binding, fixture, envelope, addresses);
      assert.deepEqual(replay, result, 'Exact replay returns the committed result');
    } else if (kind === 'delivery-after-execution') {
      assert.equal(result.status, 500);
      assert.equal(fault.packagesReceived, true);
      const executions = fault.executionCalls;
      await setTimeout(2_100);
      const replay = await execute(binding, fixture, envelope, addresses);
      assert.deepEqual(replay, {
        status: 200,
        body: { status: 'recoverable_failure', code: 'signing_worker_uncertain', retry_after_ms: 1000 },
      });
      assert.equal(fault.executionCalls, executions, 'Uncertain delivery must not repeat the completed protocol');
    } else {
      assert.ok(fault.held, 'A real downstream request remains held until cleanup');
      assert.notEqual(result.body.status, 'succeeded');
      if (kind === 'delivery-fails') assert.equal(result.status, 500);
      if (kind === 'ceremony-fails') {
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, { status: 'recoverable_failure', code: 'service_unavailable', retry_after_ms: 1000 });
      }
      if (kind === 'superseded') {
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, { status: 'rejected', code: 'attempt_superseded' });
        const replay = await execute(binding, fixture, envelope, addresses);
        assert.deepEqual(replay, result, 'Terminal refusal survives exact retry');
      }
    }
    evidence.push({
      kind,
      elapsedMs,
      result,
      heldUntilCleanup: fault.held,
      executionCalls: fault.executionCalls,
      packagesReceived: fault.packagesReceived,
    });
  } finally {
    fault.release.resolve();
    await topology.dispose();
  }
}

for (const kind of [
  'delivery-fails', 'ceremony-fails', 'superseded', 'delivery-after-execution', 'success',
]) {
  await run(kind);
}
const output = resolve(root, '.artifacts/package-delivery-failure/evidence.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ evidence }, null, 2)}\n`);
console.log(`Verified failure propagation and exact replay: ${output}`);
