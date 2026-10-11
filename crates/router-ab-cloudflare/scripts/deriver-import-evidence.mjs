import assert from 'node:assert/strict';
import { verifyDeriverActivation } from './deriver-activation-evidence.mjs';

async function post(worker, path, body, credential) {
  return worker.fetch(`https://deriver.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': credential },
    body: JSON.stringify(body),
  });
}

async function accepted(worker, path, body, credential) {
  const response = await post(worker, path, body, credential);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

function corruptFinalPairPart(segments, records) {
  const recordIndex = records.findIndex(isPair);
  const record = structuredClone(records[recordIndex]);
  const envelope = JSON.parse(record.ciphertext_json);
  const cipher = Buffer.from(envelope.ciphertext_b64u, 'base64url');
  cipher[cipher.length - 1] ^= 1;
  envelope.ciphertext_b64u = cipher.toString('base64url');
  record.ciphertext_json = JSON.stringify(envelope);
  const bytes = Buffer.from(JSON.stringify(record));
  const parts = segments.filter(segment => segment.record_index === recordIndex);
  assert.equal(bytes.length, Buffer.concat(parts.map(segmentBytes)).length);
  for (const segment of parts.slice(0, -1)) {
    assert.deepEqual(bytes.subarray(segment.part_index * 4096, (segment.part_index + 1) * 4096), segmentBytes(segment));
  }
  const last = parts.at(-1);
  return { ...last, data_b64u: bytes.subarray(last.part_index * 4096).toString('base64url') };
}

function isPair(record) { return record.kind === 'pair'; }
function segmentBytes(segment) { return Buffer.from(segment.data_b64u, 'base64url'); }

export async function verifyDeriverImport(topology, role, receipt, segments, records, credential, rootIdentity, preparation, transport) {
  const workerName = `deriver-${role}-relocation-destination`;
  const destination = await topology.getWorker(workerName);
  const path = `/router-ab/internal/deriver-${role}/wallet/snapshot`;
  const status = { operation: 'status', receipt };
  const verify = { operation: 'verify', receipt };
  const dispatched = transport.destinationBinding.snapshotCalls;
  transport.directory.mode = 'denied';
  assert.equal((await post(transport.destination, path, status, credential)).status, 409);
  transport.directory.mode = 'corrupt';
  assert.equal((await post(transport.destination, path, status, credential)).status, 503);
  assert.equal(transport.destinationBinding.snapshotCalls, dispatched);
  transport.directory.mode = 'accepted';
  assert.equal((await accepted(transport.destination, path, status, credential)).kind, 'prepared');
  assert.notEqual((await post(destination, path, { operation: 'activate', receipt }, credential)).status, 200);
  assert.notEqual((await post(destination, path, verify, credential)).status, 200);
  assert.notEqual((await post(destination, path, { operation: 'import', receipt, segment: segments[1] }, credential)).status, 200);
  assert.equal((await accepted(transport.destination, path, status, credential)).next_segment, 0);
  const changed = structuredClone(receipt);
  changed.source.request_digest_hex = 'cd'.repeat(32);
  assert.notEqual((await post(destination, path, { ...status, receipt: changed }, credential)).status, 200);
  const corruptPair = corruptFinalPairPart(segments, records);
  const namespace = await topology.getDurableObjectNamespace(`DERIVER_${role.toUpperCase()}_WALLET_DO`, workerName);
  const id = namespace.idFromName(`${receipt.source_object}/generation/${receipt.source.destination_generation}`);
  const object = namespace.get(id);
  const acknowledgements = [];
  for (const segment of segments) {
    const command = { operation: 'import', receipt, segment };
    if (segment.segment_index === corruptPair.segment_index) {
      const bad = await post(destination, path, { ...command, segment: corruptPair }, credential);
      assert.notEqual(bad.status, 200);

      assert.equal((await accepted(transport.destination, path, status, credential)).next_segment, segment.segment_index);
      await topology.unsafeEvictDurableObject(`deriver-${role}`, `RouterAbDeriver${role.toUpperCase()}WalletDurableObject`, { id: id.toString() });
      assert.equal((await accepted(transport.destination, path, status, credential)).next_segment, segment.segment_index);
    }
    if (segment.segment_index + 1 === receipt.segment_count) {
      const bytes = segmentBytes(segment);
      bytes[bytes.length - 2] ^= 1;
      const bad = await post(destination, path, { ...command, segment: { ...segment, data_b64u: bytes.toString('base64url') } }, credential);
      assert.notEqual(bad.status, 200);

      assert.equal((await accepted(transport.destination, path, status, credential)).next_segment, segment.segment_index);
    }
    const acknowledgement = await accepted(transport.destination, path, command, credential);
    assert.equal(acknowledgement.kind, 'imported');
    assert.equal(acknowledgement.segment_index, segment.segment_index);
    acknowledgements.push(acknowledgement);
    if (segment.segment_index === 0) {
      await topology.unsafeEvictDurableObject(`deriver-${role}`, `RouterAbDeriver${role.toUpperCase()}WalletDurableObject`, { id: id.toString() });
      assert.deepEqual(await accepted(transport.destination, path, command, credential), acknowledgement);
      const changedSegment = { ...segment, data_b64u: Buffer.alloc(segmentBytes(segment).length).toString('base64url') };
      assert.notEqual((await post(destination, path, { ...command, segment: changedSegment }, credential)).status, 200);
      assert.notEqual((await post(destination, path, verify, credential)).status, 200);
    }
  }
  assert.equal((await accepted(transport.destination, path, status, credential)).kind, 'received');
  const verified = await accepted(transport.destination, path, verify, credential);
  assert.deepEqual(verified, { kind: 'verified', receipt });
  await topology.unsafeEvictDurableObject(`deriver-${role}`, `RouterAbDeriver${role.toUpperCase()}WalletDurableObject`, { id: id.toString() });
  assert.deepEqual(await accepted(transport.destination, path, verify, credential), verified);
  for (const segment of segments) {
    assert.deepEqual(await accepted(transport.destination, path, { operation: 'import', receipt, segment }, credential), acknowledgements[segment.segment_index]);
  }
  const pair = preparation.request.pair_binding;
  const read = role === 'a'
    ? { operation: 'read', owner: receipt.source.owner, pair_binding: pair }
    : { scope: { wallet_home: preparation.request.tenant_root.wallet_home, ownership_generation: receipt.source.destination_generation, root_identity: rootIdentity, pair_binding: pair }, command: {
      command: 'read_pair_status', session: pair.ceremony.binding.session_id, pair_digest: pair.pair_digest.bytes,
    } };
  const sourceNamespace = await topology.getDurableObjectNamespace(`DERIVER_${role.toUpperCase()}_WALLET_DO`, `deriver-${role}`);
  const sourceObject = sourceNamespace.get(sourceNamespace.idFromName(receipt.source_object));
  const pairPath = `/router-ab/internal/deriver-${role}/wallet-pair`;
  const sourceRead = role === 'a' ? read : {
    scope: { ...read.scope, ownership_generation: receipt.source.source_generation },
    command: read.command,
  };
  assert.deepEqual(await accepted(object, pairPath, read, credential), await accepted(sourceObject, pairPath, sourceRead, credential));
  const mutation = role === 'a'
    ? { operation: 'expire', owner: receipt.source.owner, pair_binding: pair, now_ms: preparation.expiresAtMs + 1 }
    : { scope: read.scope, command: { command: 'fail_pair', pair_binding: pair } };
  await assert.rejects(post(object, pairPath, mutation, credential), /destination is reserved/u);
  const prepare = await accepted(destination, `/router-ab/internal/deriver-${role}/wallet/prepare-relocation`, receipt.source, credential);
  assert.equal(prepare.kind, 'prepared');
  const activation = await verifyDeriverActivation(topology, role, receipt, segments[0], acknowledgements[0], credential, transport, rootIdentity, preparation);
  return { verified, activation, exactAcknowledgementsAfterRestart: true, corruptedCiphertextRollsBack: true,
    finalDigestFailureRollsBack: true, incompleteAndOutOfOrderRejected: true,
    ordinaryReadersMatchSource: true, destinationInactiveUntilActivation: true,
    destinationCommandsUseAuthorizedRuntime: true };
}
