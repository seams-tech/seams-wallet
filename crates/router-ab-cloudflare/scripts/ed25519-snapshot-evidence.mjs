import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evictTransferredWallet } from './linked-presign-transfer-evidence.mjs';

const snapshotPath = '/router-ab/signing-worker/wallet/ed25519/snapshot';
const settlePath = '/router-ab/signing-worker/wallet/ed25519/settle';
const workerName = 'fixture-signing-worker';

async function post(worker, path, body, credential) {
  return worker.fetch(`https://signing-worker.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': credential,
    },
    body: JSON.stringify(body),
  });
}

async function accepted(worker, path, body, credential) {
  const response = await post(worker, path, body, credential);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

function digest(value) {
  return createHash('sha256')
    .update('seams/signing-worker/wallet-ed25519-snapshot/v1')
    .update(JSON.stringify(value))
    .digest('hex');
}

export async function verifyEd25519Snapshot(topology, deliveryJson, credential) {
  const delivery = JSON.parse(deliveryJson);
  const scope = delivery.scope;
  const worker = await topology.getWorker(workerName);
  const source = {
    scope,
    request: {
      move_id: `wmove_${'s'.repeat(43)}`,
      source_generation: 1,
      invalidated_at_ms: Date.now(),
    },
  };
  const capture = { command: 'capture', source };
  const premature = await post(worker, snapshotPath, capture, credential);
  assert.notEqual(premature.status, 200, await premature.text());
  const unauthorized = await post(worker, snapshotPath, capture, 'wrong-credential');
  assert.equal(unauthorized.status, 403);
  assert.deepEqual(await accepted(worker, settlePath, source, credential), {
    state: 'settled', command: source,
  });
  let frozen;
  let captureCalls = 0;
  for (; captureCalls < 64; captureCalls += 1) {
    const result = await accepted(worker, snapshotPath, capture, credential);
    await evictTransferredWallet(topology, workerName, scope);
    if (result.state === 'frozen') {
      frozen = result;
      break;
    }
    assert.equal(result.state, 'capturing');
  }
  assert.ok(frozen, 'Snapshot capture must finish within 64 bounded commands');
  assert.deepEqual(await accepted(worker, snapshotPath, capture, credential), frozen);
  const { receipt } = frozen;
  assert.equal(receipt.record_count, 1, 'This registered wallet has one registration');
  assert.ok(receipt.segment_count > 1, 'Encrypted registration must span multiple segments');
  let rollingDigest = digest(source);
  const bytes = [];
  for (let segmentIndex = 0; segmentIndex < receipt.segment_count; segmentIndex += 1) {
    const request = { command: 'export', receipt, segment_index: segmentIndex };
    const result = await accepted(worker, snapshotPath, request, credential);
    assert.equal(result.state, 'segment');
    assert.deepEqual(result.receipt, receipt);
    const { segment } = result;
    assert.equal(segment.segment_index, segmentIndex);
    assert.equal(segment.record_index, 0);
    assert.equal(segment.part_index, segmentIndex);
    assert.equal(segment.part_count, receipt.segment_count);
    const part = Buffer.from(segment.data_b64u, 'base64url');
    assert.ok(part.length > 0 && part.length <= 4096);
    bytes.push(part);
    rollingDigest = digest([rollingDigest, segment]);
    await evictTransferredWallet(topology, workerName, scope);
    assert.deepEqual(await accepted(worker, snapshotPath, request, credential), result);
  }
  assert.equal(rollingDigest, receipt.digest_hex);
  const record = JSON.parse(Buffer.concat(bytes).toString('utf8'));
  assert.equal(record.kind, 'registration');
  assert.deepEqual(JSON.parse(record.row.owner_json), scope);
  assert.equal(typeof record.row.ciphertext_json, 'string');
  const changed = structuredClone(receipt);
  changed.digest_hex = '00'.repeat(32);
  const changedReceipt = await post(worker, snapshotPath, {
    command: 'export', receipt: changed, segment_index: 0,
  }, credential);
  assert.notEqual(changedReceipt.status, 200, await changedReceipt.text());
  const missingSegment = await post(worker, snapshotPath, {
    command: 'export', receipt, segment_index: receipt.segment_count,
  }, credential);
  assert.notEqual(missingSegment.status, 200, await missingSegment.text());
  const changedSource = structuredClone(source);
  changedSource.request.move_id = `wmove_${'t'.repeat(43)}`;
  const changedMove = await post(worker, snapshotPath, {
    command: 'capture', source: changedSource,
  }, credential);
  assert.notEqual(changedMove.status, 200, await changedMove.text());
  assert.deepEqual(await accepted(worker, snapshotPath, capture, credential), frozen);
  return {
    recordCount: receipt.record_count,
    segmentCount: receipt.segment_count,
    snapshotDigestHex: receipt.digest_hex,
    captureCalls: captureCalls + 1,
    settlementRequired: true,
    boundedSegments: true,
    captureAndExportResumeAfterEviction: true,
    exactDigestReconstructed: true,
    changedMoveAndReceiptRejected: true,
    scope: 'Registered wallet Worker capture/export; excludes signing history and destination restore',
  };
}
