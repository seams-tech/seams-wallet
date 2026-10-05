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
  const importer = new api.D1WalletAuthorizationHistory(destination, scope);
  const exporter = new api.D1WalletAuthorizationSnapshot(source, scope);
  const manifest = await exporter.seal(identity);
  const intake = new api.D1WalletAuthorizationIntake(destination, scope);
  await intake.prepare(identity, manifest);
  await assert.rejects(
    intake.prepare(identity, { ...manifest, recordCount: manifest.recordCount + 1 }),
    /manifest conflicts/u,
  );
  await assert.rejects(intake.verify(identity), /incomplete/u);
  await assert.rejects(
    intake.accept(identity, await exporter.exportChunk(identity, 1)),
    /out of order/u,
  );
  let chunkIndex = 0;
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
  let largestRecordBytes = 0;
  for (const [table, records] of snapshot.recordsByTable) {
    for (const record of records) {
      largestRecordBytes = Math.max(largestRecordBytes, Buffer.byteLength(record.json));
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
      if (table === 'authorized_operations') {
        await destination
          .prepare(
            `CREATE TRIGGER interrupt_operation_import
          BEFORE INSERT ON wallet_relocation_authorization_import_receipts
          WHEN NEW.table_name = 'authorized_operations'
          BEGIN SELECT RAISE(ABORT, 'injected_operation_import_failure'); END`,
          )
          .run();
        await assert.rejects(
          importer.restore(identity, table, record.json),
          /injected_operation_import_failure/u,
        );
        await destination.exec('DROP TRIGGER interrupt_operation_import');
        const row = JSON.parse(record.json);
        const pending = JSON.parse(record.json);
        pending.lifecycle_kind = 'claimed';
        pending.result_kind = 'pending';
        for (const field of [
          'result_digest',
          'result_status',
          'result_content_type',
          'result_body_text',
          'completed_at_ms',
        ])
          pending[field] = null;
        await assert.rejects(
          importer.restore(identity, table, JSON.stringify(pending)),
          /scope, shape or lifecycle conflicts/u,
        );
        const foreign = JSON.parse(record.json);
        if (foreign.authorization_source_kind === 'authorization_grant')
          foreign.owner_scope_project_id = 'foreign';
        else foreign.evidence_set_digest = 'foreign';
        await assert.rejects(
          importer.restore(identity, table, JSON.stringify(foreign)),
          /scope, shape or lifecycle conflicts/u,
        );
        assert.equal(
          await destination
            .prepare(
              'SELECT COUNT(*) AS count FROM authorized_operations WHERE authorized_operation_id = ?',
            )
            .bind(row.authorized_operation_id)
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
          /wallet_authorization_destination_inactive|wallet_operation_history_import_required|wallet_session_hosted_/u,
        );
      }
      while (chunkIndex < manifest.chunkCount) {
        const chunk = await exporter.exportChunk(identity, chunkIndex);
        const payload = JSON.parse(chunk.chunkJson);
        assert.equal(payload.table, table);
        assert.equal(payload.recordKey, record.key);
        if (!firstImported && payload.segmentIndex + 1 === payload.segmentCount) {
          await destination
            .prepare(
              `CREATE TRIGGER injected_intake_ack_failure
            BEFORE UPDATE ON wallet_relocation_authorization_intakes
            BEGIN SELECT RAISE(ABORT, 'injected_intake_ack_failure'); END`,
            )
            .run();
          await assert.rejects(intake.accept(identity, chunk), /injected_intake_ack_failure/u);
          await destination.exec('DROP TRIGGER injected_intake_ack_failure');
          const restored = await destination
            .prepare(
              `SELECT COUNT(*) AS count
            FROM wallet_relocation_authorization_import_receipts WHERE wallet_id = ?`,
            )
            .bind(identity.walletId)
            .first('count');
          assert.equal(restored, 1);
        }
        const [receipt, concurrent] = await Promise.all([
          intake.accept(identity, chunk),
          new api.D1WalletAuthorizationIntake(destination, scope).accept(identity, chunk),
        ]);
        assert.equal(concurrent, receipt);
        assert.equal(receipt, chunk.digestHex);
        assert.equal(
          await new api.D1WalletAuthorizationIntake(destination, scope).accept(identity, chunk),
          receipt,
        );
        await assert.rejects(
          intake.accept(identity, { ...chunk, digestHex: '0'.repeat(64) }),
          /conflicts/u,
        );
        chunkIndex += 1;
        if (payload.segmentIndex + 1 === payload.segmentCount) break;
        await assert.rejects(intake.verify(identity), /incomplete/u);
      }
      const receipt = await importer.restore(identity, table, record.json);
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
    if (table === 'authorized_operations' && records.length > 0)
      await assert.rejects(importer.close(identity), /wallet_operation_history_incomplete/u);
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
  assert.ok(largestRecordBytes > 1_048_576);
  assert.equal(chunkIndex, manifest.chunkCount);
  assert.equal(await intake.verify(identity), manifest.digestHex);
  assert.equal(
    await new api.D1WalletAuthorizationIntake(destination, scope).verify(identity),
    manifest.digestHex,
  );
  assert.equal(
    await intake.accept(identity, await exporter.exportChunk(identity, 0)),
    (await exporter.exportChunk(identity, 0)).digestHex,
  );
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
    largestRecordBytes,
    allInventoryTablesUseProductionRestore: true,
    exactRowsAndQuotasPreserved: true,
    restartedChunkReplayExact: true,
    concurrentChunkReplayExact: true,
    interruptedProgressAcknowledgementResumesRestoredRecord: true,
    incompleteAndConflictingStreamsRejected: true,
    verifiedManifestDigest: manifest.digestHex,
    failedAcknowledgementRolledBackRecordAndContext: true,
    scopeAndContentConflictsRejected: true,
    quotaProtectedBeforeItsSessionArrives: true,
    closureRequiresQuotaParents: true,
    importClosureRejectsNewRecordsAndPreservesReplay: true,
    unrelatedDestinationWalletRemainsActive: true,
    scope:
      'Production bounded intake and authorization manifest verification. Full wallet relocation remains outside this component scenario.',
  };
}
