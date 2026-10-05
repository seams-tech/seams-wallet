import assert from 'node:assert/strict';
import { authorizationRowsQuery } from './authorization-transfer-freeze.scenario.mjs';

export async function verifyAuthorizationHistoryCopy({
  api,
  destination,
  scope,
  identity,
  snapshot,
  service,
  issueDeviceSession,
}) {
  const importer = new api.D1WalletAuthorizationHistory(destination, scope);
  await importer.prepare(identity);
  const nowMs = Date.now();
  const neighborFixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'authorization-history-neighbor',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: nowMs + 3_600_000,
    identity: {
      walletId: 'wallet:authorization-history-neighbor',
      authorityId: 'authority:authorization-history-neighbor',
      walletAuthMethodId: 'auth-method:authorization-history-neighbor',
      rpId: 'wallet.example.test',
      credentialIdB64u: Buffer.alloc(32, 68).toString('base64url'),
    },
  });
  const neighborService = service(destination, scope);
  const neighbor = await issueDeviceSession(destination, neighborService, neighborFixture, nowMs);
  const copied = [];
  let firstImported = null;
  for (const [table, records] of snapshot.recordsByTable) {
    for (const record of records) {
      if (!firstImported) {
        await destination
          .prepare(
            `CREATE TRIGGER injected_authorization_import_failure
          BEFORE INSERT ON wallet_relocation_authorization_import_receipts
          BEGIN SELECT RAISE(ABORT, 'injected_import_ack_failure'); END`,
          )
          .run();
        await assert.rejects(
          importer.restore(identity, table, record.json),
          /injected_import_ack_failure/u,
        );
        await destination.exec('DROP TRIGGER injected_authorization_import_failure');
        assert.equal(
          await destination
            .prepare('SELECT COUNT(*) AS count FROM wallet_relocation_authorization_import_context')
            .first('count'),
          0,
        );
        assert.equal(
          await destination
            .prepare('SELECT COUNT(*) AS count FROM wallet_authorities WHERE wallet_id = ?')
            .bind(identity.walletId)
            .first('count'),
          0,
        );
      }
      if (table !== 'authorization_wallet_session_quotas') {
        const columns = Object.keys(JSON.parse(record.json));
        const values = [];
        for (const column of columns) values.push(`json_extract(?1, '$.${column}')`);
        await assert.rejects(
          destination
            .prepare(`INSERT INTO ${table} (${columns.join(', ')}) SELECT ${values.join(', ')}`)
            .bind(record.json)
            .run(),
          /wallet_authorization_destination_inactive|wallet_session_hosted_/u,
        );
      }
      const [receipt, concurrent] = await Promise.all([
        importer.restore(identity, table, record.json),
        importer.restore(identity, table, record.json),
      ]);
      assert.equal(concurrent, receipt);
      assert.equal(
        await new api.D1WalletAuthorizationHistory(destination, scope).restore(
          identity,
          table,
          record.json,
        ),
        receipt,
      );
      if (!firstImported) {
        firstImported = { table, json: record.json, receipt };
        const changed = JSON.parse(record.json);
        changed.updated_at_ms += 1;
        await assert.rejects(
          importer.restore(identity, table, JSON.stringify(changed)),
          /content conflicts/u,
        );
        const foreign = JSON.parse(record.json);
        foreign.wallet_id = 'wallet:foreign-history';
        await assert.rejects(
          importer.restore(identity, table, JSON.stringify(foreign)),
          /scope, shape or lifecycle conflicts/u,
        );
      }
      if (table === 'authorization_wallet_session_quotas') {
        await assert.rejects(
          destination
            .prepare(
              `UPDATE authorization_wallet_session_quotas
          SET expires_at_ms = expires_at_ms + 1 WHERE json_array(namespace, quota_id, tenant_id) = ?`,
            )
            .bind(record.key)
            .run(),
          /wallet_authorization_destination_inactive/u,
        );
      }
    }
    if (table === 'authorization_wallet_session_quotas' && records.length > 0)
      await assert.rejects(importer.close(identity));
    copied.push({ table, rows: records.length });
  }
  for (const [table, rows] of snapshot.rowsByTable) {
    const restored = await api
      .prepareD1TenantStatement(destination, scope, authorizationRowsQuery(table), [
        identity.walletId,
      ])
      .all();
    assert.deepEqual(restored.results, rows);
  }
  assert.ok(firstImported);
  await importer.close(identity);
  assert.equal(
    await importer.restore(identity, firstImported.table, firstImported.json),
    firstImported.receipt,
  );
  await importer.prepare(identity);
  const late = JSON.parse(firstImported.json);
  late.authority_id = 'authority:late-import';
  await assert.rejects(importer.restore(identity, firstImported.table, JSON.stringify(late)));
  assert.equal(
    await destination
      .prepare('SELECT COUNT(*) AS count FROM wallet_relocation_authorization_import_context')
      .first('count'),
    0,
  );
  assert.equal(
    (
      await neighborService.readWalletSessionAdmissionSnapshotByOperationCredential({
        tenantId: neighbor.session.tenantId,
        token: neighbor.operationCredential.token,
        nowMs: nowMs + 1,
      })
    ).kind,
    'active',
  );
  return {
    tables: copied,
    allSixFamiliesUseProductionRestore: true,
    exactRowsAndQuotasPreserved: true,
    concurrentReplayExact: true,
    failedAcknowledgementRolledBackRecordAndContext: true,
    scopeAndContentConflictsRejected: true,
    quotaProtectedBeforeItsSessionArrives: true,
    closureRequiresQuotaParents: true,
    importClosureRejectsNewRecordsAndPreservesReplay: true,
    unrelatedDestinationWalletRemainsActive: true,
    scope:
      'Production record restore. Bounded stream intake, complete-manifest verification and activation remain unfinished.',
  };
}
