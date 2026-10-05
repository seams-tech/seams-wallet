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
  };
}

function isNewObject(previous, id) {
  return !previous.includes(id);
}
