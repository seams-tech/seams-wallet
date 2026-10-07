import assert from 'node:assert/strict';
import { authorizationRowsQuery } from './authorization-transfer-freeze.scenario.mjs';

export async function verifyAuthorizationHistoryCopy({
  api,
  destination,
  source,
  scope,
  identity,
  snapshot,
  service,
  issueDeviceSession,
}) {
  const exporter = new api.D1WalletAuthorizationSnapshot(source, scope);
  const manifest = await exporter.seal(identity);
  const payload = await exporter.exportSnapshot(identity);
  const intake = new api.D1WalletAuthorizationIntake(destination, scope);
  await intake.prepare(identity, manifest);
  await assert.rejects(intake.prepare(identity, { ...manifest, recordCount: manifest.recordCount + 1 }), /manifest conflicts/u);
  await assert.rejects(intake.acceptSnapshot(identity, payload.slice(1)), /count conflicts/u);
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
  await destination.prepare(`CREATE TRIGGER injected_intake_ack_failure
    BEFORE UPDATE ON wallet_relocation_authorization_intakes WHEN NEW.state = 'verified'
    BEGIN SELECT RAISE(ABORT, 'injected_intake_ack_failure'); END`).run();
  await assert.rejects(intake.acceptSnapshot(identity, payload), /injected_intake_ack_failure/u);
  await destination.exec('DROP TRIGGER injected_intake_ack_failure');
  for (const table of ['wallet_authorities', 'wallet_relocation_authorization_import_receipts',
    'wallet_relocation_authorization_import_context', 'wallet_relocation_authorization_intake_chunks']) {
    assert.equal(await destination.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE wallet_id = ?`)
      .bind(identity.walletId).first('count'), 0);
  }
  const [receipt, concurrent] = await Promise.all([
    intake.acceptSnapshot(identity, payload),
    new api.D1WalletAuthorizationIntake(destination, scope).acceptSnapshot(identity, payload),
  ]);
  assert.equal(receipt, manifest.digestHex);
  assert.equal(concurrent, receipt);
  // Ignore the first acknowledgement and retry through a new importer instance.
  assert.equal(await new api.D1WalletAuthorizationIntake(destination, scope).acceptSnapshot(identity, payload), receipt);
  const changed = structuredClone(payload);
  changed[0].digestHex = '0'.repeat(64);
  await assert.rejects(intake.acceptSnapshot(identity, changed), /digest conflicts/u);
  const copied = [];
  for (const [table, records] of snapshot.recordsByTable) copied.push({ table, rows: records.length });
  for (const [table, rows] of snapshot.rowsByTable) {
    const restored = await api
      .prepareD1TenantStatement(destination, scope, authorizationRowsQuery(table), [
        identity.walletId,
      ])
      .all();
    assert.deepEqual(restored.results, rows);
  }
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
    snapshotBytes: Buffer.byteLength(JSON.stringify(payload)),
    transferRequests: 1,
    exactRowsAndQuotasPreserved: true,
    restartedAndConcurrentSnapshotRetriesExact: true,
    failedCompletionRollsBackWholeSnapshot: true,
    incompleteAndChangedSnapshotsRejected: true,
    unrelatedDestinationWalletRemainsActive: true,
    verifiedManifestDigest: receipt,
  };
}
