import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

async function post(worker, path, body, credential) {
  return worker.fetch(`https://deriver.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': credential },
    body: JSON.stringify(body),
  });
}

function digest(role, value) {
  return createHash('sha256').update('seams/deriver/wallet-snapshot/v1')
    .update(`Deriver ${role.toUpperCase()}`).update(JSON.stringify(value)).digest('hex');
}

export async function verifyDeriverSnapshot(topology, source, role, command, sourceObject, credential) {
  const path = `/router-ab/internal/deriver-${role}/wallet/snapshot`;
  const capture = { operation: 'capture', source: command };
  const exportFirst = { operation: 'export', source: command, segment_index: 0 };
  assert.equal((await post(source, path, exportFirst, credential)).status, 409);
  assert.equal((await post(source, path, capture, 'wrong-credential')).status, 403);
  const wrongMove = { ...command, request_digest_hex: 'cd'.repeat(32) };
  assert.equal((await post(source, path, { ...capture, source: wrongMove }, credential)).status, 409);
  let result;
  let calls = 0;
  const workerName = `deriver-${role}`;
  const namespace = await topology.getDurableObjectNamespace(`DERIVER_${role.toUpperCase()}_WALLET_DO`, workerName);
  const id = namespace.idFromName(sourceObject);
  do {
    const response = await post(source, path, capture, credential);
    assert.equal(response.status, 200, await response.clone().text());
    result = await response.json();
    calls += 1;
    assert.ok(calls < 20000, 'Snapshot capture must terminate');
    if (calls === 1) {
      assert.equal(result.kind, 'capturing');
      assert.equal((await post(source, path, exportFirst, credential)).status, 409);
      await topology.unsafeEvictDurableObject(workerName, `RouterAbDeriver${role.toUpperCase()}WalletDurableObject`, { id: id.toString() });
    }
  } while (result.kind === 'capturing');
  assert.equal(result.kind, 'frozen');
  const { receipt } = result;
  assert.deepEqual(receipt.source, command);
  assert.equal(receipt.source_object, sourceObject);
  assert.ok(receipt.record_count > 0);
  assert.ok(receipt.segment_count >= receipt.record_count);
  await topology.unsafeEvictDurableObject(workerName, `RouterAbDeriver${role.toUpperCase()}WalletDurableObject`, { id: id.toString() });
  assert.deepEqual(await (await post(source, path, capture, credential)).json(), result);
  let chain = digest(role, command);
  let parts = [];
  const records = [];
  let first;
  for (let index = 0; index < receipt.segment_count; index += 1) {
    const response = await post(source, path, { ...exportFirst, segment_index: index }, credential);
    assert.equal(response.status, 200, await response.clone().text());
    const exported = await response.json();
    assert.equal(exported.kind, 'segment');
    assert.deepEqual(exported.receipt, receipt);
    if (index === 0) first = exported;
    const wire = exported.segment;
    const segment = { segment_index: wire.segment_index, record_index: wire.record_index,
      part_index: wire.part_index, part_count: wire.part_count, data_b64u: wire.data_b64u };
    assert.equal(segment.segment_index, index);
    assert.equal(segment.record_index, records.length);
    assert.equal(segment.part_index, parts.length);
    const bytes = Buffer.from(segment.data_b64u, 'base64url');
    assert.ok(bytes.length > 0 && bytes.length <= 4096);
    parts.push(bytes);
    chain = digest(role, [chain, segment]);
    if (parts.length === segment.part_count) {
      const record = JSON.parse(Buffer.concat(parts).toString('utf8'));
      assert.match(record.session_hex, /^[a-f0-9]+$/u);
      if (record.kind === 'pair') {
        assert.ok(['completed', 'burned', 'expired'].includes(record.lifecycle));
        assert.equal(typeof record.ciphertext_json, 'string');
        assert.ok(JSON.parse(record.ciphertext_json));
        assert.equal(typeof record[role === 'a' ? 'revision_text' : 'revision'], 'string');
      } else {
        assert.equal(record.kind, 'admission_fence');
        assert.match(record.fenced_at_ms, /^\d+$/u);
      }
      records.push(record);
      parts = [];
    }
  }
  assert.equal(parts.length, 0);
  assert.equal(records.length, receipt.record_count);
  assert.ok(records.some(record => record.kind === 'pair'));
  assert.deepEqual(records.filter(record => record.kind === 'admission_fence'), [{
    kind: 'admission_fence', session_hex: '00'.repeat(32), fenced_at_ms: String(Number.MAX_SAFE_INTEGER),
  }]);
  assert.equal(chain, receipt.digest_hex);
  assert.deepEqual(await (await post(source, path, exportFirst, credential)).json(), first);
  assert.equal((await post(source, path, { ...exportFirst, segment_index: receipt.segment_count }, credential)).status, 409);
  assert.equal((await post(source, path, { ...exportFirst, source: wrongMove }, credential)).status, 409);
  return { receipt, captureCalls: calls, restartDuringCapture: true, sealedReplayAfterRestart: true,
    boundedSegments: true, reconstructedDigestMatches: true, conflictingMoveRejected: true,
    admissionFenceHistoryPreserved: true };
}
