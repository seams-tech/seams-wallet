import assert from 'node:assert/strict';

export async function verifyTemporaryWriteBlock({
  api,
  database,
  scope,
  service,
  issueDeviceSession,
  nowMs,
}) {
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'capacity-block-owner',
    identity: {
      walletId: 'wallet:capacity-block-owner',
      credentialIdB64u: Buffer.alloc(32, 91).toString('base64url'),
    },
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: nowMs + 3_600_000,
  });
  const issued = await issueDeviceSession(database, service, fixture, nowMs);
  const walletId = fixture.authority.walletId;
  const first = api.WalletRelocationSessionSource.parse({
    walletId,
    moveId: `wmove_${'B'.repeat(43)}`,
    requestDigestHex: 'b'.repeat(64),
    sourceGeneration: 1,
  });
  const snapshot = new api.D1WalletAuthorizationSnapshot(database, scope);
  await snapshot.assertCapacity(walletId);
  const operations = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const input = api.buildSessionSigningOperationInputFixture({
    session: issued.session,
    label: 'capacity-drain',
    nowMs,
  });
  const claimed = await operations.admitAuthorizedOperation({ operation: input });
  assert.equal(claimed.kind, 'claimed');
  // Grow after the early capacity check, while the wallet is still writable.
  await database
    .prepare('UPDATE wallet_authorities SET record_json = record_json || ? WHERE wallet_id = ?')
    .bind(' '.repeat(600_000), walletId)
    .run();
  const block = new api.D1WalletRelocationWriteBlock(database, scope);
  assert.equal(await block.check(first, nowMs + 1), 'draining');
  assert.equal((await api.admitD1EstablishedWalletHome(database, scope, { walletId })).ok, false);
  assert.equal(
    (
      await operations.admitAuthorizedOperation({
        operation: api.buildSessionSigningOperationInputFixture({
          session: issued.session,
          label: 'capacity-late',
          nowMs,
        }),
      })
    ).kind,
    'authorization_grant_rejected',
  );
  await operations.completeAuthorizedOperation({
    operation: claimed.operation,
    result: 'succeeded',
    response: {
      status: 200,
      contentType: 'application/json',
      bodyText: '{"signature":"complete"}',
    },
    completedAtMs: nowMs + 2,
  });
  await assert.rejects(block.check(first, nowMs + 3), /capacity/u);
  await block.release(first, nowMs + 4);
  assert.equal((await api.admitD1EstablishedWalletHome(database, scope, { walletId })).ok, true);
  assert.equal(
    await database
      .prepare(
        'SELECT COUNT(*) AS count FROM wallet_session_authorizations_v2 WHERE wallet_id = ? AND retired_at_ms IS NOT NULL',
      )
      .bind(walletId)
      .first('count'),
    0,
  );
  await assert.rejects(
    new api.D1WalletRelocationWriteBlock(database, scope).check(first, nowMs + 5),
    /unavailable/u,
  );
  await database
    .prepare('UPDATE wallet_authorities SET record_json = rtrim(record_json) WHERE wallet_id = ?')
    .bind(walletId)
    .run();
  const next = api.WalletRelocationSessionSource.parse({
    walletId,
    moveId: `wmove_${'C'.repeat(43)}`,
    requestDigestHex: 'c'.repeat(64),
    sourceGeneration: 1,
  });
  assert.equal(await block.check(next, nowMs + 6), 'ready');
  assert.equal(
    await new api.D1WalletRelocationWriteBlock(database, scope).check(next, nowMs + 7),
    'ready',
  );
  await assert.rejects(
    database
      .prepare('UPDATE wallet_authorities SET record_json = record_json || ? WHERE wallet_id = ?')
      .bind(' ', walletId)
      .run(),
    /frozen/u,
  );
  // An unrelated wallet remains writable under the same tenant and database.
  const neighbor = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'capacity-block-neighbor',
    permissions: api.buildFullOwnerPermissionsV1(),
    identity: {
      walletId: 'wallet:capacity-block-neighbor',
      credentialIdB64u: Buffer.alloc(32, 92).toString('base64url'),
    },
    provenance: 'wallet_registration',
    expiresAtMs: nowMs + 3_600_000,
  });
  await issueDeviceSession(database, service, neighbor, nowMs);
  assert.equal(
    (
      await api.admitD1EstablishedWalletHome(database, scope, {
        walletId: neighbor.authority.walletId,
      })
    ).ok,
    true,
  );
  const frozen = await block.freeze(next, nowMs + 8);
  assert.deepEqual(
    await new api.D1WalletRelocationWriteBlock(database, scope).freeze(next, nowMs + 9),
    frozen,
  );
  await assert.rejects(block.release(next, nowMs + 10));
  const manifest = await snapshot.seal(next);
  const payload = await snapshot.exportSnapshot(next);
  assert.equal(payload.length, manifest.chunkCount);
  return {
    growthAfterPrecheckRejected: true,
    admittedOperationSettled: true,
    newOperationBlocked: true,
    releasePreservedSessions: true,
    delayedBlockCannotRecreatePause: true,
    neighborStillWritable: true,
    restartedBlockAndFreezeExact: true,
    frozenSourceCannotRelease: true,
    snapshotBytes: Buffer.byteLength(JSON.stringify(payload)),
  };
}
