import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const transferPath = '/router-ab/signing-worker/linked-presign-session/transfer';
const freezePath = '/router-ab/signing-worker/linked-presign-session/freeze';
const exportPath = '/router-ab/signing-worker/linked-presign-session/export';
const objectClass = 'RouterAbSigningWorkerPresignSessionDurableObject';
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
  assert.equal(response.ok, true, text);
  return JSON.parse(text);
}

async function rejected(worker, path, body, credential, message) {
  const response = await post(worker, path, body, credential);
  const text = await response.text();
  assert.equal(response.ok, false, `Unexpected acceptance: ${text}`);
  assert.match(text, message);
}

export async function verifyLinkedImportRejection(topology, credential, sharedCredential) {
  const worker = await topology.getWorker(workerName);
  const before = await topology.listDurableObjectIds(objectClass, workerName);
  const command = {
    wallet_scope: {
      org_id: 'org-miniflare',
      project_id: 'project-r120',
      project_environment_id: 'project-environment-miniflare',
      wallet_id: 'wallet-linked-import-rejection',
    },
    presign_session_id: `linked-import-${randomBytes(16).toString('hex')}`,
    server_presignature_id: `linked-server-${randomBytes(16).toString('hex')}`,
    request: {
      move_id: `wmove_${randomBytes(32).toString('base64url')}`,
      source_generation: 1,
      invalidated_at_ms: Date.now(),
    },
  };
  const preparation = { kind: 'prepare', command, chunk_bytes: 1 };
  const denied = await post(worker, transferPath, preparation, sharedCredential);
  assert.equal(denied.status, 403);
  const prepared = await accepted(worker, transferPath, preparation, credential);
  assert.deepEqual(prepared, { kind: 'prepared', command, chunk_bytes: 1 });
  assert.deepEqual(await accepted(worker, transferPath, preparation, credential), prepared);
  await rejected(worker, transferPath, { ...preparation, chunk_bytes: 2 }, credential, /preparation changed/);

  // Complete transport of invalid history must never produce a verified destination.
  const bytes = Buffer.from('{}');
  const receipt = {
    command,
    records_digest_hex: createHash('sha256')
      .update('seams/signing-worker/linked-presign-snapshot/v1')
      .update(bytes)
      .digest('hex'),
    record_count: 1,
  };
  const first = {
    receipt, segment_index: 0, segment_count: 2, chunk_bytes: 1,
    data_b64u: bytes.subarray(0, 1).toString('base64url'),
  };
  const second = { ...first, segment_index: 1, data_b64u: bytes.subarray(1).toString('base64url') };
  await rejected(worker, transferPath, { kind: 'import', chunk: second }, credential, /prepared progress/);
  const acknowledgement = await accepted(worker, transferPath, { kind: 'import', chunk: first }, credential);
  await rejected(worker, transferPath, { kind: 'verify', receipt }, credential, /requires all segments/);

  const after = await topology.listDurableObjectIds(objectClass, workerName);
  const created = after.filter(isNewObject.bind(undefined, before));
  assert.equal(created.length, 1, 'Preparation must address one fresh linked session object');
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  assert.deepEqual(await accepted(worker, transferPath, { kind: 'import', chunk: first }, credential), acknowledgement);
  assert.deepEqual(await accepted(worker, transferPath, preparation, credential), prepared);
  const conflicting = { ...first, data_b64u: Buffer.from('[').toString('base64url') };
  await rejected(worker, transferPath, { kind: 'import', chunk: conflicting }, credential, /chunk changed/);
  const lastAcknowledgement = await accepted(worker, transferPath, { kind: 'import', chunk: second }, credential);
  await rejected(worker, transferPath, { kind: 'verify', receipt }, credential, /missing field/);
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  assert.deepEqual(await accepted(worker, transferPath, { kind: 'import', chunk: second }, credential), lastAcknowledgement);
  await rejected(worker, transferPath, { kind: 'verify', receipt }, credential, /missing field/);
  await rejected(worker, exportPath, { receipt, segment_index: 0, chunk_bytes: 1 }, credential, /requires a frozen snapshot/);
  await rejected(worker, freezePath, command, credential, /No such value|not found|does not exist/);
  const uninitializedImport = await verifyUninitializedImport(topology, credential, command);
  return {
    sharedCredentialRejected: true,
    exactPreparationReplayed: true,
    outOfOrderChunkRejected: true,
    incompleteImportRejected: true,
    chunkAcknowledgementSurvivedEviction: true,
    changedChunkRejected: true,
    invalidHistoryRejectedAfterCompleteTransport: true,
    failedVerificationSurvivedEviction: true,
    unverifiedSnapshotUnavailable: true,
    uninitializedImport,
  };
}

async function verifyUninitializedImport(topology, credential, previousCommand) {
  const worker = await topology.getWorker(workerName);
  const before = await topology.listDurableObjectIds(objectClass, workerName);
  const command = structuredClone(previousCommand);
  command.presign_session_id = `uninitialized-${randomBytes(16).toString('hex')}`;
  command.server_presignature_id = `uninitialized-server-${randomBytes(16).toString('hex')}`;
  const bytes = Buffer.from(JSON.stringify({
    state: 'uninitialized', command,
    request_digest_hex: createHash('sha256').update('registered initialization').digest('hex'),
  }));
  const receipt = {
    command,
    records_digest_hex: createHash('sha256').update('seams/signing-worker/linked-presign-snapshot/v1').update(bytes).digest('hex'),
    record_count: 1,
  };
  const chunkBytes = 256;
  const segmentCount = Math.ceil(bytes.length / chunkBytes);
  await accepted(worker, transferPath, { kind: 'prepare', command, chunk_bytes: chunkBytes }, credential);
  for (let index = 0; index < segmentCount; index += 1) {
    const chunk = {
      receipt, segment_index: index, segment_count: segmentCount, chunk_bytes: chunkBytes,
      data_b64u: bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes).toString('base64url'),
    };
    const acknowledgement = await accepted(worker, transferPath, { kind: 'import', chunk }, credential);
    assert.deepEqual(await accepted(worker, transferPath, { kind: 'import', chunk }, credential), acknowledgement);
  }
  const verified = await accepted(worker, transferPath, { kind: 'verify', receipt }, credential);
  assert.deepEqual(verified, { kind: 'verified', receipt });
  const after = await topology.listDurableObjectIds(objectClass, workerName);
  const created = after.filter(isNewObject.bind(undefined, before));
  assert.equal(created.length, 1);
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  assert.deepEqual(await accepted(worker, transferPath, { kind: 'verify', receipt }, credential), verified);
  const exported = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const chunk = await accepted(worker, exportPath, { receipt, segment_index: index, chunk_bytes: chunkBytes }, credential);
    assert.equal(chunk.segment_count, segmentCount);
    assert.deepEqual(chunk.receipt, receipt);
    exported.push(Buffer.from(chunk.data_b64u, 'base64url'));
  }
  assert.deepEqual(Buffer.concat(exported), bytes);
  return {
    scope: 'Production destination import with synthetic registration history; excludes source proof and initialization races',
    exactBytesRestoredAfterEviction: true,
    verificationReplayed: true,
    segments: segmentCount,
  };
}

function isNewObject(previous, id) {
  return !previous.includes(id);
}
