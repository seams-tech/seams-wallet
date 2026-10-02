import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare } from 'miniflare';

const artifactPath = resolve('.artifacts/r153/backend-storage-transfer.json');
const workerPath = resolve('tests/fixtures/backend-storage-transfer/worker.mjs');
const persistence = await mkdtemp(join(tmpdir(), 'wallet-storage-transfer-'));
const schema = `CREATE TABLE probe_records (
  wallet TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL,
  payload BLOB NOT NULL, exact_integer INTEGER NOT NULL, optional_text TEXT,
  PRIMARY KEY (wallet, id))`;
const selectRows = `SELECT wallet, id, state, hex(payload) AS payload_hex,
  CAST(exact_integer AS TEXT) AS exact_integer_text, optional_text
  FROM probe_records WHERE wallet = ? ORDER BY id`;
const sourceRows = [
  ['wallet-a', 'consumed', 'consumed', '00FF807F', '9007199254740993', null],
  ['wallet-a', 'ready', 'ready', 'DEADBEEF', '17', '東京'],
  ['wallet-b', 'unrelated', 'ready', 'AA', '3', null],
];
const observations = {};
let worker;

try {
  observations.schemaInventory = await inventorySignerSchema();
  worker = startWorker();
  await worker.ready;
  for (const storage of ['d1', 'do']) {
    await sql(worker, storage, 'source', [statement(schema)]);
    await sql(worker, storage, 'target', [statement(schema)]);
    await sql(worker, storage, 'source', sourceRows.map(insertRecord));
    const source = await rows(worker, storage, 'source');
    assert.equal(source.length, 2);
    await sql(worker, storage, 'target', source.map(insertExportedRecord));
    assert.deepEqual(await rows(worker, storage, 'target'), source);
    assert.deepEqual(await rows(worker, storage, 'target', 'wallet-b'), []);

    const consume = statement(
      "UPDATE probe_records SET state = 'consumed' WHERE wallet = ? AND id = ? AND state = 'ready' RETURNING id",
      ['wallet-a', 'ready'],
    );
    const firstSource = await sql(worker, storage, 'source', [consume]);
    const firstTarget = await sql(worker, storage, 'target', [consume]);
    assert.equal(resultRows(storage, firstSource, 0).length, 1);
    assert.equal(resultRows(storage, firstTarget, 0).length, 1);
    const secondSource = await sql(worker, storage, 'source', [consume]);
    assert.equal(resultRows(storage, secondSource, 0).length, 0);

    const beforeRollback = await rows(worker, storage, 'target');
    const rejected = await rawSql(worker, storage, 'target', [
      statement("UPDATE probe_records SET state = 'changed' WHERE wallet = ?", ['wallet-a']),
      insertRecord(sourceRows[0]),
    ]);
    assert.equal(rejected.status, 409);
    assert.deepEqual(await rows(worker, storage, 'target'), beforeRollback);
    observations[storage] = {
      copiedRows: source,
      walletSelectionPreserved: true,
      blobNullUnicodeAndTextEncodedInt64Preserved: true,
      localTransactionRolledBack: true,
      independentCopiesEachConsumedSameReadyRecord: true,
      sourceSecondConsumptionRefused: true,
      beforeRestart: beforeRollback,
    };
  }

  const kvEntries = [
    ['owner', { scope: 'opaque-storage-probe' }],
    ['recorded-result', 'unchanged-result-bytes'],
    ['retirement-marker', 'generation-1-retired'],
  ];
  await doCommand(worker, 'source', { kind: 'put', entries: kvEntries });
  const alarmAt = Date.now() + 86_400_000;
  await doCommand(worker, 'source', { kind: 'alarm', at: alarmAt });
  const sourceState = await doCommand(worker, 'source', { kind: 'inspect' });
  const targetSqlOnly = await doCommand(worker, 'target', { kind: 'inspect' });
  assert.notEqual(sourceState.id, targetSqlOnly.id);
  assert.deepEqual(targetSqlOnly.kv, []);
  assert.equal(targetSqlOnly.alarmAt, null);
  const differentHint = await doCommand(worker, 'source', { kind: 'inspect' }, 'apac');
  assert.equal(sourceState.id, differentHint.id);
  const hiddenKv = await rawSql(worker, 'do', 'source', [statement('SELECT * FROM __cf_kv')]);
  assert.equal(hiddenKv.status, 409);
  await doCommand(worker, 'target', { kind: 'put', entries: sourceState.kv });
  await doCommand(worker, 'target', { kind: 'alarm', at: alarmAt });
  observations.do.additionalStorage = {
    source: sourceState,
    destinationAfterSqlOnlyCopy: targetSqlOnly,
    sameNamespaceDifferentHintRetainedId: true,
    hiddenKvUnavailableThroughSql: true,
  };

  await worker.dispose();
  worker = startWorker();
  await worker.ready;
  const restarted = await doCommand(worker, 'target', { kind: 'inspect' });
  assert.equal(restarted.id, targetSqlOnly.id);
  assert.deepEqual(restarted.kv, sourceState.kv);
  assert.equal(restarted.alarmAt, alarmAt);
  assert.equal(restarted.volatileCalls, 1);
  observations.do.afterRestart = restarted;
  for (const storage of ['d1', 'do']) {
    assert.deepEqual(await rows(worker, storage, 'target'), observations[storage].beforeRestart);
  }

  const deleted = await doCommand(worker, 'source', { kind: 'delete_all' });
  assert.deepEqual(deleted.kv, []);
  assert.equal(deleted.alarmAt, null);
  observations.do.deleteAllAlsoRemovedRetirementMarkerAndAlarm = true;
  observations.restartPersistenceVerified = true;

  const artifact = {
    kind: 'wallet_backend_storage_transfer_platform_probe_v1',
    recordedAt: new Date().toISOString(),
    walletRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    nodeVersion: process.version,
    miniflareVersion: JSON.parse(await readFile('node_modules/miniflare/package.json', 'utf8')).version,
    workerSha256: digest(await readFile(workerPath)),
    runnerSha256: digest(await readFile(new URL(import.meta.url))),
    compatibilityDate: '2026-06-12',
    reproduce: 'node tests/e2e/backend-storage-transfer.e2e.mjs',
    scope: 'Local workerd storage primitives and effective signer schema; synthetic records, no wallet protocol or geographic placement proof.',
    observations,
  };
  await mkdir(resolve('.artifacts/r153'), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Storage transfer probe passed. Evidence: ${artifactPath}`);
} finally {
  if (worker) await worker.dispose();
  await rm(persistence, { recursive: true, force: true });
}

function startWorker() {
  return new Miniflare({
    modules: true,
    scriptPath: workerPath,
    compatibilityDate: '2026-06-12',
    port: 0,
    d1Databases: { SOURCE_DB: 'source-database', TARGET_DB: 'target-database' },
    d1Persist: join(persistence, 'd1'),
    durableObjects: {
      SOURCE_DO: { className: 'SourceStorage', useSQLite: true },
      TARGET_DO: { className: 'TargetStorage', useSQLite: true },
    },
    durableObjectsPersist: join(persistence, 'do'),
  });
}

function statement(sql, params = []) {
  return { sql, params };
}

function insertRecord(row) {
  const [wallet, id, state, payloadHex, exactInteger, optionalText] = row;
  assert.match(payloadHex, /^[0-9A-F]+$/u);
  return statement(
    `INSERT INTO probe_records VALUES (?, ?, ?, X'${payloadHex}', CAST(? AS INTEGER), ?)`,
    [wallet, id, state, exactInteger, optionalText],
  );
}

function insertExportedRecord(row) {
  return insertRecord([
    row.wallet, row.id, row.state, row.payload_hex, row.exact_integer_text, row.optional_text,
  ]);
}

function resultRows(storage, response, index) {
  return storage === 'd1' ? response[index].results : response[index];
}

async function rawSql(runtime, storage, destination, statements) {
  return await runtime.dispatchFetch('http://localhost/', {
    method: 'POST',
    body: JSON.stringify({
      storage, destination, statements, name: 'same-logical-wallet',
      locationHint: 'weur', command: { kind: 'sql', statements },
    }),
  });
}

async function sql(runtime, storage, destination, statements) {
  const response = await rawSql(runtime, storage, destination, statements);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function rows(runtime, storage, destination, wallet = 'wallet-a') {
  return resultRows(storage, await sql(runtime, storage, destination, [statement(selectRows, [wallet])]), 0);
}

async function doCommand(runtime, destination, command, locationHint = 'weur') {
  const response = await runtime.dispatchFetch('http://localhost/', {
    method: 'POST',
    body: JSON.stringify({ storage: 'do', destination, name: 'same-logical-wallet', locationHint, command }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function inventorySignerSchema() {
  const database = new DatabaseSync(':memory:');
  const directory = 'packages/wallet-server/migrations/d1-signer';
  const migrations = [];
  try {
    database.exec('PRAGMA foreign_keys = ON');
    for (const name of (await readdir(directory)).filter(isSql).sort()) {
      const source = await readFile(join(directory, name), 'utf8');
      database.exec(source);
      migrations.push({ name, sha256: digest(source) });
    }
    const objects = database.prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    ).all();
    return { migrations, objects };
  } finally {
    database.close();
  }
}

function isSql(name) {
  return name.endsWith('.sql');
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
