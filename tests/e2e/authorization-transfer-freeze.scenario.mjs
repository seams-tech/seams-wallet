import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function authorizationRowsQuery(table) {
  const ownership =
    table === 'authorization_wallet_session_quotas'
      ? `EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
        WHERE session.namespace = ?1 AND session.org_id = ?2 AND session.project_id = ?3 AND session.env_id = ?4
          AND session.wallet_id = ?5 AND session.namespace = target.namespace AND session.tenant_id = target.tenant_id
          AND session.quota_id = target.quota_id AND session.wallet_session_id = target.wallet_session_id)`
      : 'target.namespace = ?1 AND target.org_id = ?2 AND target.project_id = ?3 AND target.env_id = ?4 AND target.wallet_id = ?5';
  return `SELECT target.* FROM ${table} AS target WHERE ${ownership} ORDER BY target.rowid`;
}

export async function verifyAuthorizationFreeze({
  api,
  source,
  sourceService,
  scope,
  identity,
  nowMs,
  tables,
  issueDeviceSession,
}) {
  const store = new api.D1WalletAuthorizationFreeze(source, scope);
  await source
    .prepare(
      `CREATE TRIGGER fail_authorization_freeze AFTER INSERT ON wallet_relocation_authorization_fences
    BEGIN SELECT RAISE(ABORT, 'injected_freeze_failure'); END`,
    )
    .run();
  await assert.rejects(store.freeze(identity, nowMs), /injected_freeze_failure/u);
  assert.equal(
    await source
      .prepare('SELECT COUNT(*) AS count FROM wallet_relocation_authorization_fences')
      .first('count'),
    0,
  );
  await source
    .prepare('UPDATE wallet_authorities SET updated_at_ms = updated_at_ms WHERE wallet_id = ?')
    .bind(identity.walletId)
    .run();
  await source.exec('DROP TRIGGER fail_authorization_freeze');

  const [first, concurrent] = await Promise.all([
    store.freeze(identity, nowMs),
    store.freeze(identity, nowMs + 1),
  ]);
  assert.equal(concurrent, first);
  assert.ok(first === nowMs || first === nowMs + 1);
  assert.equal(
    await new api.D1WalletAuthorizationFreeze(source, scope).freeze(identity, nowMs + 2),
    first,
  );
  await assert.rejects(
    store.freeze(
      api.WalletRelocationSessionSource.parse({
        walletId: identity.walletId,
        moveId: `wmove_${'u'.repeat(43)}`,
        requestDigestHex: identity.requestDigestHex,
        sourceGeneration: identity.sourceGeneration,
      }),
      nowMs + 2,
    ),
    /identity conflicts/u,
  );
  await assert.rejects(
    new api.D1WalletAuthorizationFreeze(source, { ...scope, envId: 'foreign' }).freeze(
      identity,
      nowMs + 2,
    ),
    /wallet_authorization_freeze_requires_retirement/u,
  );

  const frozenTables = [];
  for (const table of tables) {
    const query = authorizationRowsQuery(table);
    const before = (
      await api.prepareD1TenantStatement(source, scope, query, [identity.walletId]).all()
    ).results;
    assert.ok(before.length > 0, `${table} must contain a real transferred record`);
    const rows = query.replace('SELECT target.*', 'SELECT target.rowid');
    const timestamp =
      table === 'wallet_authorities' || table === 'wallet_auth_methods'
        ? 'updated_at_ms'
        : 'expires_at_ms';
    const movedIdentity =
      table === 'authorization_wallet_session_quotas' ? 'wallet_session_id' : 'wallet_id';
    for (const mutation of [
      `UPDATE ${table} SET ${timestamp} = ${timestamp} + 1 WHERE rowid IN (${rows})`,
      `UPDATE ${table} SET ${movedIdentity} = 'wallet:foreign-freeze-target' WHERE rowid IN (${rows})`,
      `DELETE FROM ${table} WHERE rowid IN (${rows})`,
      `INSERT OR REPLACE INTO ${table} ${query}`,
    ]) {
      await assert.rejects(
        api.prepareD1TenantStatement(source, scope, mutation, [identity.walletId]).run(),
        /wallet_authorization_history_frozen|wallet_session_hosted_(credential|exchange)_(parent|initial_state)_rejected/u,
      );
    }
    const after = (
      await api.prepareD1TenantStatement(source, scope, query, [identity.walletId]).all()
    ).results;
    assert.deepEqual(after, before);
    frozenTables.push({
      table,
      rows: before.length,
      sha256: createHash('sha256').update(JSON.stringify(before)).digest('hex'),
    });
  }
  await assert.rejects(
    source
      .prepare('DELETE FROM wallet_relocation_authorization_fences WHERE wallet_id = ?')
      .bind(identity.walletId)
      .run(),
    /wallet_authorization_fence_retained/u,
  );
  await assert.rejects(
    source
      .prepare(
        'UPDATE wallet_relocation_authorization_fences SET frozen_at_ms = frozen_at_ms + 1 WHERE wallet_id = ?',
      )
      .bind(identity.walletId)
      .run(),
    /wallet_authorization_fence_immutable/u,
  );
  await assert.rejects(
    source
      .prepare(
        'INSERT OR REPLACE INTO wallet_relocation_authorization_fences SELECT * FROM wallet_relocation_authorization_fences WHERE wallet_id = ?',
      )
      .bind(identity.walletId)
      .run(),
    /wallet_authorization_freeze_requires_retirement/u,
  );

  const neighborFixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'authorization-freeze-neighbor',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: nowMs + 3_600_000,
    identity: {
      walletId: 'wallet:authorization-freeze-neighbor',
      authorityId: 'authority:authorization-freeze-neighbor',
      walletAuthMethodId: 'auth-method:authorization-freeze-neighbor',
      credentialIdB64u: Buffer.alloc(32, 69).toString('base64url'),
      rpId: 'wallet.example.test',
    },
  });
  const neighbor = await issueDeviceSession(source, sourceService, neighborFixture, nowMs + 3);
  assert.equal(
    (
      await sourceService.readWalletSessionAdmissionSnapshotByOperationCredential({
        tenantId: neighbor.session.tenantId,
        token: neighbor.operationCredential.token,
        nowMs: nowMs + 4,
      })
    ).kind,
    'active',
  );
  return {
    scope:
      'Authorization D1 records only. No all-wallet snapshot, coordinator, activation or cleanup claim.',
    frozenAtMs: first,
    frozenTables,
    failedFreezeRollsBack: true,
    concurrentAndRestartedRetriesPreserveFence: true,
    delayedUpdatesDeletesReplacementsAndIdentityMovesRejected: true,
    neighborStillIssuesAndUsesSession: true,
  };
}
