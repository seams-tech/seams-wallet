import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';
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
  commands = [];
  routerDispatches = [];

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
      if (value.event === 'wallet_do_command_timing') this.commands.push(value);
      if (value.event === 'router_wallet_dispatch_timing') this.routerDispatches.push(value);
    } catch {
      // Other Worker diagnostics are not placement observations.
    }
  }
}

class StatusBeforePreparation {
  observations = [];
  forgedReadinessRejected = false;

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
    if (this.role === 'deriver_a' && path.endsWith('/execute-pair')) {
      const forged = await request.clone().json();
      forged.peer_receipt.signature.bytes[0] ^= 1;
      const rejected = await worker.fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(forged),
      });
      assert.equal(rejected.ok, false, 'Forged readiness must fail before reservation');
      await rejected.text();
      this.forgedReadinessRejected = true;
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

function startupRequest(envelope, credential, home) {
  const identity = envelope.tenant_root.identity;
  const headers = { 'content-type': 'application/json', [authHeader]: credential };
  if (home !== null) headers[homeHeader] = home;
  return new Request('https://custody.test/router-ab/router/wallet/start', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      owner: {
        org_id: identity.orgId,
        project_id: identity.projectId,
        env_id: identity.envId,
        wallet_id: envelope.target.binding.lifecycle.account_id,
      },
      ownership_generation: envelope.target.ownership_generation,
    }),
  });
}

async function settledAdmissions(database) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { results } = await database.prepare(
      "SELECT status, pair_object_name FROM tenant_root_root_use_admissions WHERE attempt_kind = 'ed25519_yao_pair_session'",
    ).all();
    assert.equal(results.length, 1, 'The ceremony must have exactly one admission per role');
    const admission = results[0];
    if (admission.status === 'settled') return admission;
    assert.equal(admission.status, 'admitted');
    await setTimeout(20);
  }
  assert.fail('The completed wallet object did not settle its admission');
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
    const generation = envelope.target.ownership_generation;
    const worker = new MiniflareWorkerBinding(await topology.getWorker('router'));
    const credential = fixture.router_env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET;
    for (const invalid of [null, 'invalid', 'apac']) {
      const rejected = await worker.fetch(executeRequest(envelope, credential, invalid));
      assert.equal(rejected.status, 400, await rejected.text());
      const rejectedStartup = await worker.fetch(startupRequest(envelope, credential, invalid));
      assert.equal(rejectedStartup.status, 400, await rejectedStartup.text());
    }
    const unauthorized = await worker.fetch(executeRequest(envelope, 'wrong-secret', home));
    assert.ok(unauthorized.status === 401 || unauthorized.status === 403);
    const unauthorizedStartup = await worker.fetch(startupRequest(envelope, 'wrong-secret', home));
    assert.ok(unauthorizedStartup.status === 401 || unauthorizedStartup.status === 403);
    assert.equal(log.placements.length, 0, 'Rejected requests must not touch wallet objects');

    const binding = new WalletHomeCustodyBinding(worker, home);
    const lost = new LostCompletedReply(binding);
    const foreignHome = home === 'OC' ? 'WEUR' : 'OC';
    // Discard the startup reply. Execution must need neither its body nor a startup token.
    const startup = await binding.fetch(startupRequest(envelope, credential, foreignHome));
    assert.equal(startup.status, 200, await startup.text());
    const immediate = await Promise.all([
      binding.fetch(startupRequest(envelope, credential, foreignHome)),
      assert.rejects(lost.fetch(executeRequest(envelope, credential, foreignHome)), /discarded the completed/),
    ]);
    assert.equal(immediate[0].status, 200, await immediate[0].text());
    const firstPlacements = [...log.placements];
    const firstCommands = [...log.commands];
    const retried = await lost.fetch(executeRequest(envelope, credential, foreignHome));
    const result = await retried.json();
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(log.routerDispatches.map(event => event.operation),
      ['claim_registration', 'finish_registration', 'claim_registration'],
      'Lost-reply replay must claim the stored answer without another finish');
    for (const event of log.routerDispatches) {
      assert.equal(event.outcome, 'success');
      assert.equal(event.wallet_home, home);
      assert.ok(event.duration_ms >= 0);
    }
    assert.equal(log.placements.filter(event => event.role !== 'router').length,
      firstPlacements.filter(event => event.role !== 'router').length,
      'Completed Router replay must not rerun custody');
    assert.equal(a.observations.length, 1);
    assert.equal(b.observations.length, 1);
    assert.equal(a.forgedReadinessRejected, true);
    const bCommands = firstCommands.filter(command => command.role === 'deriver_b');
    const routerCommands = firstCommands.filter(command => command.role === 'router');
    assert.equal(routerCommands[0].path, '/router-wallet/v1/start');
    assert.equal(routerCommands[0].first_command_after_constructor, true);
    assert.ok(routerCommands.filter(command => command.path.endsWith('/command'))
      .every(command => command.first_command_after_constructor === false),
    'Registration commands must reuse the live object reached by startup');
    assert.equal(bCommands.filter(command => command.path.endsWith('/ed25519-yao/duplex')).length, 1,
      'B must execute the pair WebSocket in its wallet object');
    assert.equal(bCommands.filter(command => command.path.endsWith('/wallet-pair')).length, 2,
      'Only status and preparation may cross the B session-command boundary');
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
    const admissions = {
      deriverA: await settledAdmissions(databases.deriverA),
      deriverB: await settledAdmissions(databases.deriverB),
    };
    for (const [role, admission] of [['deriver_a', admissions.deriverA], ['deriver_b', admissions.deriverB]]) {
      const binding = role === 'deriver_a' ? 'DERIVER_A_WALLET_DO' : 'DERIVER_B_WALLET_DO';
      const namespace = await topology.getDurableObjectNamespace(binding, role.replace('_', '-'));
      assert.equal(namespace.idFromName(admission.pair_object_name).toString(), roleObjects[role].objectId);
    }
    return {
      home, generation, admissions, roleObjects, routerDispatches: log.routerDispatches,
      routerCommands,
      lostStartupReplyAndImmediateExecution: true,
      firstStatusLookups: [...a.observations, ...b.observations],
      invalidHomeRejectedBeforePlacement: true,
      unauthorizedHomeRejected: true,
      callerHomeOverwritten: true,
      completedReplyLossReplayedExactly: true,
      replayRanNoAdditionalCustody: true,
      forgedReadinessRejectedBeforeValidExecution: a.forgedReadinessRejected,
      bProtocolRunsInWalletObject: true,
      bRemoteBeginAndCompleteCalls: 0,
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
