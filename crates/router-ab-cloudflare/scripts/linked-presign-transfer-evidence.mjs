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

export async function verifyLinkedImportRejection(topology, credential, sharedCredential, initialization) {
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
  const initializedTransfer = await verifyInitializedTransfer(topology, credential, initialization);
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
    initializedTransfer,
  };
}

async function verifyInitializedTransfer(topology, credential, fixture) {
  const source = await topology.getWorker(workerName);
  const destinationName = 'fixture-signing-worker-after-refresh';
  const destination = await topology.getWorker(destinationName);
  const initialization = structuredClone(fixture);
  initialization.request.expires_at_ms = Date.now() + 120_000;
  initialization.request.request.expires_at_ms = initialization.request.expires_at_ms;
  const command = {
    wallet_scope: initialization.request.wallet_scope,
    presign_session_id: initialization.request.presign_session_id,
    server_presignature_id: initialization.request.request.client_presignature_id,
    request: {
      move_id: `wmove_${randomBytes(32).toString('base64url')}`,
      source_generation: 1,
      invalidated_at_ms: Date.now(),
    },
  };
  const fencePath = '/router-ab/signing-worker/linked-presign-session/fence';
  const walletClass = 'RouterAbSigningWorkerWalletDurableObject';
  const walletsBefore = await topology.listDurableObjectIds(walletClass, workerName);
  const before = await topology.listDurableObjectIds(objectClass, workerName);
  await rejected(source, fencePath, command, credential, /requires its source wallet move/);
  const after = await topology.listDurableObjectIds(objectClass, workerName);
  const created = after.filter(isNewObject.bind(undefined, before));
  assert.equal(created.length, 1);
  const namespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_PRESIGN_SESSION_DO', workerName);
  const session = namespace.get(namespace.idFromString(created[0]));
  const initPath = '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/init';
  await accepted(session, initPath, initialization, credential);
  const walletsAfter = await topology.listDurableObjectIds(walletClass, workerName);
  const walletsCreated = walletsAfter.filter(isNewObject.bind(undefined, walletsBefore));
  assert.equal(walletsCreated.length, 1);
  const walletNamespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_WALLET_DO', workerName);
  const wallet = walletNamespace.get(walletNamespace.idFromString(walletsCreated[0]));
  const pending = structuredClone(initialization);
  pending.request.presign_session_id += '-pending';
  pending.request.request.client_presignature_id += '-pending';
  await accepted(wallet, '/router-ab/internal/signing-worker/wallet', {
    command: 'register_linked_presign_session', ...pending.request,
  }, credential);
  const walletFreeze = await accepted(source, '/router-ab/signing-worker/wallet/pool/freeze', {
    scope: command.wallet_scope, request: command.request,
  }, credential);
  assert.equal(walletFreeze.state, 'frozen');
  const fence = await accepted(source, fencePath, command, credential);
  assert.equal(fence.initialization.state, 'initialized');
  await rejected(session, initPath, initialization, credential, /fenced for relocation/);
  const receipt = await accepted(source, freezePath, command, credential);
  assert.equal(receipt.record_count, 1);
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  assert.deepEqual(await accepted(source, freezePath, command, credential), receipt);
  const chunkBytes = 1024;
  await accepted(destination, transferPath, { kind: 'prepare', command, chunk_bytes: chunkBytes }, credential);
  const first = await accepted(source, exportPath, { receipt, segment_index: 0, chunk_bytes: chunkBytes }, credential);
  const chunks = [];
  for (let index = 0; index < first.segment_count; index += 1) {
    const chunk = index === 0 ? first : await accepted(source, exportPath, { receipt, segment_index: index, chunk_bytes: chunkBytes }, credential);
    chunks.push(Buffer.from(chunk.data_b64u, 'base64url'));
    await accepted(destination, transferPath, { kind: 'import', chunk }, credential);
  }
  const snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(snapshot.state, 'initialized');
  assert.deepEqual(snapshot.authority, initialization.request);
  assert.equal(snapshot.completion.state, 'no_stored_completion');
  const verified = await accepted(destination, transferPath, { kind: 'verify', receipt }, credential);
  assert.deepEqual(verified, { kind: 'verified', receipt });
  const destinationIds = await topology.listDurableObjectIds(objectClass, destinationName);
  assert.equal(destinationIds.length, 1);
  await topology.unsafeEvictDurableObject(destinationName, objectClass, { id: destinationIds[0] });
  assert.deepEqual(await accepted(destination, transferPath, { kind: 'verify', receipt }, credential), verified);
  const destinationNamespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_PRESIGN_SESSION_DO', destinationName);
  const restored = destinationNamespace.get(destinationNamespace.idFromString(destinationIds[0]));
  await rejected(restored, initPath, initialization, credential, /fenced for relocation/);
  const pendingRegistration = await verifyPendingRegistration(topology, credential, pending, command.request);
  return {
    scope: 'Production session initialization, wallet registration, freeze and role-to-role import; excludes completed presignature retirement and full device linking',
    initializedAuthorityPreserved: true,
    sourceFreezeReplayedAfterEviction: true,
    destinationVerificationReplayedAfterEviction: true,
    delayedInitializationRejectedAtBothHomes: true,
    segments: first.segment_count,
    pendingRegistration,
  };
}

async function verifyPendingRegistration(topology, credential, initialization, move) {
  const source = await topology.getWorker(workerName);
  const command = {
    wallet_scope: initialization.request.wallet_scope,
    presign_session_id: initialization.request.presign_session_id,
    server_presignature_id: initialization.request.request.client_presignature_id,
    request: move,
  };
  const fencePath = '/router-ab/signing-worker/linked-presign-session/fence';
  const before = await topology.listDurableObjectIds(objectClass, workerName);
  const wrongMove = structuredClone(command);
  wrongMove.request.source_generation += 1;
  await rejected(source, fencePath, wrongMove, credential, /requires its source wallet move/);
  const fence = await accepted(source, fencePath, command, credential);
  assert.equal(fence.initialization.state, 'registered');
  const after = await topology.listDurableObjectIds(objectClass, workerName);
  const created = after.filter(isNewObject.bind(undefined, before));
  assert.equal(created.length, 1);
  const namespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_PRESIGN_SESSION_DO', workerName);
  const session = namespace.get(namespace.idFromString(created[0]));
  await rejected(session, '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/init', initialization, credential, /fenced for relocation/);
  const receipt = await accepted(source, freezePath, command, credential);
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  assert.deepEqual(await accepted(source, fencePath, command, credential), fence);
  assert.deepEqual(await accepted(source, freezePath, command, credential), receipt);
  const chunk = await accepted(source, exportPath, { receipt, segment_index: 0, chunk_bytes: 65536 }, credential);
  assert.equal(chunk.segment_count, 1);
  const snapshot = JSON.parse(Buffer.from(chunk.data_b64u, 'base64url').toString('utf8'));
  assert.equal(snapshot.state, 'uninitialized');
  assert.equal(snapshot.request_digest_hex, fence.initialization.request_digest_hex);
  const destination = await topology.getWorker('fixture-signing-worker-after-refresh');
  await accepted(destination, transferPath, { kind: 'prepare', command, chunk_bytes: 65536 }, credential);
  await accepted(destination, transferPath, { kind: 'import', chunk }, credential);
  assert.deepEqual(await accepted(destination, transferPath, { kind: 'verify', receipt }, credential), { kind: 'verified', receipt });
  return {
    schedule: 'Registration commits; wallet freezes; session fences; delayed initialization arrives',
    wrongMoveRejected: true,
    delayedInitializationRejected: true,
    fenceAndFreezeReplayedAfterEviction: true,
    registeredDigestTransferredWithoutAuthority: true,
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
