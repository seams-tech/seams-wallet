import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { EcdsaRoleLocalPresignSessionV1 } from '../../../wasm/router_ab_ecdsa_client/pkg/router_ab_ecdsa_client.js';

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

export async function verifyLinkedImportRejection(topology, credential, sharedCredential, initialization, ecdsa, routerCredential) {
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
  const initializedTransfer = await verifyInitializedTransfer(topology, credential, initialization, ecdsa, routerCredential);
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

async function verifyInitializedTransfer(topology, credential, fixture, ecdsa, routerCredential) {
  const source = await topology.getWorker('router');
  const destinationName = 'fixture-signing-worker-after-refresh';
  const destination = await topology.getWorker(destinationName);
  const initialization = structuredClone(fixture);
  const clientPublicKey = Buffer.from(ecdsa.activation.ecdsa_activation.public_identity.derivation_client_share_public_key33_b64u, 'base64url');
  const serverPublicKey = secp256k1.getPublicKey(Buffer.from(initialization.relayer_share32_b64u, 'base64url'));
  const groupPublicKey = secp256k1.ProjectivePoint.fromHex(clientPublicKey)
    .add(secp256k1.ProjectivePoint.fromHex(serverPublicKey)).toRawBytes(true);
  initialization.request.request.scope.thresholdPublicKey33B64u = Buffer.from(groupPublicKey).toString('base64url');
  initialization.request.request.scope.targetHolderPublicCommitmentB64u = clientPublicKey.toString('base64url');
  initialization.request.request.scope.targetServerPublicCommitmentB64u = Buffer.from(serverPublicKey).toString('base64url');
  initialization.request.material_source.group_public_key = Buffer.from(groupPublicKey).toString('base64url');
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
  await rejected(source, fencePath, command, routerCredential, /requires its source wallet move/);
  const after = await topology.listDurableObjectIds(objectClass, workerName);
  const created = after.filter(isNewObject.bind(undefined, before));
  assert.equal(created.length, 1);
  const namespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_PRESIGN_SESSION_DO', workerName);
  const session = namespace.get(namespace.idFromString(created[0]));
  const initPath = '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/init';
  const initialProgress = await accepted(session, initPath, initialization, credential);
  await rejected(source, fencePath, command, routerCredential, /requires its source wallet move/);
  const completed = await completeLinkedPresign(session, credential, initialization, initialProgress, ecdsa.finalized.stateBlob.stateBlobB64u, groupPublicKey);
  const walletsAfter = await topology.listDurableObjectIds(walletClass, workerName);
  const walletsCreated = walletsAfter.filter(isNewObject.bind(undefined, walletsBefore));
  assert.equal(walletsCreated.length, 0);
  const walletNamespace = await topology.getDurableObjectNamespace(
    'SIGNING_WORKER_WALLET_DO',
    workerName,
  );
  const walletDigest = createHash('sha256')
    .update('seams/signing-worker/wallet-do/v1')
    .update(JSON.stringify(command.wallet_scope))
    .digest('hex');
  const walletIdentity = walletNamespace.idFromName(`signing-worker-wallet-${walletDigest}`);
  const walletId = walletIdentity.toString();
  assert.ok(walletsBefore.includes(walletId), 'The source wallet must already own execution');
  const wallet = walletNamespace.get(walletIdentity);
  const pending = structuredClone(initialization);
  pending.request.presign_session_id += '-pending';
  pending.request.request.client_presignature_id += '-pending';
  await accepted(
    wallet,
    '/router-ab/internal/signing-worker/wallet',
    {
      command: 'register_linked_presign_session',
      ...pending.request,
    },
    credential,
  );
  const drainingWallet = await accepted(
    source,
    '/router-ab/signing-worker/wallet/pool/freeze',
    {
      scope: command.wallet_scope,
      request: command.request,
    },
    routerCredential,
  );
  assert.deepEqual(drainingWallet, {
    state: 'draining',
    pending_effects: 0,
    pending_linked_sessions: 2,
  });
  const drainingInventory = await accepted(
    source,
    '/router-ab/signing-worker/wallet/linked-presign-inventory',
    {
      scope: command.wallet_scope,
      request: command.request,
      cursor: { kind: 'start' },
      limit: 2,
    },
    routerCredential,
  );
  assert.equal(drainingInventory.sessions.length, 2);
  const changedMove = structuredClone(command);
  changedMove.request.source_generation += 1;
  await rejected(source, fencePath, changedMove, routerCredential, /requires its source wallet move/);
  const terminalRace = await verifyTerminalFenceRace(source, session, credential, routerCredential, command, completed);
  assert.equal(terminalRace.fence.initialization.state, 'initialized');
  await rejected(session, initPath, initialization, credential, /fenced for relocation/);
  await rejected(session, '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/step', completed.terminalStep, credential, /fenced for relocation/);
  const receipt = await accepted(source, freezePath, command, routerCredential);
  assert.equal(receipt.record_count, 2);
  assert.deepEqual(
    await accepted(
      source,
      '/router-ab/signing-worker/wallet/pool/freeze',
      {
        scope: command.wallet_scope,
        request: command.request,
      },
      routerCredential,
    ),
    { state: 'draining', pending_effects: 0, pending_linked_sessions: 1 },
  );
  await topology.unsafeEvictDurableObject(workerName, walletClass, { id: walletId });
  assert.deepEqual(
    await accepted(
      source,
      '/router-ab/signing-worker/wallet/pool/freeze',
      {
        scope: command.wallet_scope,
        request: command.request,
      },
      routerCredential,
    ),
    { state: 'draining', pending_effects: 0, pending_linked_sessions: 1 },
  );
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  assert.deepEqual(await accepted(source, freezePath, command, routerCredential), receipt);
  const chunkBytes = 1024;
  await accepted(destination, transferPath, { kind: 'prepare', command, chunk_bytes: chunkBytes }, credential);
  const first = await accepted(source, exportPath, { receipt, segment_index: 0, chunk_bytes: chunkBytes }, routerCredential);
  const chunks = [];
  for (let index = 0; index < first.segment_count; index += 1) {
    const chunk = index === 0 ? first : await accepted(source, exportPath, { receipt, segment_index: index, chunk_bytes: chunkBytes }, routerCredential);
    chunks.push(Buffer.from(chunk.data_b64u, 'base64url'));
    await accepted(destination, transferPath, { kind: 'import', chunk }, credential);
  }
  const snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(snapshot.state, 'initialized');
  assert.deepEqual(snapshot.authority, initialization.request);
  assert.equal(snapshot.completion.state, 'retired');
  assert.equal(snapshot.completion.completion.retirement.reason, 'wallet_relocated');
  assert.deepEqual(snapshot.completion.completion.response, completed.response);
  const consumePath = '/router-ab/internal/signing-worker/linked-ecdsa-presignature/consume';
  const delayedConsume = {
    server_presignature_id: command.server_presignature_id,
    scope_digest: snapshot.completion.completion.scope_digest,
    request_digest: completed.response.prepared_response.request_digest,
    signing_digest: completed.response.prepared_response.signing_digest,
    now_unix_ms: completed.response.prepared_response.prepared_at_ms,
  };
  await rejected(session, consumePath, delayedConsume, credential, /fenced for relocation/);
  assert.deepEqual(await accepted(source, exportPath, { receipt, segment_index: 0, chunk_bytes: chunkBytes }, routerCredential), first);

  const verified = await accepted(destination, transferPath, { kind: 'verify', receipt }, credential);
  assert.deepEqual(verified, { kind: 'verified', receipt });
  const destinationIds = await topology.listDurableObjectIds(objectClass, destinationName);
  assert.equal(destinationIds.length, 1);
  await topology.unsafeEvictDurableObject(destinationName, objectClass, { id: destinationIds[0] });
  assert.deepEqual(await accepted(destination, transferPath, { kind: 'verify', receipt }, credential), verified);
  const destinationNamespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_PRESIGN_SESSION_DO', destinationName);
  const restored = destinationNamespace.get(destinationNamespace.idFromString(destinationIds[0]));
  await rejected(restored, initPath, initialization, credential, /fenced for relocation/);
  await rejected(restored, consumePath, delayedConsume, credential, /fenced for relocation/);
  await rejected(
    restored,
    '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/step',
    completed.terminalStep,
    credential,
    /fenced for relocation/,
  );
  const pendingRegistration = await verifyPendingRegistration(
    topology,
    credential,
    pending,
    command.request,
  );
  const walletFreeze = await accepted(
    source,
    '/router-ab/signing-worker/wallet/pool/freeze',
    {
      scope: command.wallet_scope,
      request: command.request,
    },
    routerCredential,
  );
  assert.equal(walletFreeze.state, 'frozen');
  assert.deepEqual(await accepted(source, freezePath, command, routerCredential), receipt);
  const walletInventory = await verifyWalletInventoryTransfer(
    topology,
    credential,
    walletFreeze.receipt,
    [initialization.request, pending.request],
  );
  return {
    scope:
      'Production presign completion, wallet registration, freeze and role-to-role import; excludes full device linking and concurrent consumption',
    sourceSessionCommandsUseAuthenticatedRouter: true,
    walletWaitsForBothSessionAcknowledgements: true,
    partialAcknowledgementSurvivesWalletEviction: true,
    inventoryAvailableDuringDraining: true,
    completedPresignatureRetired: true,
    initializedFenceRequiresExactWalletMove: true,
    terminalReplayFenceRace: terminalRace.outcome,
    delayedConsumptionRejectedAtBothHomes: true,
    sourceExportUnchangedAfterDelayedConsumption: true,
    delayedTerminalStepRejectedAtBothHomes: true,
    initializedAuthorityPreserved: true,
    sourceFreezeReplayedAfterEviction: true,
    destinationVerificationReplayedAfterEviction: true,
    delayedInitializationRejectedAtBothHomes: true,
    segments: first.segment_count,
    pendingRegistration,
    walletInventory,
  };
}

async function verifyTerminalFenceRace(source, session, credential, routerCredential, command, completed) {
  const [terminalResponse, fenceResponse] = await Promise.all([
    post(session, '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/step', completed.terminalStep, credential),
    post(source, '/router-ab/signing-worker/linked-presign-session/fence', command, routerCredential),
  ]);
  const fenceBody = await fenceResponse.text();
  assert.equal(fenceResponse.ok, true, fenceBody);
  const terminalBody = await terminalResponse.text();
  let outcome;
  if (terminalResponse.ok) {
    assert.deepEqual(JSON.parse(terminalBody), completed.response);
    outcome = 'Exact terminal replay returned while the local fence committed';
  } else {
    assert.match(terminalBody, /fenced for relocation|closed ECDSA pool admission/);
    outcome = 'Terminal replay rejected while the local fence committed';
  }
  return { fence: JSON.parse(fenceBody), outcome };
}

function relocationIdentity(request) {
  return { move_id: request.move_id, source_generation: request.source_generation };
}

async function transferWalletSnapshot(source, destination, credential, receipt) {
  const transfer = '/router-ab/signing-worker/wallet/ecdsa/transfer';
  const exportSnapshot = '/router-ab/signing-worker/wallet/ecdsa/export';
  const chunkBytes = 256;
  const preparation = {
    kind: 'prepare',
    scope: receipt.scope,
    request: relocationIdentity(receipt.request),
    chunk_bytes: chunkBytes,
  };
  const prepared = await accepted(destination, transfer, preparation, credential);
  assert.deepEqual(await accepted(destination, transfer, preparation, credential), prepared);
  const first = await accepted(
    source,
    exportSnapshot,
    { receipt, segment_index: 0, chunk_bytes: chunkBytes },
    credential,
  );
  const pieces = [];
  for (let index = 0; index < first.segment_count; index += 1) {
    const chunk =
      index === 0
        ? first
        : await accepted(
            source,
            exportSnapshot,
            { receipt, segment_index: index, chunk_bytes: chunkBytes },
            credential,
          );
    pieces.push(Buffer.from(chunk.data_b64u, 'base64url'));
    const acknowledgement = await accepted(
      destination,
      transfer,
      { kind: 'import', chunk },
      credential,
    );
    assert.deepEqual(
      await accepted(destination, transfer, { kind: 'import', chunk }, credential),
      acknowledgement,
    );
    if (index === 0) {
      const changed = structuredClone(chunk);
      changed.receipt.request.invalidated_at_ms += 1;
      await rejected(destination, transfer, { kind: 'import', chunk: changed }, credential,
        /inputs changed/);
    }
  }
  const [scope, move, snapshot] = JSON.parse(Buffer.concat(pieces).toString('utf8'));
  assert.deepEqual(scope, receipt.scope);
  assert.deepEqual(move, receipt.request);
  return { snapshot, first };
}

async function verifyWalletInventoryTransfer(topology, credential, receipt, requests) {
  const source = await topology.getWorker(workerName);
  const destinationName = 'fixture-signing-worker-after-refresh';
  const destination = await topology.getWorker(destinationName);
  const walletClass = 'RouterAbSigningWorkerWalletDurableObject';
  const before = await topology.listDurableObjectIds(walletClass, destinationName);
  const transfer = '/router-ab/signing-worker/wallet/ecdsa/transfer';
  const { snapshot, first } = await transferWalletSnapshot(source, destination, credential, receipt);
  assert.ok(receipt.record_count > requests.length);
  assert.equal(snapshot.activations.length, 1);
  assert.equal(snapshot.linked_presign_sessions.length, requests.length);
  const inventoryPath = '/router-ab/signing-worker/wallet/linked-presign-inventory';
  const firstPageRequest = {
    scope: receipt.scope,
    request: receipt.request,
    cursor: { kind: 'start' },
    limit: 1,
  };
  const firstPage = await accepted(source, inventoryPath, firstPageRequest, credential);
  assert.equal(firstPage.state, 'more');
  assert.equal(firstPage.sessions.length, 1);
  assert.deepEqual(await accepted(source, inventoryPath, firstPageRequest, credential), firstPage);
  const lastPage = await accepted(
    source,
    inventoryPath,
    {
      scope: receipt.scope,
      request: receipt.request,
      cursor: { kind: 'after', presign_session_id: firstPage.next_presign_session_id },
      limit: 1,
    },
    credential,
  );
  assert.equal(lastPage.state, 'complete');
  assert.equal(lastPage.sessions.length, 1);
  const inventory = [...firstPage.sessions, ...lastPage.sessions];
  assert.deepEqual(inventory, snapshot.linked_presign_sessions.map(inventoryIdentity));
  const changedMove = structuredClone(receipt.request);
  changedMove.invalidated_at_ms += 1;
  await rejected(
    source,
    inventoryPath,
    { scope: receipt.scope, request: changedMove, cursor: { kind: 'start' }, limit: 1 },
    credential,
    /requires its source wallet move/,
  );
  await rejected(
    source,
    inventoryPath,
    { scope: receipt.scope, request: receipt.request, cursor: { kind: 'start' }, limit: 0 },
    credential,
    /limit must be/,
  );
  for (const request of requests) {
    const row = snapshot.linked_presign_sessions.find(matchesSession.bind(undefined, request.presign_session_id));
    assert.ok(row, 'Every registered session must remain discoverable');
    assert.equal(row.server_presignature_id, request.request.client_presignature_id);
    assert.equal(row.ownership_generation, receipt.request.source_generation);
    assert.deepEqual(JSON.parse(row.owner_json), request.wallet_scope);
  }
  const verification = { kind: 'verify', receipt };
  const verified = await accepted(destination, transfer, verification, credential);
  assert.deepEqual(verified, { kind: 'verified', receipt });
  const after = await topology.listDurableObjectIds(walletClass, destinationName);
  const created = after.filter(isNewObject.bind(undefined, before));
  assert.equal(created.length, 1);
  await topology.unsafeEvictDurableObject(destinationName, walletClass, { id: created[0] });
  assert.deepEqual(await accepted(destination, transfer, verification, credential), verified);
  const namespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_WALLET_DO', destinationName);
  const wallet = namespace.get(namespace.idFromString(created[0]));
  const admission = await accepted(wallet, '/router-ab/internal/signing-worker/wallet', {
    command: 'check_ecdsa_pool_admission', scope: receipt.scope,
  }, credential);
  assert.equal(admission, 'closed');
  return {
    sourceFreezeReceipt: receipt,
    registeredSessions: requests.length,
    segments: first.segment_count,
    initializedAndPendingIdentitiesTransferred: true,
    chunkAcknowledgementsReplayed: true,
    verifiedInventorySurvivedEviction: true,
    destinationAdmissionRemainsClosed: true,
    frozenInventoryPagesMatchSnapshot: true,
    changedInventoryMoveRejected: true,
  };
}

function inventoryIdentity(row) {
  return {
    presign_session_id: row.presign_session_id,
    server_presignature_id: row.server_presignature_id,
    request_digest_hex: row.request_digest_hex,
  };
}

function matchesSession(sessionId, row) {
  return row.presign_session_id === sessionId;
}

async function completeLinkedPresign(session, credential, initialization, initialProgress, stateBlob, groupPublicKey) {
  const client = new EcdsaRoleLocalPresignSessionV1(stateBlob, groupPublicKey, initialization.request.presign_session_id);
  try {
    let progress = initialProgress;
    let outgoing = client.poll().outgoing.map(base64urlMessage);
    for (let round = 0; progress.kind !== 'complete' && round < 12; round += 1) {
      for (const message of progress.outgoing_messages_b64u) {
        client.message(Buffer.from(message, 'base64url'));
        if (client.stage() === 'triples_done') client.start_presign();
      }
      if (progress.outgoing_messages_b64u.length > 0) outgoing.push(...client.poll().outgoing.map(base64urlMessage));
      const step = {
        wallet_scope: initialization.request.wallet_scope,
        request: initialization.request.request,
        material_source: initialization.request.material_source,
        presign_session_id: initialization.request.presign_session_id,
        requested_stage: progress.stage,
        outgoing_messages_b64u: outgoing,
        expires_at_ms: initialization.request.expires_at_ms,
      };
      progress = await accepted(session, '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/step', step, credential);
      outgoing = [];
      if (progress.kind === 'complete') {
        assert.equal(progress.server_big_r33_b64u, Buffer.from(client.presignature_big_r_33()).toString('base64url'));
        return { response: progress, terminalStep: step };
      }
    }
    throw new Error('Linked presigning did not complete within twelve exchanges');
  } catch (error) {
    throw new Error(`Linked presign driver failed at client stage ${client.stage()}: ${String(error)}`, { cause: error });
  } finally {
    client.free();
  }
}

function base64urlMessage(bytes) {
  return Buffer.from(bytes).toString('base64url');
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
    schedule: 'Registration commits; wallet drains; session fences; delayed initialization arrives',
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

async function activateTransferredWallet(topology, credential, receipt, destinationName) {
  const destination = await topology.getWorker(destinationName);
  const path = '/router-ab/signing-worker/wallet/ecdsa/transfer';
  const command = { kind: 'activate', receipt };
  const activated = await accepted(destination, path, command, credential);
  assert.deepEqual(activated, { kind: 'activated', receipt });
  await evictTransferredWallet(topology, destinationName, receipt.scope);
  assert.deepEqual(await accepted(destination, path, command, credential), activated);
}

export async function cleanupTransferredWalletSource(topology, credential, receipt, sourceName) {
  const source = await topology.getWorker(sourceName);
  const path = '/router-ab/signing-worker/wallet/ecdsa/transfer';
  const command = { kind: 'cleanup', activation: receipt };
  for (let attempt = 1; attempt <= 64; attempt += 1) {
    const result = await accepted(source, path, command, credential);
    if (result.kind === 'cleaned') {
      assert.deepEqual(await accepted(source, path, command, credential), result);
      return { boundedCalls: attempt, exactCompletionReplay: true };
    }
    assert.equal(result.kind, 'cleaning');
  }
  assert.fail('Source cleanup did not finish within 64 bounded calls');
}

export async function evictTransferredWallet(topology, name, scope) {
  const namespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_WALLET_DO', name);
  const digest = createHash('sha256')
    .update('seams/signing-worker/wallet-do/v1')
    .update(JSON.stringify(scope))
    .digest('hex');
  const id = namespace.idFromName(`signing-worker-wallet-${digest}`).toString();
  const walletClass = 'RouterAbSigningWorkerWalletDurableObject';
  const ids = await topology.listDurableObjectIds(walletClass, name);
  assert.ok(ids.includes(id), 'The scoped wallet must already exist before eviction');
  await topology.unsafeEvictDurableObject(name, walletClass, { id });
}

export async function returnTransferredWallet(topology, credential, previousReceipt) {
  const sourceName = 'fixture-signing-worker-after-refresh';
  const destinationName = 'fixture-signing-worker';
  const source = await topology.getWorker(sourceName);
  const destination = await topology.getWorker(destinationName);
  const scope = previousReceipt.scope;
  const request = {
    move_id: `wmove_${randomBytes(32).toString('base64url')}`,
    source_generation: previousReceipt.request.source_generation + 1,
    invalidated_at_ms: Date.now(),
  };
  const transfer = '/router-ab/signing-worker/wallet/ecdsa/transfer';
  const preparation = { kind: 'prepare', scope, request: relocationIdentity(request), chunk_bytes: 256 };
  const prepared = await accepted(destination, transfer, preparation, credential);
  assert.deepEqual(await accepted(destination, transfer, preparation, credential), prepared);
  request.invalidated_at_ms = Date.now();
  const freeze = { scope, request };
  const frozen = await accepted(
    source,
    '/router-ab/signing-worker/wallet/pool/freeze',
    freeze,
    credential,
  );
  assert.equal(frozen.state, 'frozen', 'Imported historical sessions must not block the next move');
  await evictTransferredWallet(topology, sourceName, scope);
  assert.deepEqual(
    await accepted(source, '/router-ab/signing-worker/wallet/pool/freeze', freeze, credential),
    frozen,
  );
  const { snapshot, first } = await transferWalletSnapshot(
    source,
    destination,
    credential,
    frozen.receipt,
  );
  assert.equal(snapshot.linked_presign_sessions.length, 2);
  for (const session of snapshot.linked_presign_sessions) {
    assert.equal(session.ownership_generation, previousReceipt.request.source_generation);
  }
  const verification = { kind: 'verify', receipt: frozen.receipt };
  const verified = await accepted(destination, transfer, verification, credential);
  assert.deepEqual(verified, { kind: 'verified', receipt: frozen.receipt });
  await evictTransferredWallet(topology, destinationName, scope);
  assert.deepEqual(await accepted(destination, transfer, verification, credential), verified);
  await activateTransferredWallet(topology, credential, frozen.receipt, destinationName);
  assert.deepEqual(
    await accepted(destination, transfer, { kind: 'cleanup', activation: previousReceipt }, credential),
    { kind: 'cleaned', receipt: previousReceipt },
    'Delayed cleanup of the first move must only replay its historical result',
  );
  const changedCleanup = structuredClone(previousReceipt);
  changedCleanup.wallet_records_digest_hex = '0'.repeat(64);
  await rejected(destination, transfer, { kind: 'cleanup', activation: changedCleanup }, credential,
    /completed cleanup receipt changed/);

  return { receipt: frozen.receipt, segments: first.segment_count, preparationWithoutInvalidationTime: true };
}
