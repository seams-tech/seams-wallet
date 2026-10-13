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
  writeFault = { kind: 'none', remaining: 0 };
  addressReads = 0;
  holdCeremonyRead = null;
  holdCeremonyWrite = null;
  constructor(database) {
    this.database = database;
  }
  prepare(sql) {
    return new ObservedStatement(this, this.database.prepare(sql), sql);
  }
  async batch(statements) {
    const sql = statements.map(statementSql).join('\n');
    await this.observe(sql);
    const fault = this.writeFault;
    const inject =
      sql.includes('INSERT OR IGNORE INTO registration_ceremony_records') && fault.remaining > 0;
    if (inject) fault.remaining -= 1;
    if (inject && fault.kind === 'lost_request') {
      throw new Error('D1_ERROR: Network connection lost.');
    }
    const result = await this.database.batch(statements.map(originalStatement));
    if (inject && fault.kind === 'lost_reply') {
      throw new Error('D1_ERROR: Network connection lost.');
    }
    return result;
  }
  exec(sql) {
    return this.database.exec(sql);
  }
  async observe(sql) {
    if (sql.includes('SELECT router, deriver_a, deriver_b, signing_worker')) this.addressReads += 1;
    if (sql.trimStart().startsWith('SELECT version, record_json, expires_at_ms')) {
      await this.holdCeremonyRead;
    }
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
      export { D1WalletExecutionAuthority } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
      export { createRegistrationSetupOperationId } from './packages/shared-ts/src/utils/registrationSetupOperation';
      export { implicitNearAccountProvisioning, REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION } from './packages/shared-ts/src/utils/registrationSignerPlan';
      export { THRESHOLD_ED25519_2P_PARTICIPANT_IDS } from './packages/shared-ts/src/threshold/participants';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));

class ObservedRegistrationAuthority extends api.LocalRegistrationSetupAuthority {
  continuationReads = 0;
  reservation = null;
  completionUnavailable = false;

  async reserve(input) {
    const result = await super.reserve(input);
    if (result.ok) this.reservation = result.reservation;
    return result;
  }

  async admitHome() {
    this.continuationReads += 1;
    throw new Error('Registration continuation must use the home saved by setup');
  }

  async complete(input) {
    if (this.completionUnavailable) throw new Error('Registration directory unavailable');
    return super.complete(input);
  }
}

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
    registrationAuthority: new ObservedRegistrationAuthority(database, scope),
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
  const execution = new api.D1WalletExecutionAuthority(database, scope, options.registrationAuthority);
  const registrationIdentity = { walletId: first.walletId, ceremonyId: first.registrationCeremonyId };
  assert.deepEqual(await execution.admitHome(registrationIdentity), {
    ok: true,
    purpose: 'registration',
    ownershipGeneration: 1,
  });
  assert.equal((await execution.admitEstablishedHome({ walletId: first.walletId })).ok, false);
  const unknown = await execution.admitHome({
    walletId: first.walletId,
    ceremonyId: 'unknown-ceremony',
  });
  assert.equal(unknown.ok, false);
  assert.equal(options.registrationAuthority.continuationReads, 0);
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
  // Address allocation must proceed even while the ceremony read is blocked.
  // The same setup still stores its snapshot, ceremony, and home in one write.
  const observed = new ObservedDatabase(database);
  const observedRegistration = api.createCloudflareD1RouterApiAuthService({
    ...options,
    database: observed,
    startRegistrationWallets: starter.initialize.bind(starter),
  }).walletRegistration;
  observed.holdCeremonyRead = allocator.nextRequest();
  observed.holdCeremonyWrite = observed.holdCeremonyRead;
  const beside = await within(
    setup(observedRegistration, {
      ...input,
      request: {
        ...input.request,
        registrationOperationId: api.createRegistrationSetupOperationId(),
      },
    }),
    10_000,
    'Setup must request addresses while its ceremony read is still pending',
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
  const lostReservation = options.registrationAuthority.reservation;
  const savedBeforeReply = await database
    .prepare(
      `SELECT count(*) AS count FROM registration_ceremony_records
      WHERE record_scope IN ('setup-ceremony', 'ceremony')
        AND json_extract(record_json, '$.registrationCeremonyId') = ?`,
    )
    .bind(lostReservation.ceremonyId)
    .first();
  assert.equal(
    savedBeforeReply.count,
    2,
    'Setup must settle its writes before reporting allocation failure',
  );
  const recovered = await setup(registration, lostInput);
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.ok(await addresses.read(api.walletObjectIdentity(recovered.walletId, 1, scope)));

  // A home write failure must roll back both ceremony records. An exact retry
  // can then commit all three records without changing its reserved identity.
  const interruptedInput = {
    ...input,
    request: {
      ...input.request,
      registrationOperationId: api.createRegistrationSetupOperationId(),
    },
  };
  await database
    .prepare(`CREATE TRIGGER refuse_registration_home
    BEFORE INSERT ON wallet_execution_generations
    BEGIN SELECT RAISE(ABORT, 'injected_home_write_failure'); END`)
    .run();
  const interrupted = await registration.setupWalletRegistration(interruptedInput);
  assert.equal(interrupted.body.ok, false);
  const interruptedReservation = options.registrationAuthority.reservation;
  assert.ok(interruptedReservation);
  const snapshots = await database
    .prepare(`SELECT count(*) AS count
    FROM registration_ceremony_records
    WHERE record_scope IN ('setup-ceremony', 'ceremony')
      AND json_extract(record_json, '$.registrationCeremonyId') = ?`)
    .bind(interruptedReservation.ceremonyId)
    .first();
  assert.equal(snapshots.count, 0, 'A refused home write must roll back both ceremony records');
  await database.prepare('DROP TRIGGER refuse_registration_home').run();
  const retried = await setup(registration, interruptedInput);
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.walletId, interruptedReservation.walletId);
  assert.equal(retried.registrationCeremonyId, interruptedReservation.ceremonyId);
  const retryIdentity = { walletId: retried.walletId, ceremonyId: retried.registrationCeremonyId };
  assert.equal((await execution.admitHome(retryIdentity)).ok, true);
  options.registrationAuthority.completionUnavailable = true;
  await assert.rejects(execution.cancel(retryIdentity), /Registration directory unavailable/);
  assert.equal(
    (await registration.setupWalletRegistration(interruptedInput)).body.ok,
    false,
    'Setup must refuse a local cancellation even while the directory still reports reserved',
  );
  options.registrationAuthority.completionUnavailable = false;
  assert.equal((await execution.cancel(retryIdentity)).ok, true);
  assert.equal((await execution.admitHome(retryIdentity)).ok, false);
  assert.equal((await registration.setupWalletRegistration(interruptedInput)).body.ok, false);
  const retired = await database
    .prepare(`SELECT state, registration_completion
    FROM wallet_execution_generations WHERE wallet_id = ?`)
    .bind(retried.walletId)
    .first();
  assert.deepEqual(retired, { state: 'retired', registration_completion: 'cancelled' });
  assert.equal(options.registrationAuthority.continuationReads, 0);

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

  const setupRecovery = await verifySetupRecovery(database, options, starter, addresses, input);

  await writeFile(
    resolve(output, 'result.json'),
    `${JSON.stringify(
      {
        setupRecovery,
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
        allocationOverlapsCeremonyRead: true,
        allocationBesideCeremonyWrite: true,
        ceremonySettledBeforeAllocationFailureReply: true,
        setupCommitsRegistrationHome: true,
        continuationDirectoryReads: options.registrationAuthority.continuationReads,
        unknownCeremonyRefusedLocally: true,
        homeFailureRollsBackCeremony: true,
        cancelledSetupCannotReopen: true,
        cancellationSurvivesUnavailableDirectory: true,
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

// Fault only the Gateway ceremony batch. The reservation authority stays reachable.
async function verifySetupRecovery(database, options, starter, addresses, input) {
  const evidence = [];
  for (const kind of ['lost_request', 'lost_reply', 'exhausted', 'exhausted_reply']) {
    const observed = new ObservedDatabase(database);
    const exhausted = kind === 'exhausted' || kind === 'exhausted_reply';
    observed.writeFault = {
      kind: kind === 'lost_reply' || kind === 'exhausted_reply' ? 'lost_reply' : 'lost_request',
      remaining: exhausted ? 3 : 1,
    };
    const registration = api.createCloudflareD1RouterApiAuthService({
      ...options,
      database: observed,
      startRegistrationWallets: starter.initialize.bind(starter),
    }).walletRegistration;
    const request = {
      ...input,
      request: {
        ...input.request,
        registrationOperationId: api.createRegistrationSetupOperationId(),
      },
    };
    const response = await registration.setupWalletRegistration(request);
    const reservation = options.registrationAuthority.reservation;
    assert.ok(reservation);
    const attempts = observed.ceremonyWrites;
    assert.equal(attempts, exhausted ? 3 : 2);
    if (exhausted) {
      assert.equal(response.status, 503);
      assert.deepEqual(response.body, {
        ok: false,
        code: 'storage_unavailable',
        message: 'Wallet registration setup is temporarily unavailable. Try again.',
      });
    } else {
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.walletId, reservation.walletId);
    }
    // Retry the original request, including when the successful setup reply was lost.
    const before = await addresses.read(api.walletObjectIdentity(reservation.walletId, 1, scope));
    const recovered = await setup(registration, request);
    assert.equal(recovered.walletId, reservation.walletId);
    assert.equal(recovered.registrationCeremonyId, reservation.ceremonyId);
    const saved = await addresses.read(api.walletObjectIdentity(recovered.walletId, 1, scope));
    assert.ok(saved);
    assert.deepEqual(saved, before, 'Recovery must retain the first persisted address set');
    const records = await database.prepare(`SELECT record_scope, count(*) AS count
      FROM registration_ceremony_records
      WHERE json_extract(record_json, '$.registrationCeremonyId') = ?
      GROUP BY record_scope`).bind(reservation.ceremonyId).all();
    const ceremonies = records.results.filter(isCeremonyRecord);
    assert.equal(ceremonies.length, 2);
    for (const record of ceremonies) assert.equal(record.count, 1);
    const homes = await database
      .prepare('SELECT count(*) AS count FROM wallet_execution_generations WHERE wallet_id = ?')
      .bind(reservation.walletId)
      .first();
    assert.equal(homes.count, 1);
    const reservations = await database.prepare(`SELECT count(*) AS count FROM registration_ceremony_records
      WHERE record_scope = 'setup-reservation'
        AND json_extract(record_json, '$.reservation.walletId') = ?`).bind(reservation.walletId).first();
    assert.equal(reservations.count, 1);
    evidence.push({
      kind,
      attempts,
      status: response.status,
      stableIdentityAndAddresses: true,
      ceremonyRecords: ceremonies.length,
      homeRecords: homes.count,
      reservationRecords: reservations.count,
    });
  }
  return evidence;
}

function isCeremonyRecord(record) {
  return record.record_scope === 'ceremony' || record.record_scope === 'setup-ceremony';
}
