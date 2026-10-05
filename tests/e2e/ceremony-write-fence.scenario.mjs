import assert from 'node:assert/strict';

async function readRecords(database, scope) {
  const rows = await database
    .prepare(
      `SELECT record_key, version, record_json
    FROM router_ab_yao_versioned_json_records
    WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
    ORDER BY record_key`,
    )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId)
    .all();
  return rows.results;
}

async function installAuthority(store, fixture) {
  const lifecycleId = fixture.admission.scope.lifecycle_id;
  const loaded = await store.load(lifecycleId);
  loaded.state.authorization.authorities.push(...fixture.state.authorities);
  const stored = await store.commit({
    lifecycleId,
    state: loaded.state,
    baseline: loaded.baseline,
    companionWrite: null,
  });
  assert.equal(stored.kind, 'stored');
}

export async function verifyCeremonyWriteFence({ api, source, scope, nowMs }) {
  const fixture = await api.buildNearRegistrationAuthorityFixture('ceremony-fenced');
  const other = await api.buildNearRegistrationAuthorityFixture('ceremony-unrelated');
  const store = api.createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
    database: source,
    scope,
  });
  await installAuthority(store, fixture);
  const lifecycleId = fixture.admission.scope.lifecycle_id;
  const delayed = await store.load(lifecycleId);
  delayed.state.authorization.authorities.splice(0);
  delayed.state.export.authorizationNonceOwners.set('delayed-nonce', other.intent.walletId);
  const before = await readRecords(source, scope);
  const identity = api.WalletRelocationSessionSource.parse({
    walletId: fixture.intent.walletId,
    moveId: `wmove_${'c'.repeat(43)}`,
    requestDigestHex: '4'.repeat(64),
    sourceGeneration: 1,
  });
  await new api.D1WalletRelocationSessions(source, scope).retire(identity, nowMs);
  await new api.D1WalletAuthorizationFreeze(source, scope).freeze(identity, nowMs + 1);
  await source.exec('CREATE TABLE ceremony_companion_probe (value TEXT NOT NULL)');
  await assert.rejects(
    store.commit({
      lifecycleId,
      state: delayed.state,
      baseline: delayed.baseline,
      companionWrite: {
        statements: [
          source.prepare('INSERT INTO ceremony_companion_probe VALUES (?)').bind('delayed'),
        ],
      },
    }),
    /router_ab_yao_versioned_json_cas_guard/u,
  );
  assert.deepEqual(await readRecords(source, scope), before);
  assert.equal(
    await source.prepare('SELECT COUNT(*) AS count FROM ceremony_companion_probe').first('count'),
    0,
  );
  const reopened = api.createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
    database: source,
    scope,
  });
  await assert.rejects(
    installAuthority(reopened, fixture),
    /router_ab_yao_versioned_json_cas_guard/u,
  );
  assert.deepEqual(await readRecords(source, scope), before);
  await installAuthority(reopened, other);
  assert.equal((await reopened.load(lifecycleId)).state.authorization.authorities.length, 1);
  assert.equal(
    (await reopened.load(other.admission.scope.lifecycle_id)).state.authorization.authorities
      .length,
    1,
  );
  return {
    realD1Transactions: true,
    delayedAuthorityDeletionRejected: true,
    sharedWriteAndCompanionRolledBack: true,
    reopenedStoreStillFenced: true,
    unrelatedWalletStillWritable: true,
  };
}
