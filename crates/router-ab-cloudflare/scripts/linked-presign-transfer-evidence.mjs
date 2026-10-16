import { runtimeRelocationSource, runtimeRelocationDestination } from './runtime-relocation-evidence.mjs';
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

function linkedPreparation(command) {
  return {
    wallet_scope: command.wallet_scope,
    presign_session_id: command.presign_session_id,
    server_presignature_id: command.server_presignature_id,
    request: relocationIdentity(command.request),
  };
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
  const preparation = { kind: 'prepare', command: linkedPreparation(command), chunk_bytes: 1 };
  const denied = await post(worker, transferPath, preparation, sharedCredential);
  assert.equal(denied.status, 403);
  const prepared = await accepted(worker, transferPath, preparation, credential);
  assert.deepEqual(prepared, { kind: 'prepared', command: linkedPreparation(command), chunk_bytes: 1 });
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
  await rejected(worker, freezePath, command, credential, /requires its durable fence/);
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
  const chunkBytes = 4096;
  await accepted(destination, transferPath, { kind: 'prepare', command: linkedPreparation(command), chunk_bytes: chunkBytes }, credential);
  const preparedIds = (await topology.listDurableObjectIds(objectClass, workerName))
    .filter(isNewObject.bind(undefined, after));
  assert.equal(preparedIds.length, 1);
  const preparedNamespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_PRESIGN_SESSION_DO', destinationName);
  const preparedSession = preparedNamespace.get(preparedNamespace.idFromString(preparedIds[0]));
  await rejected(preparedSession, initPath, initialization, credential, /fenced for relocation/);
  const preparationInventoryPath = '/router-ab/signing-worker/wallet/linked-presign-preparation-inventory';
  const preparationInventoryRequest = {
    scope: command.wallet_scope,
    source_generation: command.request.source_generation,
    cursor: { kind: 'start' },
    limit: 1,
  };
  const beforeCompletion = await accepted(source, preparationInventoryPath, preparationInventoryRequest, routerCredential);
  assert.equal(beforeCompletion.state, 'complete');
  assert.equal(beforeCompletion.sessions.length, 1);
  assert.equal(beforeCompletion.sessions[0].presign_session_id, command.presign_session_id);
  assert.deepEqual(await accepted(source, preparationInventoryPath, {
    ...preparationInventoryRequest, source_generation: command.request.source_generation + 1,
  }, routerCredential), { state: 'complete', sessions: [] });
  assert.deepEqual(await accepted(source, preparationInventoryPath, preparationInventoryRequest, routerCredential), beforeCompletion);
  const completed = await completeLinkedPresign(session, credential, initialization, initialProgress, ecdsa.finalized.stateBlob.stateBlobB64u, groupPublicKey);
  const walletsAfter = await topology.listDurableObjectIds(walletClass, workerName);
  const walletsCreated = walletsAfter.filter(isNewObject.bind(undefined, walletsBefore));
  assert.equal(walletsCreated.length, 1, 'The next generation inventory must use a distinct wallet object');
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
  const preparationPage = await accepted(source, preparationInventoryPath, preparationInventoryRequest, routerCredential);
  assert.equal(preparationPage.state, 'more');
  assert.equal(preparationPage.sessions.length, 1);
  const preparationLastPage = await accepted(source, preparationInventoryPath, {
    ...preparationInventoryRequest,
    cursor: { kind: 'after', presign_session_id: preparationPage.next_presign_session_id },
  }, routerCredential);
  assert.equal(preparationLastPage.state, 'complete');
  assert.equal(preparationLastPage.sessions.length, 1);
  const extraRegistrations = [];
  for (let index = 0; index < 16; index += 1) {
    const extra = structuredClone(pending);
    extra.request.presign_session_id += `-${index}`;
    extra.request.request.client_presignature_id += `-${index}`;
    await accepted(wallet, '/router-ab/internal/signing-worker/wallet', {
      command: 'register_linked_presign_session', ...extra.request,
    }, credential);
    extraRegistrations.push(extra);
  }
  command.request.invalidated_at_ms = Date.now();
  const walletSource = await runtimeRelocationSource(topology, routerCredential, {
    scope: command.wallet_scope, request: command.request,
  });
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
    pending_linked_sessions: 2 + extraRegistrations.length,
  });
  const drainingInventory = await accepted(
    walletSource,
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
  await rejected(source, preparationInventoryPath, preparationInventoryRequest, routerCredential,
    /closed ECDSA pool admission/);
  const callsBeforeFence = walletSource.env.MPC_ROUTER.calls;
  walletSource.env.WALLET_CONSOLE.mode = 'denied';
  assert.equal((await post(walletSource, fencePath, command, routerCredential)).status, 409);
  walletSource.env.WALLET_CONSOLE.mode = 'corrupt';
  assert.equal((await post(walletSource, fencePath, command, routerCredential)).status, 503);
  assert.equal(walletSource.env.MPC_ROUTER.calls, callsBeforeFence);
  walletSource.env.WALLET_CONSOLE.mode = 'authorized';
  const terminalRace = await verifyTerminalFenceRace(walletSource, session, credential, routerCredential, command, completed);
  assert.equal(terminalRace.fence.initialization.state, 'initialized');
  await rejected(session, initPath, initialization, credential, /fenced for relocation/);
  await rejected(session, '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/step', completed.terminalStep, credential, /fenced for relocation/);
  walletSource.env.WALLET_CONSOLE.receiptMode = 'lost_reply';
  const lostPresignReceipt = await post(walletSource, freezePath, command, routerCredential);
  assert.equal(lostPresignReceipt.status, 503);
  assert.ok(walletSource.env.WALLET_CONSOLE.presignReceipts.has(command.presign_session_id));
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  walletSource.env.WALLET_CONSOLE.receiptMode = 'available';
  const receipt = await accepted(walletSource, freezePath, command, routerCredential);
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
    { state: 'draining', pending_effects: 0, pending_linked_sessions: 1 + extraRegistrations.length },
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
    { state: 'draining', pending_effects: 0, pending_linked_sessions: 1 + extraRegistrations.length },
  );
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  assert.deepEqual(await accepted(walletSource, freezePath, command, routerCredential), receipt);

  const pendingFrozen = await freezePendingRegistration(
    topology,
    credential,
    pending,
    command.request,
    walletSource,
    routerCredential,
  );
  for (const extra of extraRegistrations) {
    await freezePendingRegistration(topology, credential, extra, command.request, walletSource, routerCredential);
  }
  const sealing = await accepted(walletSource, '/router-ab/signing-worker/wallet/pool/freeze', {
    scope: command.wallet_scope, request: command.request,
  }, routerCredential);
  assert.deepEqual(sealing, { state: 'sealing' });
  await topology.unsafeEvictDurableObject(workerName, walletClass, { id: walletId });
  const changedSeal = structuredClone(command.request);
  changedSeal.invalidated_at_ms += 1;
  await rejected(source, '/router-ab/signing-worker/wallet/pool/freeze', {
    scope: command.wallet_scope, request: changedSeal,
  }, routerCredential, /inputs changed/);
  await rejected(source, '/router-ab/signing-worker/wallet/ecdsa/export', {
    receipt: { scope: command.wallet_scope, request: command.request, record_count: 0,
      wallet_records_digest_hex: '0'.repeat(64) }, segment_index: 0, chunk_bytes: 4096,
  }, routerCredential, /frozen/);
  await rejected(wallet, '/router-ab/internal/signing-worker/wallet', {
    command: 'register_linked_presign_session', ...pending.request,
  }, credential, /closed ECDSA pool admission/);
  walletSource.env.WALLET_CONSOLE.receiptMode = 'lost_reply';
  const lostReceipt = await post(walletSource, '/router-ab/signing-worker/wallet/pool/freeze', {
    scope: command.wallet_scope, request: command.request,
  }, routerCredential);
  assert.equal(lostReceipt.status, 503);
  assert.ok(walletSource.env.WALLET_CONSOLE.ecdsaReceipt);
  walletSource.env.WALLET_CONSOLE.receiptMode = 'available';
  const walletFreeze = await accepted(
    walletSource,
    '/router-ab/signing-worker/wallet/pool/freeze',
    {
      scope: command.wallet_scope,
      request: command.request,
    },
    routerCredential,
  );
  assert.equal(walletFreeze.state, 'frozen');
  assert.deepEqual(await accepted(walletSource, freezePath, command, routerCredential), receipt);
  const walletDestination = await runtimeRelocationDestination(topology, walletSource);
  const initialStatus = await accepted(walletDestination, transferPath, { kind: 'status', receipt, chunk_bytes: chunkBytes }, routerCredential);
  assert.equal(initialStatus.kind, 'prepared');
  assert.equal(initialStatus.chunk_bytes, chunkBytes);
  await rejected(destination, transferPath, { kind: 'status', receipt, chunk_bytes: 1024 }, credential, /status identity differs/);
  const first = await accepted(walletSource, exportPath, { receipt, segment_index: 0, chunk_bytes: chunkBytes }, routerCredential);
  const chunks = [];
  for (let index = 0; index < first.segment_count; index += 1) {
    const chunk = index === 0 ? first : await accepted(walletSource, exportPath, { receipt, segment_index: index, chunk_bytes: chunkBytes }, routerCredential);
    chunks.push(Buffer.from(chunk.data_b64u, 'base64url'));
    await accepted(walletDestination, transferPath, { kind: 'import', chunk }, credential);
    if (index === 0) await topology.unsafeEvictDurableObject(workerName, objectClass, { id: preparedIds[0] });
    const progress = await accepted(walletDestination, transferPath, { kind: 'status', receipt, chunk_bytes: chunkBytes }, routerCredential);
    assert.deepEqual(progress, { kind: 'receiving', receipt, chunk_bytes: chunkBytes, segment_count: first.segment_count, next_segment: index + 1 });
    if (index === 0) {
      const changed = structuredClone(chunk);
      changed.receipt.command.request.invalidated_at_ms += 1;
      await rejected(walletDestination, transferPath, { kind: 'import', chunk: changed }, credential,
        /invalid_input/);
    }
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
  assert.deepEqual(await accepted(walletSource, exportPath, { receipt, segment_index: 0, chunk_bytes: chunkBytes }, routerCredential), first);

  const verified = await accepted(walletDestination, transferPath, { kind: 'verify', receipt }, credential);
  assert.deepEqual(verified, { kind: 'verified', receipt });
  assert.deepEqual(await accepted(walletDestination, transferPath, { kind: 'status', receipt, chunk_bytes: chunkBytes }, routerCredential), verified);
  const destinationIds = preparedIds;
  assert.ok((await topology.listDurableObjectIds(objectClass, workerName)).includes(destinationIds[0]));
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: destinationIds[0] });
  assert.deepEqual(await accepted(walletDestination, transferPath, { kind: 'verify', receipt }, credential), verified);
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
  // Console phase authorization is covered by the private directory E2E.
  // This path uses the real Runtime transport and real native source storage.
  const changedCleanup = structuredClone(receipt);
  changedCleanup.records_digest_hex = '0'.repeat(64);
  await rejected(source, transferPath, { kind: 'cleanup', receipt: changedCleanup }, routerCredential, /requires its frozen source/);
  await rejected(restored, '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/transfer', { kind: 'cleanup', receipt }, credential, /requires its frozen source/);
  let cleaned;
  for (let step = 0; step < 32; step += 1) {
    cleaned = await accepted(walletSource, transferPath, { kind: 'cleanup', receipt }, routerCredential);
    if (cleaned.kind === 'cleaned') break;
    assert.deepEqual(cleaned, { kind: 'cleaning' });
    await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  }
  assert.deepEqual(cleaned, { kind: 'cleaned', receipt });
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  assert.deepEqual(await accepted(walletSource, transferPath, { kind: 'cleanup', receipt }, routerCredential), cleaned);
  await rejected(source, transferPath, { kind: 'cleanup', receipt: changedCleanup }, routerCredential, /receipt changed/);
  await rejected(source, exportPath, { receipt, segment_index: 0, chunk_bytes: chunkBytes }, routerCredential, /requires a frozen snapshot/);
  await rejected(source, freezePath, command, routerCredential, /cleanup already started/);
  await rejected(session, initPath, initialization, credential, /fenced for relocation/);
  await rejected(session, consumePath, delayedConsume, credential, /fenced for relocation/);
  assert.deepEqual(await accepted(walletDestination, transferPath, { kind: 'verify', receipt }, credential), verified);
  const pendingRegistration = await transferPendingRegistration(walletSource, walletDestination, pendingFrozen, routerCredential);
  const walletInventory = await verifyWalletInventoryTransfer(
    topology,
    credential,
    walletFreeze.receipt,
    [initialization.request, pending.request, ...extraRegistrations.map(registrationRequest)],
    { source: walletSource, destination: await runtimeRelocationDestination(topology, walletSource), credential: routerCredential },
  );
  return {
    scope:
      'Production presign completion, wallet registration, freeze and role-to-role import; excludes full device linking and concurrent consumption',
    sourceSealCheckpointSurvivedEviction: true,
    changedSealIdentityRejected: true,
    unfinishedSnapshotExportRejected: true,
    sessionRegistrationDuringSealingRejected: true,
    sourceSessionCommandsUseAuthenticatedRouter: true,
    sourceSessionCommandsUseJournalAuthority: true,
    frozenSessionReceiptLostReplyRecovered: true,
    walletWaitsForBothSessionAcknowledgements: true,
    partialAcknowledgementSurvivesWalletEviction: true,
    inventoryAvailableDuringDraining: true,
    preparationInventoryLeavesCompletionAndRegistrationOpen: true,
    preparationInventoryIsolatedByGeneration: true,
    completedPresignatureRetired: true,
    initializedFenceRequiresExactWalletMove: true,
    terminalReplayFenceRace: terminalRace.outcome,
    delayedConsumptionRejectedAtBothHomes: true,
    sourceExportUnchangedAfterDelayedConsumption: true,
    delayedTerminalStepRejectedAtBothHomes: true,
    initializedAuthorityPreserved: true,
    preparedBeforeSourceCompletionWithoutInvalidationTime: true,
    preparationBlocksDestinationInitialization: true,
    firstImportedReceiptPinsInvalidationTime: true,
    sourceFreezeReplayedAfterEviction: true,
    destinationVerificationReplayedAfterEviction: true,
    journalAuthorizedDestinationStatus: true,
    destinationCursorSurvivesEviction: true,
    changedStatusChunkSizeRejected: true,
    sourceSessionCleanupReplaysAfterEviction: true,
    cleanedSourceCannotExportOrReopen: true,
    destinationHistorySurvivesSourceCleanup: true,
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
  const chunkBytes = 4096;
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
        /inputs changed|invalid_input/);
    }
  }
  const lines = Buffer.concat(pieces).toString('utf8').trimEnd().split('\n');
  const [scope, move] = JSON.parse(lines.shift());
  const snapshot = { pools: [], activations: [], linked_reservations: [], effects: [], presign_authorities: [], linked_presign_sessions: [] };
  const families = { pool: 'pools', activation: 'activations', linked_reservation: 'linked_reservations', effect: 'effects', presign_authority: 'presign_authorities', linked_presign_session: 'linked_presign_sessions' };
  for (const line of lines) {
    const record = JSON.parse(line);
    assert.ok(Object.hasOwn(families, record.kind));
    snapshot[families[record.kind]].push(record.row);
  }
  assert.deepEqual(scope, receipt.scope);
  assert.deepEqual(move, receipt.request);
  return { snapshot, first };
}

async function verifyWalletInventoryTransfer(topology, credential, receipt, requests, transport) {
  const source = await topology.getWorker(workerName);
  const destinationName = 'fixture-signing-worker-after-refresh';
  const destination = await topology.getWorker(destinationName);
  const walletClass = 'RouterAbSigningWorkerWalletDurableObject';
  const before = await topology.listDurableObjectIds(walletClass, workerName);
  const transfer = '/router-ab/signing-worker/wallet/ecdsa/transfer';
  const { snapshot, first } = await transferWalletSnapshot(transport.source, transport.destination, transport.credential, receipt);
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
      limit: 128,
    },
    credential,
  );
  assert.equal(lastPage.state, 'complete');
  assert.equal(lastPage.sessions.length, requests.length - 1);
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
  const checkpoint = await accepted(transport.destination, transfer, verification, transport.credential);
  assert.deepEqual(checkpoint, { kind: 'restoring', receipt, restored_records: 16 });
  await rejected(transport.destination, transfer, { kind: 'activate', receipt }, transport.credential,
    /verified destination/);
  await evictTransferredWallet(topology, destinationName, receipt.scope, receipt.request.source_generation + 1);
  assert.deepEqual(await accepted(transport.destination, transfer, {
    kind: 'status', receipt, chunk_bytes: 4096,
  }, transport.credential), checkpoint);
  const verified = await finishWalletRestore(transport.destination, transfer, verification, transport.credential);
  assert.deepEqual(verified, { kind: 'verified', receipt });
  const after = await topology.listDurableObjectIds(walletClass, workerName);
  assert.deepEqual(after, before, 'Import must reuse the prepared destination object');
  const destinationId = await evictTransferredWallet(
    topology, destinationName, receipt.scope, receipt.request.source_generation + 1,
  );
  assert.deepEqual(await accepted(transport.destination, transfer, verification, transport.credential), verified);
  const namespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_WALLET_DO', destinationName);
  const wallet = namespace.get(namespace.idFromString(destinationId));
  const admission = await accepted(wallet, '/router-ab/internal/signing-worker/wallet', {
    command: 'check_ecdsa_pool_admission', scope: receipt.scope,
    ownership_generation: receipt.request.source_generation + 1,
  }, credential);
  assert.equal(admission, 'closed');
  return {
    sourceFreezeReceipt: receipt,
    sourceReceiptLostReplyRecovered: true,
    transferUsesAuthorizedRuntime: true,
    registeredSessions: requests.length,
    segments: first.segment_count,
    initializedAndPendingIdentitiesTransferred: true,
    chunkAcknowledgementsReplayed: true,
    restoreCheckpointSurvivedEviction: true,
    activationBeforeRestoreCompletionRejected: true,
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
        ownership_generation: initialization.request.ownership_generation,
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

async function freezePendingRegistration(topology, credential, initialization, move, runtime, routerCredential) {
  const source = await topology.getWorker(workerName);
  const command = {
    wallet_scope: initialization.request.wallet_scope,
    presign_session_id: initialization.request.presign_session_id,
    server_presignature_id: initialization.request.request.client_presignature_id,
    request: move,
  };
  const fencePath = '/router-ab/signing-worker/linked-presign-session/fence';
  const wrongMove = structuredClone(command);
  wrongMove.request.source_generation += 1;
  await rejected(source, fencePath, wrongMove, credential, /requires its source wallet move/);
  const before = await topology.listDurableObjectIds(objectClass, workerName);
  const fence = await accepted(runtime, fencePath, command, routerCredential);
  assert.equal(fence.initialization.state, 'registered');
  const after = await topology.listDurableObjectIds(objectClass, workerName);
  const created = after.filter(isNewObject.bind(undefined, before));
  assert.equal(created.length, 1);
  const namespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_PRESIGN_SESSION_DO', workerName);
  const session = namespace.get(namespace.idFromString(created[0]));
  await rejected(session, '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/init', initialization, credential, /fenced for relocation/);
  const receipt = await accepted(runtime, freezePath, command, routerCredential);
  await topology.unsafeEvictDurableObject(workerName, objectClass, { id: created[0] });
  assert.deepEqual(await accepted(runtime, fencePath, command, routerCredential), fence);
  assert.deepEqual(await accepted(runtime, freezePath, command, routerCredential), receipt);
  return { command, receipt, fence };
}

async function transferPendingRegistration(source, destination, frozen, credential) {
  const { command, receipt, fence } = frozen;
  const chunk = await accepted(source, exportPath, { receipt, segment_index: 0, chunk_bytes: 4096 }, credential);
  assert.equal(chunk.segment_count, 1);
  const snapshot = JSON.parse(Buffer.from(chunk.data_b64u, 'base64url').toString('utf8'));
  assert.equal(snapshot.state, 'uninitialized');
  assert.equal(snapshot.request_digest_hex, fence.initialization.request_digest_hex);
  await accepted(destination, transferPath, { kind: 'prepare', command: linkedPreparation(command), chunk_bytes: 4096 }, credential);
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
  await accepted(worker, transferPath, { kind: 'prepare', command: linkedPreparation(command), chunk_bytes: chunkBytes }, credential);
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
  const namespace = await topology.getDurableObjectNamespace('SIGNING_WORKER_PRESIGN_SESSION_DO', workerName);
  const imported = namespace.get(namespace.idFromString(created[0]));
  const exported = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const chunk = await accepted(imported, '/router-ab/internal/signing-worker/linked-ecdsa-presign-session/export', { receipt, segment_index: index, chunk_bytes: chunkBytes }, credential);
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
  await evictTransferredWallet(topology, destinationName, receipt.scope, receipt.request.source_generation + 1);
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

export async function evictTransferredWallet(topology, name, scope, generation) {
  return topology.evictWalletObject(name, scope, generation);
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
  const preparation = { kind: 'prepare', scope, request: relocationIdentity(request), chunk_bytes: 4096 };
  const prepared = await accepted(destination, transfer, preparation, credential);
  assert.deepEqual(await accepted(destination, transfer, preparation, credential), prepared);
  request.invalidated_at_ms = Date.now();
  const freeze = { scope, request };
  const frozen = await finishWalletFreeze(source, freeze, credential);
  assert.equal(frozen.state, 'frozen', 'Imported historical sessions must not block the next move');
  await evictTransferredWallet(topology, sourceName, scope, request.source_generation);
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
  assert.equal(snapshot.linked_presign_sessions.length, 18);
  for (const session of snapshot.linked_presign_sessions) {
    assert.equal(session.ownership_generation, previousReceipt.request.source_generation);
  }
  const verification = { kind: 'verify', receipt: frozen.receipt };
  const verified = await finishWalletRestore(destination, transfer, verification, credential);
  assert.deepEqual(verified, { kind: 'verified', receipt: frozen.receipt });
  await evictTransferredWallet(topology, destinationName, scope, request.source_generation + 1);
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
    /cleanup requires the exact frozen source/);

  return { receipt: frozen.receipt, segments: first.segment_count, preparationWithoutInvalidationTime: true };
}

function registrationRequest(initialization) {
  return initialization.request;
}

async function finishWalletRestore(destination, path, command, credential) {
  for (let step = 0; step < 16; step += 1) {
    const result = await accepted(destination, path, command, credential);
    if (result.kind === 'verified') return result;
    assert.equal(result.kind, 'restoring');
  }
  assert.fail('Wallet restoration did not finish within the scenario bound');
}

async function finishWalletFreeze(source, command, credential) {
  for (let step = 0; step < 16; step += 1) {
    const result = await accepted(source, '/router-ab/signing-worker/wallet/pool/freeze', command, credential);
    if (result.state === 'frozen') return result;
    assert.ok(result.state === 'sealing' || result.state === 'invalidating');
  }
  assert.fail('Wallet snapshot sealing did not finish within the scenario bound');
}
