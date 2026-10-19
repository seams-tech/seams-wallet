import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, Request } from 'miniflare';
import {
  loadFixture,
  routerWorker,
  deriverAWorker,
  deriverBWorker,
  signingWorker,
  tenantRootControlPlaneWorker,
} from './test-private-d1.mjs';

const output = resolve('.artifacts/wallet-address-allocation');
await mkdir(output, { recursive: true });
const fixture = loadFixture();
const observations = [];
const seen = new Set();
const timings = [];

class RoleAllocationObserver {
  calls = 0;
  failNext = false;
  constructor(name) {
    this.name = name;
  }
  async fetch(request, topology) {
    if (new URL(request.url).pathname.endsWith('/wallet/allocate')) {
      this.calls += 1;
      if (this.failNext) {
        this.failNext = false;
        return new Response('Injected allocation outage', { status: 503 });
      }
    }
    return (await topology.getWorker(this.name)).fetch(request);
  }
}

const observers = {
  DERIVER_A: new RoleAllocationObserver('deriver-a'),
  DERIVER_B: new RoleAllocationObserver('deriver-b'),
  SIGNING_WORKER: new RoleAllocationObserver('fixture-signing-worker'),
};
function workers(revision) {
  const router = routerWorker(fixture);
  router.bindings.ALLOCATION_PROBE_REVISION = revision;
  router.d1Databases = { ...router.d1Databases, GATEWAY_DB: 'allocation-gateway' };
  for (const [binding, observer] of Object.entries(observers)) {
    router.serviceBindings[binding] = observer.fetch.bind(observer);
  }
  return [
    router,
    deriverAWorker(fixture),
    deriverBWorker(fixture),
    signingWorker('fixture-signing-worker', 'allocation-signing-worker', fixture),
    tenantRootControlPlaneWorker(fixture),
  ];
}
function allocationRequest(credential) {
  return new Request('https://router.test/router-ab/router/wallet/allocate', {
    method: 'POST',
    headers: { 'x-router-ab-internal-service-auth': credential },
  });
}
const credential = fixture.router_env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET;
const topology = new Miniflare({ workers: workers('initial') });

async function allocate() {
  const router = await topology.getWorker('router');
  const started = performance.now();
  const response = await router.fetch(allocationRequest(credential));
  assert.equal(response.status, 200, await response.clone().text());
  const addresses = await response.json();
  timings.push(performance.now() - started);
  for (const address of Object.values(addresses)) {
    assert.equal(seen.has(address), false, 'An allocation returned an address twice');
    seen.add(address);
  }
  observations.push(addresses);
  return addresses;
}
function counts() {
  return {
    DERIVER_A: observers.DERIVER_A.calls,
    DERIVER_B: observers.DERIVER_B.calls,
    SIGNING_WORKER: observers.SIGNING_WORKER.calls,
  };
}

try {
  await topology.ready;
  const router = await topology.getWorker('router');
  const unauthorized = await router.fetch(allocationRequest('wrong-credential'));
  assert.ok(unauthorized.status === 401 || unauthorized.status === 403);
  assert.deepEqual(counts(), { DERIVER_A: 0, DERIVER_B: 0, SIGNING_WORKER: 0 });
  for (let index = 0; index < 8; index += 1) await allocate();
  assert.deepEqual(counts(), { DERIVER_A: 1, DERIVER_B: 1, SIGNING_WORKER: 1 },
    'Eight allocations must share one call to each role');
  const sequentialMs = [...timings];

  // Concurrent cache misses may allocate separate batches. Every returned set stays unique.
  await Promise.all(Array.from({ length: 20 }, allocate));
  const afterConcurrent = counts();

  // A discarded reply spends its addresses. Repeated requests receive fresh sets.
  const discarded = await allocate();
  const next = await allocate();
  assert.notDeepEqual(next, discarded);

  // Restart loses only unused metadata. A failed role must expose no partial address set.
  await topology.setOptions({ workers: workers('restart') });
  observers.DERIVER_B.failNext = true;
  const failed = await (await topology.getWorker('router')).fetch(allocationRequest(credential));
  assert.notEqual(failed.status, 200);
  await failed.text();
  const restarted = await allocate();

  const namespaceEntries = [
    ['router', 'ROUTER_WALLET_DO', 'router'],
    ['deriver-a', 'DERIVER_A_WALLET_DO', 'deriver_a'],
    ['deriver-b', 'DERIVER_B_WALLET_DO', 'deriver_b'],
    ['fixture-signing-worker', 'SIGNING_WORKER_WALLET_DO', 'signing_worker'],
  ];
  for (const [worker, binding, key] of namespaceEntries) {
    const namespace = await topology.getDurableObjectNamespace(binding, worker);
    for (const addresses of observations) {
      assert.equal(namespace.idFromString(addresses[key]).toString(), addresses[key]);
    }
  }

  // The production D1 store chooses one address set for simultaneous setup retries.
  const modulePath = resolve(output, 'address-store.mjs');
  await build({
    stdin: {
      contents: `export { D1WalletObjectAddresses } from './packages/wallet-server/src/router/cloudflare/d1/walletObjectAddresses';
        export { walletObjectIdentity } from './packages/wallet-server/src/router/cloudflare/runtime/walletObjectAddresses';`,
      resolveDir: process.cwd(), loader: 'ts',
    },
    tsconfig: 'packages/wallet-server/tsconfig.json', bundle: true, platform: 'node', format: 'esm', outfile: modulePath,
  });
  const { D1WalletObjectAddresses, walletObjectIdentity } = await import(modulePath);
  const database = await topology.getD1Database('GATEWAY_DB', 'router');
  await database.prepare(`CREATE TABLE wallet_object_addresses (
    namespace TEXT, org_id TEXT, project_id TEXT, env_id TEXT, wallet_id TEXT,
    ownership_generation INTEGER, router TEXT, deriver_a TEXT, deriver_b TEXT, signing_worker TEXT,
    PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, ownership_generation)
  )`).run();
  const scope = { namespace: 'allocation', orgId: 'organization', projectId: 'project', envId: 'dev' };
  const store = new D1WalletObjectAddresses(database, scope);
  const identity = walletObjectIdentity('wallet-allocation-race', 1, scope);
  const binding = await topology.getWorker('router');
  const winners = await Promise.all([
    store.initialize(identity, binding, credential),
    store.initialize(identity, binding, credential),
  ]);
  assert.deepEqual(winners[0], winners[1]);
  assert.deepEqual(await store.read(identity), winners[0]);
  const relocated = await store.initialize(walletObjectIdentity(identity.walletId, 2, scope), binding, credential);
  assert.notDeepEqual(relocated, winners[0]);
  assert.deepEqual(await store.read(identity), winners[0]);

  const evidence = {
    kind: 'wallet_address_batch_allocation_e2e_v1',
    sequentialRoleCalls: [1, 1, 1],
    sequentialMs,
    concurrentRequests: 20,
    afterConcurrentRoleCalls: afterConcurrent,
    uniqueAddressCount: seen.size,
    allAddressesValidForTheirNamespaces: true,
    discardedReplyNeverReusesAddresses: true,
    restartAndPartialRoleFailureRecovered: true,
    concurrentSetupKeepsOneStoredWinner: true,
    newOwnershipGenerationGetsNewAddresses: true,
    restarted,
    limitation: 'Local Worker timings exclude Cloudflare transport and cold-isolate variation.',
    reproduce: 'ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/wallet-address-allocation-evidence.mjs',
  };
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('Address allocation, restart, failure, races, and generation isolation passed.');
} finally {
  await topology.dispose();
}
