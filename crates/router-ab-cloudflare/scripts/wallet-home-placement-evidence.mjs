import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createInterface } from 'node:readline';
import { Log, LogLevel, Miniflare } from 'miniflare';
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
const output = resolve(root, '.artifacts/wallet-home-placement');
const authHeader = 'x-router-ab-internal-service-auth';
const homeHeader = 'x-seams-wallet-home-region';
const executePath = '/router-ab/router/ed25519-yao/execute';
const hints = { US: 'enam', WEUR: 'weur', APAC: 'apac', OC: 'oc' };

class PlacementLog extends Log {
  placements = [];

  constructor() {
    super(LogLevel.INFO);
  }

  connect(stdout, stderr) {
    for (const stream of [stdout, stderr]) {
      createInterface({ input: stream }).on('line', this.log.bind(this));
    }
  }

  log(message) {
    if (message.includes('[mf:err]') || message.includes('[mf:wrn]')) console.error(message);
    const start = message.indexOf('{');
    if (start < 0) return;
    try {
      const value = JSON.parse(message.slice(start));
      if (value.event === 'wallet_do_placement_requested') this.placements.push(value);
    } catch {
      // Other Worker diagnostics are not placement observations.
    }
  }
}

class StatusBeforePreparation {
  observations = [];

  constructor(worker, role, home) {
    this.worker = worker;
    this.role = role;
    this.home = home;
  }

  async fetch(request, topology) {
    const worker = await topology.getWorker(this.worker);
    const path = new URL(request.url).pathname;
    if (path.endsWith('/prepare-pair')) {
      const preparation = await request.clone().json();
      assert.equal(preparation.tenant_root.wallet_home, this.home);
      const lookup = {
        wallet_home: preparation.tenant_root.wallet_home,
        ownership_generation: preparation.tenant_root.ownership_generation,
        root_identity: preparation.tenant_root.identity,
        pair_binding: preparation.pair_binding,
      };
      const status = await worker.fetch(
        `https://custody.test/router-ab/${this.worker}/ed25519-yao/read-pair-status`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', [authHeader]: request.headers.get(authHeader) },
          body: JSON.stringify(lookup),
        },
      );
      assert.equal(status.status, 200, await status.clone().text());
      const result = await status.json();
      assert.equal(result.status, 'missing');
      this.observations.push({ role: this.role, generation: lookup.ownership_generation, firstStatus: result.status });
    }
    return worker.fetch(request);
  }
}

class MiniflareWorkerBinding {
  constructor(worker) {
    this.worker = worker;
  }

  async fetch(input, init) {
    const request = new Request(input, init);
    return this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.arrayBuffer(),
    });
  }
}

class LostCompletedReply {
  completed = null;
  drop = true;

  constructor(binding) {
    this.binding = binding;
  }

  async fetch(input, init) {
    const response = await this.binding.fetch(input, init);
    const body = await response.clone().text();
    assert.equal(response.status, 200, body);
    assert.equal(JSON.parse(body).status, 'succeeded', body);
    if (this.drop) {
      this.drop = false;
      this.completed = body;
      throw new Error('Test discarded the completed Router reply');
    }
    assert.equal(body, this.completed, 'Retry must return the exact completed result');
    return response;
  }
}

function executeRequest(envelope, credential, home) {
  const headers = { 'content-type': 'application/json', [authHeader]: credential };
  if (home !== null) headers[homeHeader] = home;
  return new Request(`https://custody.test${executePath}`, {
    method: 'POST', headers, body: JSON.stringify(envelope),
  });
}

async function verifyRegion(home, WalletHomeCustodyBinding) {
  const fixture = loadFixture();
  configureRouterJwt(fixture);
  const log = new PlacementLog();
  const a = new StatusBeforePreparation('deriver-a', 'deriver_a', home);
  const b = new StatusBeforePreparation('deriver-b', 'deriver_b', home);
  const router = routerWorker(fixture);
  router.serviceBindings.DERIVER_A = a.fetch.bind(a);
  router.serviceBindings.DERIVER_B = b.fetch.bind(b);
  const topology = new Miniflare({
    log,
    handleRuntimeStdio: log.connect.bind(log),
    workers: [router, deriverAWorker(fixture), deriverBWorker(fixture),
      tenantRootControlPlaneWorker(fixture),
      signingWorker('fixture-signing-worker', 'placement-signing-worker', fixture)],
  });
  try {
    await topology.ready;
    const migrationRoot = resolve(root, 'crates/router-ab-cloudflare/migrations');
    const databases = {
      deriverA: await applyMigrations(topology, 'DERIVER_ROLE_PRIVATE_DB', 'deriver-a', resolve(migrationRoot, 'deriver-a')),
      deriverB: await applyMigrations(topology, 'DERIVER_ROLE_PRIVATE_DB', 'deriver-b', resolve(migrationRoot, 'deriver-b')),
    };
    await applyMigrations(topology, 'SIGNING_WORKER_PRIVATE_DB', 'fixture-signing-worker', resolve(migrationRoot, 'signing-worker'));
    const { tenantRoot } = await testTenantRootCreationOperatingPath(topology, fixture, databases);
    const envelope = buildEd25519ExecuteRequest(fixture, 'activation', tenantRoot);
    const worker = new MiniflareWorkerBinding(await topology.getWorker('router'));
    const credential = fixture.router_env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET;
    for (const invalid of [null, 'invalid', 'apac']) {
      const rejected = await worker.fetch(executeRequest(envelope, credential, invalid));
      assert.equal(rejected.status, 400, await rejected.text());
    }
    const unauthorized = await worker.fetch(executeRequest(envelope, 'wrong-secret', home));
    assert.ok(unauthorized.status === 401 || unauthorized.status === 403);
    assert.equal(log.placements.length, 0, 'Rejected requests must not touch wallet objects');

    const lost = new LostCompletedReply(new WalletHomeCustodyBinding(worker, home));
    const foreignHome = home === 'OC' ? 'WEUR' : 'OC';
    await assert.rejects(lost.fetch(executeRequest(envelope, credential, foreignHome)), /discarded the completed/);
    const firstPlacements = [...log.placements];
    const retried = await lost.fetch(executeRequest(envelope, credential, foreignHome));
    const result = await retried.json();
    assert.equal(result.status, 'succeeded');
    assert.equal(log.placements.filter(event => event.role !== 'router').length,
      firstPlacements.filter(event => event.role !== 'router').length,
      'Completed Router replay must not rerun custody');
    assert.equal(a.observations.length, 1);
    assert.equal(b.observations.length, 1);
    const roleObjects = {};
    for (const role of ['router', 'deriver_a', 'deriver_b', 'signing_worker']) {
      const events = firstPlacements.filter(event => event.role === role);
      assert.ok(events.length > 0, `Missing placement evidence for ${role}`);
      for (const event of events) {
        assert.equal(event.wallet_home, home);
        assert.equal(event.location_hint, hints[home]);
      }
      const objects = [...new Set(events.map(event => event.object_id))];
      assert.equal(objects.length, 1, `${role} must reuse the exact wallet object`);
      roleObjects[role] = { objectId: objects[0], calls: events.length, hint: hints[home] };
    }
    return {
      home, roleObjects, firstStatusLookups: [...a.observations, ...b.observations],
      invalidHomeRejectedBeforePlacement: true,
      unauthorizedHomeRejected: true,
      callerHomeOverwritten: true,
      completedReplyLossReplayedExactly: true,
      replayRanNoAdditionalCustody: true,
    };
  } finally {
    await topology.dispose();
  }
}

await mkdir(output, { recursive: true });
const bindingModule = resolve(output, 'binding.mjs');
await build({
  entryPoints: [resolve(root, 'packages/wallet-server/src/router/cloudflare/runtime/routerAbServiceBindings.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: bindingModule,
});
const { WalletHomeCustodyBinding } = await import(pathToFileURL(bindingModule).href);
const regions = [];
for (const home of Object.keys(hints)) regions.push(await verifyRegion(home, WalletHomeCustodyBinding));
const artifact = {
  kind: 'authenticated_wallet_home_placement_e2e_v1', regions,
  limitation: 'Local Workers verify the requested hints and real custody lifecycle. They do not prove physical Cloudflare locations or hosted latency gains.',
  reproduce: 'ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/wallet-home-placement-evidence.mjs',
};
await writeFile(resolve(output, 'evidence.json'), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify(artifact));
