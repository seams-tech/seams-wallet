// Verify registration address allocation, replay, races, and lost replies through the assembled service and D1.
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';

class AddressAllocator {
  calls = 0;
  loseNextReply = false;
  onRequest = null;
  constructor(router, a, b, signer) {
    this.namespaces = { router, deriver_a: a, deriver_b: b, signing_worker: signer };
  }
  nextRequest() {
    return new Promise((resolve) => {
      this.onRequest = resolve;
    });
  }
  async allocate() {
    const entries = [];
    for (const [role, namespace] of Object.entries(this.namespaces))
      entries.push([role, namespace.newUniqueId().toString()]);
    return Object.fromEntries(entries);
  }
  async fetch() {
    this.calls += 1;
    this.onRequest?.();
    this.onRequest = null;
    const addresses = await this.allocate();
    if (this.loseNextReply) {
      this.loseNextReply = false;
      throw new Error('Lost allocation reply');
    }
    return Response.json(addresses);
  }
}

class RegistrationAddresses {
  constructor(api, store, allocator) {
    this.api = api;
    this.store = store;
    this.allocator = allocator;
  }
  async initialize(registration) {
    const identity = this.api.walletObjectIdentity(
      registration.walletId,
      registration.ownershipGeneration,
      scope,
    );
    await this.store.initialize(identity, this.allocator, 'local-test-credential');
  }
}

// Counts the ceremony writes that reach the database and can hold one until a signal.
class ObservedDatabase {
  ceremonyWrites = 0;
  addressReads = 0;
  holdCeremonyWrite = null;
  constructor(database) {
    this.database = database;
  }
  prepare(sql) {
    return new ObservedStatement(this, this.database.prepare(sql), sql);
  }
  async batch(statements) {
    await this.observe(statements.map(statementSql).join('\n'));
    return this.database.batch(statements.map(originalStatement));
  }
  exec(sql) {
    return this.database.exec(sql);
  }
  async observe(sql) {
    if (sql.includes('SELECT router, deriver_a, deriver_b, signing_worker')) this.addressReads += 1;
    if (!sql.includes('INSERT OR IGNORE INTO registration_ceremony_records')) return;
    this.ceremonyWrites += 1;
    await this.holdCeremonyWrite;
  }
}

class ObservedStatement {
  constructor(owner, original, sql) {
    Object.assign(this, { owner, original, sql });
  }
  bind(...values) {
    return new ObservedStatement(this.owner, this.original.bind(...values), this.sql);
  }
  async first(...column) {
    await this.owner.observe(this.sql);
    return this.original.first(...column);
  }
  async all() {
    await this.owner.observe(this.sql);
    return this.original.all();
  }
  async run() {
    await this.owner.observe(this.sql);
    return this.original.run();
  }
}

function statementSql(statement) {
  return statement.sql;
}

function originalStatement(statement) {
  return statement.original;
}

class CapturedCustodyCall {
  request = null;
  async fetch(request) {
    this.request = request;
    return new Response('ok');
  }
}

async function insertCandidate(store, identity, candidate) {
  const { WalletObjectAddresses } = await import(pathToFileURL(bundlePath));
  return store.insert(identity, WalletObjectAddresses.parse(candidate));
}

const output = resolve('.artifacts/registration-setup-startup');
const scope = { namespace: 'setup-startup', orgId: 'org', projectId: 'project', envId: 'test' };
await mkdir(output, { recursive: true });
const bundle = await build({
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['*.wasm', 'bs58'],
  tsconfig: 'packages/wallet-server/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      export { D1WalletObjectAddresses } from './packages/wallet-server/src/router/cloudflare/d1/walletObjectAddresses';
      export { WalletHomeCustodyBinding } from './packages/wallet-server/src/router/cloudflare/runtime/routerAbServiceBindings';
      export { WalletObjectAddresses, WalletObjectAddressSnapshot, walletObjectIdentity, walletObjectIdentityHeaders } from './packages/wallet-server/src/router/cloudflare/runtime/walletObjectAddresses';
      export { createCloudflareD1RouterApiAuthService } from './packages/wallet-server/src/router/cloudflare/d1/auth/d1RouterApiAuthService';
      export { LocalRegistrationSetupAuthority } from './packages/wallet-server/src/localRegistrationSetupAuthority';
      export { createRegistrationSetupOperationId } from './packages/shared-ts/src/utils/registrationSetupOperation';
      export { implicitNearAccountProvisioning, REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION } from './packages/shared-ts/src/utils/registrationSignerPlan';
      export { THRESHOLD_ED25519_2P_PARTICIPANT_IDS } from './packages/shared-ts/src/threshold/participants';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const runtime = new Miniflare({
  modules: true,
  script: `export class WalletObject { fetch() { return new Response('unused'); } }
    export default { fetch() { return new Response('registration setup'); } };`,
  durableObjects: {
    ROUTER: 'WalletObject',
    A: 'WalletObject',
    B: 'WalletObject',
    SIGNER: 'WalletObject',
  },
  d1Databases: ['SIGNER_DB'],
  compatibilityDate: '2026-06-12',
  port: 0,
});
try {
  const database = await runtime.getD1Database('SIGNER_DB');
  await migrate(database);
  const allocator = new AddressAllocator(
    await runtime.getDurableObjectNamespace('ROUTER'),
    await runtime.getDurableObjectNamespace('A'),
    await runtime.getDurableObjectNamespace('B'),
    await runtime.getDurableObjectNamespace('SIGNER'),
  );
  const addresses = new api.D1WalletObjectAddresses(database, scope);
  const starter = new RegistrationAddresses(api, addresses, allocator);
  const options = {
    database,
    ...scope,
    registrationAuthority: new api.LocalRegistrationSetupAuthority(database, scope),
  };
  const registration = api.createCloudflareD1RouterApiAuthService({
    ...options,
    startRegistrationWallets: starter.initialize.bind(starter),
  }).walletRegistration;
  const runtimePolicyScope = {
    orgId: scope.orgId,
    projectId: scope.projectId,
    envId: scope.envId,
    signingRootVersion: 'default',
  };
  const input = {
    request: {
      registrationOperationId: api.createRegistrationSetupOperationId(),
      signerSelection: {
        kind: 'signer_set',
        signers: [
          {
            kind: 'near_ed25519',
            accountProvisioning: api.implicitNearAccountProvisioning(),
            signerSlot: 1,
            participantIds: [...api.THRESHOLD_ED25519_2P_PARTICIPANT_IDS],
            derivationVersion: api.REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION,
          },
        ],
      },
      authMethod: { kind: 'passkey', rpId: 'wallet.example.test' },
    },
    orgId: scope.orgId,
    expectedOrigin: 'https://app.example.test',
    signer: { signJwt },
    runtimePolicyScope,
    signingRootId: `${scope.projectId}:${scope.envId}`,
    signingRootVersion: runtimePolicyScope.signingRootVersion,
  };

  const first = await setup(registration, input);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.kind, 'near_ed25519');
  // The local authority never relocates a wallet, so the reserved generation is the first.
  assert.equal(allocator.calls, 1);
  const identity = api.walletObjectIdentity(first.walletId, 1, scope);
  const saved = await addresses.read(identity);
  assert.ok(saved);

  const replay = await setup(registration, input);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.registrationCeremonyId, first.registrationCeremonyId);
  assert.equal(allocator.calls, 1, 'A replayed setup must use its saved addresses');
  assert.deepEqual(await addresses.read(identity), saved);

  const other = await setup(registration, {
    ...input,
    request: {
      ...input.request,
      registrationOperationId: api.createRegistrationSetupOperationId(),
    },
  });
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.notEqual(other.walletId, first.walletId);
  assert.equal(allocator.calls, 2);
  assert.notDeepEqual(
    await addresses.read(api.walletObjectIdentity(other.walletId, 1, scope)),
    saved,
  );

  // Startup is optional: a host with no starter still completes setup.
  const unstarted = await setup(
    api.createCloudflareD1RouterApiAuthService(options).walletRegistration,
    {
      ...input,
      request: {
        ...input.request,
        registrationOperationId: api.createRegistrationSetupOperationId(),
      },
    },
  );
  assert.equal(unstarted.ok, true, JSON.stringify(unstarted));
  assert.equal(allocator.calls, 2);
  // A new setup stores its snapshot and opens its ceremony in one write. It
  // asks for addresses beside that write: the write here waits for the request.
  const observed = new ObservedDatabase(database);
  const observedRegistration = api.createCloudflareD1RouterApiAuthService({
    ...options,
    database: observed,
    startRegistrationWallets: starter.initialize.bind(starter),
  }).walletRegistration;
  observed.holdCeremonyWrite = allocator.nextRequest();
  const beside = await within(
    setup(observedRegistration, {
      ...input,
      request: {
        ...input.request,
        registrationOperationId: api.createRegistrationSetupOperationId(),
      },
    }),
    10_000,
    'Setup must request addresses beside its ceremony write',
  );
  assert.equal(beside.ok, true, JSON.stringify(beside));
  assert.equal(observed.ceremonyWrites, 1, 'Setup must store its snapshot and ceremony together');
  assert.ok(await addresses.read(api.walletObjectIdentity(beside.walletId, 1, scope)));

  const lostInput = {
    ...input,
    request: {
      ...input.request,
      registrationOperationId: api.createRegistrationSetupOperationId(),
    },
  };
  allocator.loseNextReply = true;
  const lost = await registration.setupWalletRegistration(lostInput);
  assert.equal(lost.body.ok, false, 'Setup must fail when no address set was persisted');
  const recovered = await setup(registration, lostInput);
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.ok(await addresses.read(api.walletObjectIdentity(recovered.walletId, 1, scope)));

  // Eight arrivals at an unallocated destination generation retain one winner.
  const destination = api.walletObjectIdentity(first.walletId, 2, scope);
  const candidates = await Promise.all(
    Array.from({ length: 8 }, allocator.allocate.bind(allocator)),
  );
  const winners = await Promise.all(
    candidates.map(insertCandidate.bind(null, addresses, destination)),
  );
  for (const winner of winners) assert.deepEqual(winner, winners[0]);
  assert.notDeepEqual(winners[0], saved);
  assert.deepEqual(
    await addresses.read(identity),
    saved,
    'Destination allocation must not change source addresses',
  );

  const capture = new CapturedCustodyCall();
  const snapshot = api.WalletObjectAddressSnapshot.parse({
    ...saved.toJSON(), wallet_id: identity.walletId, ownership_generation: identity.ownershipGeneration,
  }, scope.namespace, scope);
  const forwardedDatabase = new ObservedDatabase(database);
  const binding = new api.WalletHomeCustodyBinding(capture, 'APAC', forwardedDatabase, scope.namespace, snapshot);
  const headers = api.walletObjectIdentityHeaders(identity);
  headers['x-seams-wallet-object-addresses'] = 'untrusted';
  headers['x-seams-wallet-home-region'] = 'US';
  await binding.fetch('https://custody.test/sign', { headers });
  assert.equal(capture.request.headers.get('x-seams-wallet-home-region'), 'APAC');
  assert.deepEqual(
    JSON.parse(capture.request.headers.get('x-seams-wallet-object-addresses')),
    saved.toJSON(),
  );
  assert.equal(capture.request.headers.get('x-seams-wallet-object-identity'), null);
  assert.equal(forwardedDatabase.addressReads, 0, 'An exact snapshot must avoid an address read');
  await binding.fetch('https://custody.test/sign', {
    headers: api.walletObjectIdentityHeaders(destination),
  });
  assert.deepEqual(
    JSON.parse(capture.request.headers.get('x-seams-wallet-object-addresses')),
    winners[0].toJSON(),
  );
  assert.equal(forwardedDatabase.addressReads, 1, 'A different generation needs its own read');
  await assert.rejects(
    binding.fetch('https://custody.test/sign', {
      headers: api.walletObjectIdentityHeaders(api.walletObjectIdentity(first.walletId, 3, scope)),
    }),
    /not initialized/,
  );
  await assert.rejects(
    binding.fetch('https://custody.test/sign', {
      headers: api.walletObjectIdentityHeaders(
        api.walletObjectIdentity(first.walletId, 1, { ...scope, projectId: 'another-project' }),
      ),
    }),
    /not initialized/,
  );
  await assert.rejects(
    database
      .prepare('UPDATE wallet_object_addresses SET router = ? WHERE wallet_id = ?')
      .bind(candidates[0].router, first.walletId)
      .run(),
    /immutable/,
  );

  await writeFile(
    resolve(output, 'result.json'),
    `${JSON.stringify(
      {
        replayUsesStoredAddresses: true,
        independentWallets: true,
        lostAllocationReplyRecovered: true,
        concurrentAllocations: candidates.length,
        persistedWinners: 1,
        distinctDestinationGeneration: true,
        forwardedStoredAddresses: true,
        exactSnapshotAvoidsRead: true,
        changedGenerationReadsDestination: true,
        forgedAddressesReplaced: true,
        missingGenerationRefused: true,
        wrongTenantRefused: true,
        immutableAddresses: true,
        hostWithoutStarterCompletes: true,
        ceremonyWritesPerSetup: observed.ceremonyWrites,
        allocationBesideCeremonyWrite: true,
      },
      null,
      2,
    )}\n`,
  );
  console.log('registration setup stored addresses: passed');
} finally {
  await runtime.dispose();
}

async function setup(registration, input) {
  const response = await registration.setupWalletRegistration(input);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function within(work, limitMs, message) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(reject, limitMs, new Error(message));
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function signJwt(sub, extra) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub, ...extra })}.${encode('fixture')}`;
}

async function migrate(database) {
  const directory = 'packages/wallet-server/migrations/d1-signer';
  for (const name of (await readdir(directory)).filter(isSql).sort()) {
    let sql = await readFile(`${directory}/${name}`, 'utf8');
    if (name === '0028_r103f_phase1_additive_schema_bridge.sql') {
      sql = buildWorkerdCompatiblePhase1Bridge(sql);
    }
    const statements = [];
    for (const query of unstable_splitSqlQuery(sql)) statements.push(database.prepare(query));
    await database.batch(statements);
  }
}

function isSql(name) {
  return name.endsWith('.sql');
}
