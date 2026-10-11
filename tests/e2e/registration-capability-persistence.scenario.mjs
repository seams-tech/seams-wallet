import assert from 'node:assert/strict';

// Let another real D1 writer commit after this request reads its shared version.
class ConcurrentCapabilityStore {
  commits = 0;

  constructor(store, beforeCommit) {
    this.store = store;
    this.beforeCommit = beforeCommit;
  }

  loadCapabilities() {
    return this.store.loadCapabilities();
  }

  async commitCapabilities(snapshot, mutation, companionWrite) {
    this.commits += 1;
    if (this.commits === 1) await this.beforeCommit();
    return this.store.commitCapabilities(snapshot, mutation, companionWrite);
  }
}

function runtime(api, store) {
  return api.createRouterAbEd25519YaoProductRegistrationRequestScopedRuntimeV1({
    signingWorkerId: 'worker',
    store,
    registrationBackend: {
      admitRegistration: unexpectedRegistration,
      executeRegistration: unexpectedRegistration,
      resolveRegistrationDispatchRoot: unexpectedRegistration,
    },
  });
}

function unexpectedRegistration() {
  throw new Error('Capability persistence cannot start registration');
}

function lookup(fixture) {
  return {
    kind: 'router_ab_ed25519_yao_active_capability_lookup_v1',
    walletId: fixture.intent.walletId,
    nearEd25519SigningKeyId: fixture.admission.application_binding.near_ed25519_signing_key_id,
    signerSlot: 1,
    signingWorkerId: 'worker',
    participantIds: [1, 2],
  };
}

async function sharedReplay(store, lifecycleId) {
  const loaded = await store.load(lifecycleId);
  return {
    sessions: [...loaded.state.recovery.recoverySessions],
    nonces: [...loaded.state.export.authorizationNonceOwners],
    uncertain: [...loaded.state.export.authorizationUncertainOwners],
  };
}

async function suspendCapability(store, cache) {
  const snapshot = await store.loadCapabilities();
  const capabilities = new Map(snapshot.value.recoveryCapabilities);
  for (const [key, capability] of cache.capabilities) capabilities.set(key, capability);
  const result = await store.commitCapabilities(
    snapshot,
    {
      capabilities,
      identityCapabilities: new Map(snapshot.value.recoveryIdentityCapabilities),
    },
    null,
  );
  assert.equal(result.kind, 'stored');
}

function trace(database) {
  const header = database.response(new Response()).headers.get('X-Benchmark-D1');
  const recorded = JSON.parse(header);
  assert.equal(recorded.pending, 0);
  assert.equal(recorded.dropped, 0);
  return recorded.calls;
}

export async function verifyCapabilityPersistence({ api, database, scope }) {
  const fixture = await api.buildNearRegistrationAuthorityFixture('capability-persistence');
  const other = await api.buildNearRegistrationAuthorityFixture('capability-concurrent');
  const active = api.buildNearRecoveryCacheFixture(fixture.admission, 'active');
  const otherActive = api.buildNearRecoveryCacheFixture(other.admission, 'active');
  const persisted = active.capabilities.values().next().value.identity.persisted;
  const otherPersisted = otherActive.capabilities.values().next().value.identity.persisted;
  const store = api.createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
    database,
    scope,
  });
  const lifecycleId = fixture.admission.scope.lifecycle_id;
  const original = await store.load(lifecycleId);
  original.state.authorization.authorities.push(...fixture.state.authorities);
  original.state.recovery.recoverySessions.set(
    'ab'.repeat(32),
    JSON.stringify(api.buildNearRecoveryAdmissionFixture(fixture.admission)),
  );
  original.state.export.authorizationNonceOwners.set('capability-nonce', fixture.intent.walletId);
  original.state.export.authorizationUncertainOwners.set(
    'capability-uncertain',
    fixture.intent.walletId,
  );
  assert.equal(
    (
      await store.commit({
        lifecycleId,
        state: original.state,
        baseline: original.baseline,
        companionWrite: null,
      })
    ).kind,
    'stored',
  );
  const ceremony = await store.loadRegistration(lifecycleId);
  const replay = await sharedReplay(store, lifecycleId);

  const traced = new api.TracedD1Database(database);
  const observedStore =
    api.createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
      database: traced,
      scope,
    });
  const installer = runtime(api, observedStore);
  const installed = await installer.installPersistedActiveCapability(persisted);
  assert.equal(installed.ok, true);
  assert.equal(installed.disposition, 'installed');
  const freshCalls = trace(traced);
  assert.equal(freshCalls.length, 2);
  const readStatements = freshCalls[0].statements;
  assert.equal(readStatements.length, 1, 'Capability installation reads only its shared record');
  const recordWrites = freshCalls[1].statements.filter(isRecordWrite);
  assert.equal(recordWrites.length, 1, 'Capability installation writes only its shared record');
  const retried = await installer.installPersistedActiveCapability(persisted);
  assert.equal(retried.ok, true);
  assert.equal(retried.disposition, 'exact_retry');
  assert.equal((await installer.resolveActiveCapability(lookup(fixture))).ok, true);
  assert.deepEqual(await store.loadRegistration(lifecycleId), ceremony);
  assert.deepEqual(await sharedReplay(store, lifecycleId), replay);

  // An unchanged installation leaves the other wallet's concurrent write intact.
  const otherRuntime = runtime(api, store);
  const concurrent = new ConcurrentCapabilityStore(
    observedStore,
    otherRuntime.installPersistedActiveCapability.bind(otherRuntime, otherPersisted),
  );
  assert.equal(
    (await runtime(api, concurrent).installPersistedActiveCapability(persisted)).ok,
    true,
  );
  assert.equal(concurrent.commits, 1);
  assert.equal((await installer.resolveActiveCapability(lookup(other))).ok, true);

  // An unchanged installation also leaves a concurrent suspension intact.
  const suspended = api.buildNearRecoveryCacheFixture(fixture.admission, 'suspended');
  const suspensionRace = new ConcurrentCapabilityStore(
    observedStore,
    suspendCapability.bind(undefined, store, suspended),
  );
  assert.equal(
    (await runtime(api, suspensionRace).installPersistedActiveCapability(persisted)).ok,
    true,
  );
  assert.equal(suspensionRace.commits, 1);
  const denied = await installer.resolveActiveCapability(lookup(fixture));
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'unknown_capability');
  const afterSuspension = await store.loadCapabilities();
  for (const key of suspended.capabilities.keys()) {
    assert.equal(afterSuspension.value.recoveryCapabilities.get(key).kind, 'suspended');
  }
  assert.deepEqual(await sharedReplay(store, lifecycleId), replay);
  assert.deepEqual(await store.loadRegistration(lifecycleId), ceremony);

  // A wallet frozen for relocation still refuses a capability write.
  const identity = api.WalletRelocationSessionSource.parse({
    walletId: fixture.intent.walletId,
    moveId: `wmove_${'e'.repeat(43)}`,
    requestDigestHex: '6'.repeat(64),
    sourceGeneration: 1,
  });
  await new api.D1WalletRelocationSessions(database, scope).retire(identity, Date.now());
  await new api.D1WalletAuthorizationFreeze(database, scope).freeze(identity, Date.now());
  const frozen = await store.loadCapabilities();
  const reactivated = new Map(frozen.value.recoveryCapabilities);
  for (const [key, capability] of active.capabilities) reactivated.set(key, capability);
  await assert.rejects(
    store.commitCapabilities(
      frozen,
      {
        capabilities: reactivated,
        identityCapabilities: new Map(frozen.value.recoveryIdentityCapabilities),
      },
      null,
    ),
    /router_ab_yao_versioned_json_cas_guard/u,
  );
  assert.deepEqual(await store.loadCapabilities(), frozen);

  return {
    freshInstallD1Calls: freshCalls.length,
    freshInstallRecordReads: readStatements.length,
    freshInstallRecordWrites: recordWrites.length,
    lostReplyRetryResolved: true,
    ceremonyUnchanged: true,
    replayOwnersPreserved: true,
    concurrentWalletPreserved: true,
    concurrentSuspensionPreserved: true,
    frozenWalletWriteRejected: true,
    freshInstallTrace: freshCalls,
  };
}

function isRecordWrite(statement) {
  return (
    statement.query.kind !== 'SELECT' &&
    statement.query.tables.includes('router_ab_yao_versioned_json_records')
  );
}
