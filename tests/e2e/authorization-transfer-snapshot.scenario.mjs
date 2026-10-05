import { freezeAuthorizationThroughCommand } from './authorization-transfer-command.scenario.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authorizationRowsQuery } from './authorization-transfer-freeze.scenario.mjs';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function recordKey(row, layout) {
  const values = [];
  for (const key of layout.keyColumns) values.push(row[key]);
  return JSON.stringify(values);
}

async function readSnapshot(api, database, scope, identity, manifest) {
  const store = new api.D1WalletAuthorizationSnapshot(database, scope);
  const layout = JSON.parse(manifest.schemaJson);
  const records = new Map();
  for (const table of layout) records.set(table.table, []);
  let digest = sha256(
    JSON.stringify([
      'seams/wallet-authorization-snapshot/v1',
      scope.namespace,
      scope.orgId,
      scope.projectId,
      scope.envId,
      identity.walletId,
      identity.moveId,
      identity.requestDigestHex,
      identity.sourceGeneration,
      manifest.schemaJson,
    ]),
  );
  let partial = [];
  let currentKey = null;
  let currentTable = null;
  let multiSegmentRecords = 0;
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const exported = await store.exportChunk(identity, index);
    assert.deepEqual(
      await new api.D1WalletAuthorizationSnapshot(database, scope).exportChunk(identity, index),
      exported,
    );
    assert.equal(exported.index, index);
    assert.ok(Buffer.byteLength(exported.chunkJson) <= 131_072);
    digest = sha256(JSON.stringify([digest, index, exported.chunkJson]));
    assert.equal(exported.digestHex, digest);
    const chunk = JSON.parse(exported.chunkJson);
    const bytes = Buffer.from(chunk.bytesHex, 'hex');
    assert.ok(bytes.length > 0 && bytes.length <= 32_768);
    if (chunk.segmentIndex === 0) {
      assert.equal(partial.length, 0);
      currentKey = chunk.recordKey;
      currentTable = chunk.table;
      if (chunk.segmentCount > 1) multiSegmentRecords += 1;
    }
    assert.equal(chunk.recordKey, currentKey);
    assert.equal(chunk.table, currentTable);
    assert.equal(chunk.segmentIndex, partial.length);
    partial.push(bytes);
    if (chunk.segmentIndex + 1 === chunk.segmentCount) {
      records
        .get(chunk.table)
        .push({ key: chunk.recordKey, json: Buffer.concat(partial).toString('utf8') });
      partial = [];
    }
  }
  assert.equal(partial.length, 0);
  assert.equal(digest, manifest.digestHex);
  return { records, multiSegmentRecords };
}

export async function verifyAuthorizationSnapshot({ api, source, scope, identity }) {
  const store = new api.D1WalletAuthorizationSnapshot(source, scope);
  await source
    .prepare(
      `CREATE TRIGGER fail_authorization_snapshot_chunk
    AFTER INSERT ON wallet_relocation_authorization_chunks WHEN NEW.chunk_index = 1
    BEGIN SELECT RAISE(ABORT, 'injected_snapshot_interruption'); END`,
    )
    .run();
  await assert.rejects(store.seal(identity), /injected_snapshot_interruption/u);
  const firstChunk = await source
    .prepare(
      'SELECT chunk_json, digest_hex FROM wallet_relocation_authorization_chunks WHERE wallet_id = ? AND chunk_index = 0',
    )
    .bind(identity.walletId)
    .first();
  assert.ok(firstChunk);
  assert.equal(
    await source
      .prepare(
        'SELECT COUNT(*) AS count FROM wallet_relocation_authorization_chunks WHERE wallet_id = ?',
      )
      .bind(identity.walletId)
      .first('count'),
    1,
  );
  await assert.rejects(store.exportChunk(identity, 0), /not sealed/u);
  await source.exec('DROP TRIGGER fail_authorization_snapshot_chunk');
  await source
    .prepare(
      `CREATE TRIGGER fail_authorization_snapshot_chunk
    AFTER INSERT ON wallet_relocation_authorization_chunks WHEN NEW.chunk_index > 0 AND json_extract(NEW.chunk_json, '$.segmentIndex') = 0
    BEGIN SELECT RAISE(ABORT, 'injected_record_boundary_interruption'); END`,
    )
    .run();
  await assert.rejects(
    new api.D1WalletAuthorizationSnapshot(source, scope).seal(identity),
    /injected_record_boundary_interruption/u,
  );
  assert.equal(
    await source
      .prepare(
        'SELECT COUNT(*) AS count FROM wallet_relocation_authorization_chunks WHERE wallet_id = ?',
      )
      .bind(identity.walletId)
      .first('count'),
    JSON.parse(firstChunk.chunk_json).segmentCount,
  );
  await assert.rejects(store.exportChunk(identity, 0), /not sealed/u);
  await source.exec('DROP TRIGGER fail_authorization_snapshot_chunk');
  const [manifest, concurrent] = await Promise.all([
    new api.D1WalletAuthorizationSnapshot(source, scope).seal(identity),
    store.seal(identity),
  ]);
  assert.deepEqual(concurrent, manifest);
  assert.deepEqual(
    await source
      .prepare(
        'SELECT chunk_json, digest_hex FROM wallet_relocation_authorization_chunks WHERE wallet_id = ? AND chunk_index = 0',
      )
      .bind(identity.walletId)
      .first(),
    firstChunk,
  );
  assert.deepEqual(await store.seal(identity), manifest);
  const snapshot = await readSnapshot(api, source, scope, identity, manifest);
  assert.ok(snapshot.multiSegmentRecords > 0);
  const rowsByTable = new Map();
  let recordCount = 0;
  for (const table of JSON.parse(manifest.schemaJson)) {
    const expected = (
      await api
        .prepareD1TenantStatement(source, scope, authorizationRowsQuery(table.table), [
          identity.walletId,
        ])
        .all()
    ).results;
    const byKey = new Map();
    for (const row of expected) byKey.set(recordKey(row, table), row);
    const records = snapshot.records.get(table.table);
    assert.equal(records.length, expected.length);
    const rows = [];
    for (const record of records) {
      const row = JSON.parse(record.json);
      assert.deepEqual(row, byKey.get(record.key));
      rows.push(row);
    }
    rowsByTable.set(table.table, rows);
    recordCount += rows.length;
  }
  assert.equal(recordCount, manifest.recordCount);
  for (const index of [-1, '0', manifest.chunkCount])
    await assert.rejects(store.exportChunk(identity, index));
  await assert.rejects(
    store.seal(
      api.WalletRelocationSessionSource.parse({
        walletId: identity.walletId,
        moveId: `wmove_${'v'.repeat(43)}`,
        requestDigestHex: identity.requestDigestHex,
        sourceGeneration: identity.sourceGeneration,
      }),
    ),
    /identity conflicts/u,
  );
  await assert.rejects(
    source
      .prepare(
        "UPDATE wallet_relocation_authorization_snapshots SET state = 'building' WHERE wallet_id = ?",
      )
      .bind(identity.walletId)
      .run(),
    /wallet_authorization_snapshot_conflict/u,
  );
  await assert.rejects(
    source
      .prepare(
        "UPDATE wallet_relocation_authorization_chunks SET chunk_json = '{}' WHERE wallet_id = ?",
      )
      .bind(identity.walletId)
      .run(),
    /wallet_authorization_chunk_immutable/u,
  );
  await assert.rejects(
    source
      .prepare('DELETE FROM wallet_relocation_authorization_chunks WHERE wallet_id = ?')
      .bind(identity.walletId)
      .run(),
    /wallet_authorization_chunk_retained/u,
  );
  await assert.rejects(
    source
      .prepare(
        'INSERT OR REPLACE INTO wallet_relocation_authorization_chunks SELECT * FROM wallet_relocation_authorization_chunks WHERE wallet_id = ?',
      )
      .bind(identity.walletId)
      .run(),
    /wallet_authorization_chunk_out_of_order/u,
  );
  return {
    rowsByTable,
    recordsByTable: snapshot.records,
    evidence: {
      manifest,
      multiSegmentRecords: snapshot.multiSegmentRecords,
      partialCaptureCannotExport: true,
      interruptedCaptureResumesWithoutReplacingChunks: true,
      resumesWithinAndBetweenRecords: true,
      concurrentAndRestartedSealsMatch: true,
      independentlyVerifiedDigestChain: true,
      recordsMatchScopedSource: true,
      sealedChunksRejectChanges: true,
      scope:
        'Authorization records only; authenticated transport, complete wallet manifest, and activation remain separate.',
    },
  };
}

export async function verifySnapshotIntegerPrecision({
  api,
  source,
  destination,
  sourceService,
  scope,
  issueDeviceSession,
}) {
  const nowMs = Date.now();
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'authorization-snapshot-precision',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: nowMs + 3_600_000,
    identity: {
      walletId: 'wallet:authorization-snapshot-precision',
      authorityId: 'authority:authorization-snapshot-precision',
      walletAuthMethodId: 'auth-method:authorization-snapshot-precision',
      rpId: 'wallet.example.test',
      credentialIdB64u: Buffer.alloc(32, 70).toString('base64url'),
    },
  });
  const issued = await issueDeviceSession(source, sourceService, fixture, nowMs);
  const identity = api.WalletRelocationSessionSource.parse({
    walletId: fixture.authority.walletId,
    moveId: `wmove_${'w'.repeat(43)}`,
    requestDigestHex: 'ef'.repeat(32),
    sourceGeneration: 1,
  });
  const snapshots = new api.D1WalletAuthorizationSnapshot(source, scope);
  await assert.rejects(snapshots.seal(identity), /requires_frozen_source/u);
  // An old SQLite integer must survive export without a JavaScript number conversion.
  await source
    .prepare(
      "UPDATE authorization_wallet_session_quotas SET expires_at_ms = CAST('9007199254740993' AS INTEGER) WHERE quota_id = ?",
    )
    .bind(issued.session.quotaId)
    .run();
  const command = await freezeAuthorizationThroughCommand({ api, database: source, scope, identity });
  const manifest = await snapshots.seal(identity);
  assert.deepEqual(manifest, command.manifest);
  const snapshot = await readSnapshot(api, source, scope, identity, manifest);
  const quotas = snapshot.records.get('authorization_wallet_session_quotas');
  assert.equal(quotas.length, 1);
  assert.match(quotas[0].json, /"expires_at_ms":9007199254740993/u);
  assert.equal(
    await source
      .prepare("SELECT CAST(json_extract(?1, '$.expires_at_ms') AS TEXT) AS exact_integer")
      .bind(quotas[0].json)
      .first('exact_integer'),
    '9007199254740993',
  );
  const importer = new api.D1WalletAuthorizationHistory(destination, scope);
  await importer.prepare(identity);
  for (const [table, records] of snapshot.records) {
    for (const record of records) await importer.restore(identity, table, record.json);
  }
  await importer.close(identity);
  assert.equal(
    await destination
      .prepare(
        'SELECT CAST(expires_at_ms AS TEXT) AS exact_integer FROM authorization_wallet_session_quotas WHERE quota_id = ?',
      )
      .bind(issued.session.quotaId)
      .first('exact_integer'),
    '9007199254740993',
  );
  return { manifestDigest: manifest.digestHex, exactIntegerPreserved: '9007199254740993', command };
}
