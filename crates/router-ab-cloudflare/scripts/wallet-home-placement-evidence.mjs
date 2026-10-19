import { verifyDestinationPreparation } from './stored-wallet-preparation-evidence.mjs';
import { MiniflareWorkerBinding } from './miniflare-worker-binding.mjs';
import { createHash } from 'node:crypto';
import { signingFixture, verifySigningResponse } from './ed25519-signing-evidence.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
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
  testEcdsaRegistrationAndActivation,
  testEcdsaNormalSigning,
} from './test-private-d1.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = resolve(root, '.artifacts/wallet-home-placement');
const authHeader = 'x-router-ab-internal-service-auth';
const homeHeader = 'x-seams-wallet-home-region';
const executePath = '/router-ab/router/ed25519-yao/execute';
const hints = { US: 'enam', WEUR: 'weur', APAC: 'apac', OC: 'oc' };

class PlacementLog extends Log {
  messages = [];
  placements = [];
  commands = [];
  routerDispatches = [];
  routerTransport = [];
  storageReadiness = [];

  constructor() {
    super(LogLevel.INFO);
  }

  connect(stdout, stderr) {
    for (const stream of [stdout, stderr]) {
      createInterface({ input: stream }).on('line', this.log.bind(this));
    }
  }

  log(message) {
    this.messages.push(message);
    if (message.includes('[mf:err]') || message.includes('[mf:wrn]')) console.error(message);
    const start = message.indexOf('{');
    if (start < 0) return;
    try {
      const value = JSON.parse(message.slice(start));
      if (value.event === 'wallet_do_placement_requested') this.placements.push(value);
      if (value.event === 'wallet_do_command_timing') this.commands.push(value);
      if (value.event === 'router_wallet_dispatch_timing') this.routerDispatches.push(value);
      if (value.event === 'router_wallet_transport_timing') this.routerTransport.push(value);
      if (value.event === 'wallet_startup_storage_observation') {
        this.storageReadiness.push(value);
        if (!value.initialized) console.error(JSON.stringify(value));
      }
    } catch {
      // Other Worker diagnostics are not placement observations.
    }
  }
}

async function observeStartupStorage(worker, className, requiredTable) {
  const scriptPath = resolve(output, `${worker.name}-storage.mjs`);
  const source = `./${relative(output, worker.scriptPath).replaceAll('\\', '/')}`;
  await writeFile(
    scriptPath,
    `
import { ${className} as WalletObject } from ${JSON.stringify(source)};
export * from ${JSON.stringify(source)};
export { default } from ${JSON.stringify(source)};

export class ${className} extends WalletObject {
  constructor(state, env) {
    super(state, env);
    this.storageSql = state.storage.sql;
    this.startupChecked = false;
  }

  async fetch(request) {
    const response = await super.fetch(request);
    const startup = new URL(request.url).pathname === '/router-ab/internal/wallet/start';
    if (!startup || response.status !== 200 || this.startupChecked) return response;
    const tables = this.storageSql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).toArray();
    const initialized = tables.some(hasRequiredTable);
    let rows = 0;
    const names = [];
    for (const table of tables) {
      const identifier = table.name.replaceAll('"', '""');
      rows += this.storageSql.exec('SELECT count(*) AS total FROM "' + identifier + '"').one().total;
      names.push(table.name);
    }
    console.log(JSON.stringify({
      event: 'wallet_startup_storage_observation',
      role: ${JSON.stringify(worker.name)},
      tables: names,
      initialized,
      rows,
    }));
    if (!initialized) throw new Error('Wallet startup left storage uninitialized');
    if (rows !== 0) throw new Error('Wallet startup must not create authority or protocol records');
    this.startupChecked = true;
    return response;
  }
}

function hasRequiredTable(table) {
  return table.name === ${JSON.stringify(requiredTable)};
}
`,
  );
  return { ...worker, scriptPath };
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
    const preparesHere =
      this.role === 'deriver_a' ? path.endsWith('/execute-pair') : path.endsWith('/prepare-pair');
    if (preparesHere) {
      const preparation = await request.clone().json();
      assert.equal(preparation.tenant_root.wallet_route.home, this.home);
      const lookup = {
        wallet_route: preparation.tenant_root.wallet_route,
        ownership_generation: preparation.tenant_root.ownership_generation,
        root_identity: preparation.tenant_root.identity,
        pair_binding: preparation.pair_binding,
      };
      const status = await worker.fetch(
        `https://custody.test/router-ab/${this.worker}/ed25519-yao/read-pair-status`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [authHeader]: request.headers.get(authHeader),
          },
          body: JSON.stringify(lookup),
        },
      );
      assert.equal(status.status, 200, await status.clone().text());
      const result = await status.json();
      assert.equal(result.status, 'missing');
      this.observations.push({
        role: this.role,
        generation: lookup.ownership_generation,
        firstStatus: result.status,
      });
    }
    return worker.fetch(request);
  }
}

class WalletFixtureWorker {
  constructor(binding, identity, serviceCredential) {
    this.binding = binding;
    this.identity = identity;
    this.serviceCredential = serviceCredential;
  }
  async fetch(input, init) {
    const request = new Request(input, init);
    if (this.serviceCredential !== null) request.headers.set(authHeader, this.serviceCredential);
    for (const [name, value] of Object.entries(walletObjectIdentityHeaders(this.identity)))
      request.headers.set(name, value);
    return this.binding.fetch(request);
  }
}

class WalletFixtureTopology {
  constructor(topology, home, database, identity, gatewayCredential) {
    Object.assign(this, { topology, home, database, identity, gatewayCredential });
  }
  async getWorker(name) {
    const worker = new MiniflareWorkerBinding(await this.topology.getWorker(name));
    return new WalletFixtureWorker(
      new WalletHomeCustodyBinding(worker, this.home, this.database, 'placement'),
      this.identity,
      name === 'router' ? this.gatewayCredential : null,
    );
  }
}

class LostCompletedReply {
  completed = null;
  drop = true;
  firstExecutionMs = null;

  constructor(binding) {
    this.binding = binding;
  }

  async fetch(input, init) {
    const started = performance.now();
    const response = await this.binding.fetch(input, init);
    const body = await response.clone().text();
    assert.equal(response.status, 200, body);
    assert.equal(JSON.parse(body).status, 'succeeded', body);
    if (this.drop) {
      this.drop = false;
      this.firstExecutionMs = performance.now() - started;
      this.completed = body;
      throw new Error('Test discarded the completed Router reply');
    }
    assert.equal(body, this.completed, 'Retry must return the exact completed result');
    return response;
  }
}

function executeRequest(envelope, credential, home) {
  const headers = {
    'content-type': 'application/json',
    [authHeader]: credential,
    ...walletObjectIdentityHeaders(envelopeIdentity(envelope)),
  };
  if (home !== null) headers[homeHeader] = home;
  return new Request(`https://custody.test${executePath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(envelope),
  });
}

function startupRequest(envelope, credential, home) {
  const identity = envelope.tenant_root.identity;
  const headers = {
    'content-type': 'application/json',
    [authHeader]: credential,
    ...walletObjectIdentityHeaders(envelopeIdentity(envelope)),
  };
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

function envelopeIdentity(envelope) {
  return walletObjectIdentity(
    envelope.target.binding.lifecycle.account_id,
    envelope.target.ownership_generation,
    envelope.tenant_root.identity,
  );
}

async function settledAdmissions(database) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { results } = await database
      .prepare(
        "SELECT status, pair_object_id FROM tenant_root_root_use_admissions WHERE attempt_kind = 'ed25519_yao_pair_session'",
      )
      .all();
    assert.equal(results.length, 1, 'The ceremony must have exactly one admission per role');
    const admission = results[0];
    if (admission.status === 'settled') return admission;
    assert.equal(admission.status, 'admitted');
    await setTimeout(20);
  }
  assert.fail('The completed wallet object did not settle its admission');
}

async function postWallet(binding, envelope, credential, path, body) {
  const response = await binding.fetch(
    new Request(`https://custody.test${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [authHeader]: credential,
        ...walletObjectIdentityHeaders(envelopeIdentity(envelope)),
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

async function verifyFirstSignature(binding, envelope, result, fixture, credential) {
  const ceremony = envelope.target.binding;
  await postWallet(
    binding,
    envelope,
    credential,
    '/router-ab/router/ed25519-yao/registration/consume',
    {
      ownership_generation: envelope.target.ownership_generation,
      tenant_root: envelope.tenant_root,
      wallet_id: ceremony.lifecycle.account_id,
      lifecycle_id: ceremony.lifecycle.lifecycle_id,
      session_id: ceremony.session_id,
      consumer_binding: 'stored-address-registration-finalization',
    },
  );
  const activation = result.result.result;
  const signing = signingFixture(root, {
    command: 'prepare',
    activation,
    identity: envelope.tenant_root.identity,
    ownership_generation: envelope.target.ownership_generation,
    expires_at_ms: Date.now() + 120_000,
  });
  const request = { ...signing.prepare, authorized_operation: signing.authorized_operation };
  const prepareStarted = performance.now();
  const prepared = await postWallet(
    binding,
    envelope,
    credential,
    '/router-ab/ed25519/sign/prepare',
    request,
  );
  const prepareMs = performance.now() - prepareStarted;
  assert.deepEqual(
    await postWallet(binding, envelope, credential, '/router-ab/ed25519/sign/prepare', request),
    prepared,
  );
  const finalized = signingFixture(root, {
    command: 'finalize',
    activation,
    client_recipient_seed: fixture.activation.client_recipient_seed,
    prepare: signing.prepare,
    prepared,
    authorized_operation: signing.authorized_operation,
  });
  const signStarted = performance.now();
  const response = await postWallet(
    binding,
    envelope,
    credential,
    '/router-ab/ed25519/sign',
    finalized,
  );
  const signMs = performance.now() - signStarted;
  const signatureSha256Hex = verifySigningResponse(response, signing, activation);
  assert.deepEqual(
    await postWallet(binding, envelope, credential, '/router-ab/ed25519/sign', finalized),
    response,
  );
  return {
    signatureSha256Hex,
    prepareMs,
    signMs,
    signingHttpMs: prepareMs + signMs,
    signatureB64u: Buffer.from(response.signature.bytes).toString('base64url'),
    digestB64u: signing.signing_digest_b64u,
    publicKeyB64u: Buffer.from(activation.public_receipt.registered_public_key).toString(
      'base64url',
    ),
    independentlyVerified: true,
    prepareAndFinalizeReplay: true,
  };
}

async function verifyRegion(home, WalletHomeCustodyBinding) {
  const fixture = loadFixture();
  const jwtSigner = configureRouterJwt(fixture);
  const log = new PlacementLog();
  const a = new StatusBeforePreparation('deriver-a', 'deriver_a', home);
  const b = new StatusBeforePreparation('deriver-b', 'deriver_b', home);
  const router = routerWorker(fixture);
  router.d1Databases = { ...router.d1Databases, GATEWAY_DB: `gateway-${home}` };
  router.serviceBindings.DERIVER_A = a.fetch.bind(a);
  router.serviceBindings.DERIVER_B = b.fetch.bind(b);
  const roleWorkers = [
    await observeStartupStorage(
      deriverAWorker(fixture),
      'RouterAbDeriverAWalletDurableObject',
      'yao_pair_sessions',
    ),
    await observeStartupStorage(
      deriverBWorker(fixture),
      'RouterAbDeriverBWalletDurableObject',
      'yao_pair_sessions',
    ),
    await observeStartupStorage(
      signingWorker('fixture-signing-worker', 'placement-signing-worker', fixture),
      'RouterAbSigningWorkerWalletDurableObject',
      'wallet_registrations',
    ),
  ];
  const topology = new Miniflare({
    log,
    handleRuntimeStdio: log.connect.bind(log),
    workers: [router, ...roleWorkers, tenantRootControlPlaneWorker(fixture)],
  });
  try {
    await topology.ready;
    const migrationRoot = resolve(root, 'crates/router-ab-cloudflare/migrations');
    const databases = {
      deriverA: await applyMigrations(
        topology,
        'DERIVER_ROLE_PRIVATE_DB',
        'deriver-a',
        resolve(migrationRoot, 'deriver-a'),
      ),
      deriverB: await applyMigrations(
        topology,
        'DERIVER_ROLE_PRIVATE_DB',
        'deriver-b',
        resolve(migrationRoot, 'deriver-b'),
      ),
    };
    await applyMigrations(
      topology,
      'SIGNING_WORKER_PRIVATE_DB',
      'fixture-signing-worker',
      resolve(migrationRoot, 'signing-worker'),
    );
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
    for (const ownershipGeneration of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const malformed = startupRequest(envelope, credential, home);
      const body = await malformed.json();
      body.ownership_generation = ownershipGeneration;
      const rejected = await worker.fetch(
        new Request(malformed.url, {
          method: 'POST',
          headers: malformed.headers,
          body: JSON.stringify(body),
        }),
      );
      assert.equal(rejected.ok, false);
      await rejected.text();
    }
    assert.equal(log.placements.length, 0, 'Rejected requests must not touch wallet objects');

    const gateway = await applyMigrations(
      topology,
      'GATEWAY_DB',
      'router',
      resolve(output, 'migrations'),
    );
    const identity = envelopeIdentity(envelope);
    const store = new D1WalletObjectAddresses(gateway, { namespace: 'placement', ...identity });
    const addresses = await store.initialize(identity, worker, credential);
    const binding = new WalletHomeCustodyBinding(worker, home, gateway, 'placement');
    const lost = new LostCompletedReply(binding);
    const foreignHome = home === 'OC' ? 'WEUR' : 'OC';
    // Discard the startup reply. Execution must need neither its body nor a startup token.
    const startup = await binding.fetch(startupRequest(envelope, credential, foreignHome));
    assert.equal(startup.status, 200);
    assert.equal(log.storageReadiness.length, 3, 'Startup must initialize all three role stores');
    const immediate = await Promise.all([
      binding.fetch(startupRequest(envelope, credential, foreignHome)),
      assert.rejects(
        lost.fetch(executeRequest(envelope, credential, foreignHome)),
        /discarded the completed/,
      ),
    ]);
    assert.equal(immediate[0].status, 200);
    const firstPlacements = [...log.placements];
    const firstCommands = [...log.commands];
    const retried = await lost.fetch(executeRequest(envelope, credential, foreignHome));
    const result = await retried.json();
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(
      log.routerDispatches.map((event) => event.operation),
      ['claim_registration', 'finish_registration', 'claim_registration'],
      'Lost-reply replay must claim the stored answer without another finish',
    );
    for (const event of log.routerDispatches) {
      assert.equal(event.outcome, 'success');
      assert.equal(event.wallet_home, home);
      assert.ok(event.duration_ms >= 0);
    }
    assert.equal(
      log.placements.filter((event) => event.role !== 'router').length,
      firstPlacements.filter((event) => event.role !== 'router').length,
      'Completed Router replay must not rerun custody',
    );
    assert.equal(a.observations.length, 1);
    assert.equal(b.observations.length, 1);
    const bCommands = firstCommands.filter((command) => command.role === 'deriver_b');
    const routerCommands = firstCommands.filter((command) => command.role === 'router');
    assert.equal(routerCommands[0].path, '/router-ab/internal/wallet/start');
    assert.equal(routerCommands[0].first_command_after_constructor, true);
    assert.ok(
      routerCommands
        .filter((command) => command.path.endsWith('/command'))
        .every((command) => command.first_command_after_constructor === false),
      'Registration commands must reuse the live object reached by startup',
    );
    assert.equal(
      bCommands.filter((command) => command.path.endsWith('/ed25519-yao/duplex')).length,
      1,
      'B must execute the pair WebSocket in its wallet object',
    );
    assert.equal(
      bCommands.filter((command) => command.path.endsWith('/wallet-pair')).length,
      2,
      'Only status and preparation may cross the B session-command boundary',
    );
    const roleObjects = {};
    for (const role of ['router', 'deriver_a', 'deriver_b', 'signing_worker']) {
      const events = firstPlacements.filter((event) => event.role === role);
      assert.ok(events.length > 0, `Missing placement evidence for ${role}`);
      for (const event of events) {
        assert.equal(event.wallet_home, home);
        assert.equal(event.location_hint, hints[home]);
      }
      const objects = [...new Set(events.map((event) => event.object_id))];
      assert.equal(
        objects[0],
        addresses[role],
        'Each role uses its persisted namespace-issued address',
      );
      assert.equal(objects.length, 1, `${role} must reuse the exact wallet object`);
      const commands = firstCommands.filter((command) => command.role === role);
      assert.equal(commands[0].path, '/router-ab/internal/wallet/start');
      assert.equal(commands[0].first_command_after_constructor, true);
      assert.ok(
        commands
          .filter((command) => command.path !== '/router-ab/internal/wallet/start')
          .every((command) => command.first_command_after_constructor === false),
        `${role} must execute in the live object reached by startup`,
      );
      roleObjects[role] = {
        objectId: objects[0],
        calls: events.length,
        hint: hints[home],
        commands,
      };
    }
    const admissions = {
      deriverA: await settledAdmissions(databases.deriverA),
      deriverB: await settledAdmissions(databases.deriverB),
    };
    for (const [role, admission] of [
      ['deriver_a', admissions.deriverA],
      ['deriver_b', admissions.deriverB],
    ]) {
      const binding = role === 'deriver_a' ? 'DERIVER_A_WALLET_DO' : 'DERIVER_B_WALLET_DO';
      const namespace = await topology.getDurableObjectNamespace(binding, role.replace('_', '-'));
      assert.equal(
        namespace.idFromString(admission.pair_object_id).toString(),
        roleObjects[role].objectId,
      );
    }
    const signing = await verifyFirstSignature(binding, envelope, result, fixture, credential);
    const scopedTopology = new WalletFixtureTopology(topology, home, gateway, identity, credential);
    const ecdsa = await testEcdsaRegistrationAndActivation(
      scopedTopology,
      fixture,
      tenantRoot,
      jwtSigner,
      `stored-id-${home}`,
      identity.walletId,
      identity.envId,
    );
    const signedEcdsa = await testEcdsaNormalSigning(scopedTopology, ecdsa, 'pool', false);
    const ecdsaSigning = {
      independentlyVerified: true,
      signatureB64u: signedEcdsa.response.signature65_b64u,
      digestB64u: signedEcdsa.finalizeRequest.signing_digest_b64u,
      publicKeyB64u: ecdsa.identity.threshold_public_key33_b64u,
      signatureSha256Hex: createHash('sha256')
        .update(Buffer.from(signedEcdsa.response.signature65_b64u, 'base64url'))
        .digest('hex'),
    };
    const destinationIdentity = walletObjectIdentity(
      identity.walletId,
      identity.ownershipGeneration + 1,
      identity,
    );
    const destinationAddresses = await store.initialize(destinationIdentity, worker, credential);
    const relocation = await verifyDestinationPreparation({
      runtime: handleWalletRelocationRequest,
      store,
      identity,
      sourceAddresses: addresses,
      destinationAddresses,
      env: {
        MPC_ROUTER: binding,
        DERIVER_A: new WalletHomeCustodyBinding(
          new MiniflareWorkerBinding(await topology.getWorker('deriver-a')),
          home,
          gateway,
          'placement',
        ),
        DERIVER_B: new WalletHomeCustodyBinding(
          new MiniflareWorkerBinding(await topology.getWorker('deriver-b')),
          home,
          gateway,
          'placement',
        ),
        ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET:
          roleWorkers[0].bindings.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET,
        ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: credential,
      },
    });
    return {
      home,
      generation,
      addresses,
      signing,
      ecdsaSigning,
      relocation,
      admissions,
      roleObjects,
      routerDispatches: log.routerDispatches,
      routerTransport: log.routerTransport,
      routerCommands,
      routerExecuteHttpMs: lost.firstExecutionMs,
      lostStartupReplyAndImmediateExecution: true,
      firstStatusLookups: [...a.observations, ...b.observations],
      invalidHomeRejectedBeforePlacement: true,
      unauthorizedHomeRejected: true,
      callerHomeOverwritten: true,
      completedReplyLossReplayedExactly: true,
      replayRanNoAdditionalCustody: true,
      bProtocolRunsInWalletObject: true,
      bRemoteBeginAndCompleteCalls: 0,
      startupStorageReadiness: log.storageReadiness,
    };
  } finally {
    await writeFile(resolve(output, `runtime-${home}.log`), log.messages.join('\n') + '\n');
    await topology.dispose();
  }
}

await mkdir(resolve(output, 'migrations'), { recursive: true });
await copyFile(
  resolve(root, 'packages/wallet-server/migrations/d1-signer/0077_wallet_object_addresses.sql'),
  resolve(output, 'migrations/0077_wallet_object_addresses.sql'),
);
const bindingModule = resolve(output, 'binding.mjs');
await build({
  stdin: {
    contents: `
    export { WalletHomeCustodyBinding } from './packages/wallet-server/src/router/cloudflare/runtime/routerAbServiceBindings';
    export { walletObjectIdentity, walletObjectIdentityHeaders } from './packages/wallet-server/src/router/cloudflare/runtime/walletObjectAddresses';
    export { handleWalletRelocationRequest } from './packages/wallet-server/src/router/cloudflare/runtime/walletRelocationOps';
    export { D1WalletObjectAddresses } from './packages/wallet-server/src/router/cloudflare/d1/walletObjectAddresses';
  `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bindingModule,
});
const {
  WalletHomeCustodyBinding,
  walletObjectIdentity,
  walletObjectIdentityHeaders,
  D1WalletObjectAddresses,
  handleWalletRelocationRequest,
} = await import(pathToFileURL(bindingModule).href);
const regions = [];
for (const home of Object.keys(hints))
  regions.push(await verifyRegion(home, WalletHomeCustodyBinding));
const artifact = {
  kind: 'authenticated_wallet_home_placement_e2e_v1',
  regions,
  limitation:
    'Local Workers verify the requested hints and real custody lifecycle. They do not prove physical Cloudflare locations or hosted latency gains.',
  reproduce:
    'ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/wallet-home-placement-evidence.mjs',
};
await writeFile(resolve(output, 'evidence.json'), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify(artifact));
