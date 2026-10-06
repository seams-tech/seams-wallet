import { runtimeRelocationSource, runtimeRelocationDestination, verifyRuntimeRouterExport } from './runtime-relocation-evidence.mjs';
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

function preparedObjectName(scope) {
  return `signing-worker-wallet-${createHash('sha256').update('seams/signing-worker/wallet-do/v1').update(JSON.stringify(scope)).digest('hex')}`;
}

function preparationIdentity(source) {
  return {
    scope: source.scope,
    request: {
      move_id: source.request.move_id,
      source_generation: source.request.source_generation,
    },
  };
}

export async function verifyEd25519Snapshot(topology, activation, fixture, credential, sourceCredential, registrationCredential, signDestination) {
  const delivery = JSON.parse(activation.delivery);
  const scope = delivery.scope;
  const source = {
    scope,
    request: {
      move_id: `wmove_${'s'.repeat(43)}`,
      source_generation: 1,
      invalidated_at_ms: Date.now(),
    },
  };
  const worker = await runtimeRelocationSource(topology, sourceCredential, source);
  const destinationName = 'fixture-signing-worker-after-refresh';
  const destination = await topology.getWorker(destinationName);
  const preparation = { command: 'prepare', source: preparationIdentity(source) };
  const prepared = await accepted(destination, snapshotPath, preparation, credential);
  assert.deepEqual(prepared, { state: 'prepared', source: preparation.source, destination_object: prepared.destination_object });
  assert.equal(typeof prepared.destination_object, 'string');
  assert.equal(prepared.destination_object, preparedObjectName(source.scope));
  const ecdsaPreparation = {
    kind: 'prepare',
    scope,
    request: preparation.source.request,
    chunk_bytes: 4096,
  };
  const ecdsaPrepared = await accepted(destination,
    '/router-ab/signing-worker/wallet/ecdsa/transfer', ecdsaPreparation, credential);
  assert.deepEqual(ecdsaPrepared, {
    kind: 'prepared', scope, request: preparation.source.request, chunk_bytes: 4096,
    destination_object: prepared.destination_object,
  });
  await evictTransferredWallet(topology, destinationName, scope);
  assert.deepEqual(await accepted(destination, snapshotPath, preparation, credential), prepared);
  assert.deepEqual(await accepted(destination,
    '/router-ab/signing-worker/wallet/ecdsa/transfer', ecdsaPreparation, credential), ecdsaPrepared);
  source.request.invalidated_at_ms = Date.now();
  const capture = { command: 'capture', source };
  const premature = await post(worker, snapshotPath, capture, sourceCredential);
  assert.notEqual(premature.status, 200, await premature.text());
  const unauthorized = await post(await topology.getWorker('router'), snapshotPath, capture, 'wrong-credential');
  assert.equal(unauthorized.status, 403);
  assert.deepEqual(await accepted(worker, settlePath, source, sourceCredential), {
    state: 'settled', command: source,
  });
  worker.env.WALLET_CONSOLE.receiptMode = 'lost_reply';
  let lostReceiptReply = false;
  let frozen;
  let captureCalls = 0;
  for (; captureCalls < 64; captureCalls += 1) {
    const response = await post(worker, snapshotPath, capture, sourceCredential);
    if (response.status === 503 && worker.env.WALLET_CONSOLE.ed25519Receipt) {
      lostReceiptReply = true;
      worker.env.WALLET_CONSOLE.receiptMode = 'available';
      continue;
    }
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    await evictTransferredWallet(topology, workerName, scope);
    if (result.state === 'frozen') {
      frozen = result;
      break;
    }
    assert.equal(result.state, 'capturing');
  }
  assert.ok(frozen, 'Snapshot capture must finish within 64 bounded commands');
  assert.equal(lostReceiptReply, true);
  assert.deepEqual(await accepted(worker, snapshotPath, capture, sourceCredential), frozen);
  const { receipt } = frozen;
  assert.equal(receipt.record_count, 1, 'This registered wallet has one registration');
  assert.ok(receipt.segment_count > 1, 'Encrypted registration must span multiple segments');
  let rollingDigest = digest(source);
  const bytes = [];
  const segments = [];
  for (let segmentIndex = 0; segmentIndex < receipt.segment_count; segmentIndex += 1) {
    const request = { command: 'export', receipt, segment_index: segmentIndex };
    const result = await accepted(worker, snapshotPath, request, sourceCredential);
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
    segments.push(segment);
    rollingDigest = digest([rollingDigest, segment]);
    await evictTransferredWallet(topology, workerName, scope);
    assert.deepEqual(await accepted(worker, snapshotPath, request, sourceCredential), result);
  }
  assert.equal(rollingDigest, receipt.digest_hex);
  const record = JSON.parse(Buffer.concat(bytes).toString('utf8'));
  assert.equal(record.kind, 'registration');
  assert.deepEqual(JSON.parse(record.row.owner_json), scope);
  assert.equal(typeof record.row.ciphertext_json, 'string');
  const changed = structuredClone(receipt);
  changed.digest_hex = '00'.repeat(32);
  const changedReceipt = await post(await topology.getWorker('router'), snapshotPath, {
    command: 'export', receipt: changed, segment_index: 0,
  }, sourceCredential);
  assert.notEqual(changedReceipt.status, 200, await changedReceipt.text());
  const missingSegment = await post(worker, snapshotPath, {
    command: 'export', receipt, segment_index: receipt.segment_count,
  }, sourceCredential);
  assert.notEqual(missingSegment.status, 200, await missingSegment.text());
  const changedSource = structuredClone(source);
  changedSource.request.move_id = `wmove_${'t'.repeat(43)}`;
  const changedMove = await post(worker, snapshotPath, {
    command: 'capture', source: changedSource,
  }, sourceCredential);
  assert.notEqual(changedMove.status, 200, await changedMove.text());
  assert.deepEqual(await accepted(worker, snapshotPath, capture, sourceCredential), frozen);
  const restoration = await verifyDestinationRestoration({
    topology, destination, sourceTransport: worker, transport: await runtimeRelocationDestination(topology, worker), destinationName, receipt, segments,
    originalBytes: Buffer.concat(bytes), credential, sourceCredential, delivery, registrationCredential,
    activation, fixture, signDestination,
  });
  const routerExport = await verifyRuntimeRouterExport(worker, activation, topology);
  return {
    routerExport,
    restoration,
    recordCount: receipt.record_count,
    segmentCount: receipt.segment_count,
    snapshotDigestHex: receipt.digest_hex,
    captureCalls: captureCalls + 1,
    settlementRequired: true,
    boundedSegments: true,
    captureAndExportResumeAfterEviction: true,
    sourceReceiptLostReplyRecovered: true,
    activationReceiptLostReplyRecovered: true,
    transferUsesJournalAuthorizedRuntime: true,
    exactDigestReconstructed: true,
    changedMoveAndReceiptRejected: true,
    bothCurvesPreparedInSameDestinationBeforeSourceSettlement: true,
    bothPreparationReceiptsSurviveEviction: true,
    scope: 'Worker registration transfer and fresh Ed25519 signing; excludes linked-device transfer and assembled relocation',
  };
}

async function rejectDestinationDelivery(destination, delivery, credential) {
  const response = await post(destination,
    '/router-ab/signing-worker/ed25519-yao/activation/packages', delivery, credential);
  const text = await response.text();
  assert.notEqual(response.status, 200, text);
  assert.match(text, /closed new Ed25519 work/);
}

async function verifyDestinationRestoration({
  topology, destination, sourceTransport, transport, destinationName, receipt, segments,
  originalBytes, credential, sourceCredential, delivery, registrationCredential,
  activation, fixture, signDestination,
}) {
  const activate = { command: 'activate', receipt };
  const verify = { command: 'verify', receipt };
  const prematureActivation = await post(destination, snapshotPath, activate, credential);
  assert.notEqual(prematureActivation.status, 200, await prematureActivation.text());
  const prematureVerify = await post(destination, snapshotPath, verify, credential);
  assert.notEqual(prematureVerify.status, 200, await prematureVerify.text());
  await rejectDestinationDelivery(destination, delivery, registrationCredential);
  const outOfOrder = await post(destination, snapshotPath, {
    command: 'import', receipt, segment: segments[1],
  }, credential);
  assert.notEqual(outOfOrder.status, 200, await outOfOrder.text());
  const acknowledgements = [];
  const callsBeforeStatus = transport.env.MPC_ROUTER.calls;
  transport.env.WALLET_CONSOLE.mode = 'denied';
  assert.equal((await post(transport, snapshotPath, { command: 'status', receipt }, credential)).status, 409);
  transport.env.WALLET_CONSOLE.mode = 'corrupt';
  assert.equal((await post(transport, snapshotPath, { command: 'status', receipt }, credential)).status, 503);
  assert.equal(transport.env.MPC_ROUTER.calls, callsBeforeStatus);
  transport.env.WALLET_CONSOLE.mode = 'authorized';
  let progress = await accepted(transport, snapshotPath, { command: 'status', receipt }, credential);
  assert.deepEqual(progress, { state: 'receiving', next_segment: 0, segment_count: segments.length });
  while (progress.state === 'receiving' && progress.next_segment < progress.segment_count) {
    const segment = segments[progress.next_segment];
    if (segment.segment_index + 1 === receipt.segment_count) {
      const corrupt = structuredClone(segment);
      const bytes = Buffer.from(corrupt.data_b64u, 'base64url');
      bytes[0] ^= 1;
      corrupt.data_b64u = bytes.toString('base64url');
      const rejected = await post(destination, snapshotPath, {
        command: 'import', receipt, segment: corrupt,
      }, credential);
      assert.notEqual(rejected.status, 200, await rejected.text());
    }
    const command = { command: 'import', receipt, segment };
    const acknowledgement = await accepted(transport, snapshotPath, command, credential);
    assert.deepEqual(acknowledgement, {
      state: 'imported', segment_index: segment.segment_index,
      input_digest_hex: digest(segment),
    });
    if (segment.segment_index === 0) {
      const changedTime = structuredClone(receipt);
      changedTime.source.request.invalidated_at_ms += 1;
      const rejected = await post(destination, snapshotPath, {
        command: 'import', receipt: changedTime, segment,
      }, credential);
      assert.notEqual(rejected.status, 200, await rejected.text());
    }
    acknowledgements.push(acknowledgement);
    await evictTransferredWallet(topology, destinationName, receipt.source.scope);
    assert.deepEqual(await accepted(transport, snapshotPath, command, credential), acknowledgement);
    progress = await accepted(transport, snapshotPath, { command: 'status', receipt }, credential);
    assert.deepEqual(progress, {
      state: 'receiving', next_segment: segment.segment_index + 1, segment_count: receipt.segment_count,
    });
  }
  let verified;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const result = await accepted(transport, snapshotPath, verify, credential);
    await evictTransferredWallet(topology, destinationName, receipt.source.scope);
    if (result.state === 'verified') {
      verified = result;
      break;
    }
    assert.equal(result.state, 'restoring');
  }
  assert.deepEqual(verified, { state: 'verified', receipt });
  assert.deepEqual(await accepted(transport, snapshotPath, { command: 'status', receipt }, credential), verified);
  assert.deepEqual(await accepted(transport, snapshotPath, verify, credential), verified);
  const registrationReplay = await accepted(destination,
    '/router-ab/signing-worker/ed25519-yao/activation/packages', delivery, registrationCredential);
  const prematureCleanup = await post(sourceTransport, snapshotPath, { command: 'cleanup', activation: receipt }, sourceCredential);
  assert.equal(prematureCleanup.status, 409);
  transport.env.WALLET_CONSOLE.receiptMode = 'lost_reply';
  const lostActivation = await post(transport, snapshotPath, activate, credential);
  assert.equal(lostActivation.status, 503);
  assert.deepEqual(transport.env.WALLET_CONSOLE.ed25519Activation, receipt);
  await evictTransferredWallet(topology, destinationName, receipt.source.scope);
  transport.env.WALLET_CONSOLE.receiptMode = 'available';
  const activated = await accepted(transport, snapshotPath, activate, credential);
  assert.deepEqual(activated, { state: 'activated', receipt });
  await evictTransferredWallet(topology, destinationName, receipt.source.scope);
  assert.deepEqual(await accepted(destination, snapshotPath, activate, credential), activated);
  assert.deepEqual(await accepted(destination, snapshotPath, { command: 'status', receipt }, credential), activated);
  const cleanup = await verifySourceCleanup(topology, sourceTransport, receipt, sourceCredential, delivery, registrationCredential);
  const signing = await signDestination(topology, activation, fixture, destinationName, 2);
  const oldGeneration = await post(destination, settlePath, receipt.source, credential);
  assert.notEqual(oldGeneration.status, 200, await oldGeneration.text());
  const nextSource = structuredClone(receipt.source);
  nextSource.request.move_id = `wmove_${'u'.repeat(43)}`;
  nextSource.request.source_generation += 1;
  const returnDestination = await topology.getWorker(workerName);
  assert.deepEqual(await accepted(returnDestination, snapshotPath, {
    command: 'prepare', source: preparationIdentity(nextSource),
  }, credential), { state: 'prepared', source: preparationIdentity(nextSource), destination_object: preparedObjectName(nextSource.scope) });
  assert.deepEqual(await accepted(destination, settlePath, nextSource, credential), {
    state: 'settled', command: nextSource,
  });
  assert.deepEqual(await accepted(destination, snapshotPath, activate, credential), activated);
  assert.deepEqual(await accepted(destination,
    '/router-ab/signing-worker/ed25519-yao/activation/packages', delivery, registrationCredential), registrationReplay);
  assert.deepEqual(await accepted(destination, snapshotPath, {
    command: 'import', receipt, segment: segments[0],
  }, credential), acknowledgements[0]);
  let recaptured;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const result = await accepted(destination, snapshotPath, {
      command: 'capture', source: nextSource,
    }, credential);
    if (result.state === 'frozen') {
      recaptured = result.receipt;
      break;
    }
    assert.equal(result.state, 'capturing');
  }
  assert.ok(recaptured);
  const restoredRecords = new Map();
  const returnSegments = [];
  for (let segmentIndex = 0; segmentIndex < recaptured.segment_count; segmentIndex += 1) {
    const result = await accepted(destination, snapshotPath, {
      command: 'export', receipt: recaptured, segment_index: segmentIndex,
    }, credential);
    returnSegments.push(result.segment);
    const recordIndex = result.segment.record_index;
    if (!restoredRecords.has(recordIndex)) restoredRecords.set(recordIndex, []);
    restoredRecords.get(recordIndex).push(Buffer.from(result.segment.data_b64u, 'base64url'));
  }
  assert.equal(recaptured.record_count, 2);
  assert.deepEqual(Buffer.concat(restoredRecords.get(0)), originalBytes);
  const round1 = JSON.parse(Buffer.concat(restoredRecords.get(1)).toString('utf8'));
  assert.equal(round1.kind, 'round1');
  assert.equal(round1.row.state, 'completed');
  assert.deepEqual(JSON.parse(round1.row.terminal_json), {
    kind: 'success', response: signing.response,
  });
  const returned = await verifyReturnRestoration({
    topology, destination: returnDestination, receipt: recaptured,
    segments: returnSegments, oldReceipt: receipt, credential,
    activation, fixture, signDestination,
  });
  return {
    returned,
    cleanup,
    signatureSha256Hex: signing.signatureSha256Hex,
    freshSignatureVerified: true,
    staleGenerationRejected: signing.staleGenerationRejected,
    prepareReplayAfterEviction: signing.prepareReplayAfterEviction,
    preparationDoesNotRequireFutureInvalidationTime: true,
    firstReceiptPinsInvalidationTime: true,
    finalizeReplayAfterEviction: signing.finalizeReplayAfterEviction,
    newTerminalIncludedInNextSnapshot: true,
    destinationPreparedBeforeSourceSettlement: true,
    initialRegistrationWriteBlockedDuringPreparation: true,
    historicalRegistrationReplayPreserved: true,
    incompleteAndOutOfOrderImportsRejected: true,
    finalDigestFailureRollsBackImportProgress: true,
    exactAcknowledgementsAfterEviction: true,
    transferResumesFromDestinationCursor: true,
    sourceCommandsUseAuthenticatedRouterTransport: true,
    sourceCommandsUsePrivateRuntimeTransport: true,
    sourceCommandsRequireDirectoryAuthorization: true,
      routerReceiptLostAcknowledgementRetries: true,
    deniedOrCorruptAuthorizationDoesNotReachRouter: true,
    exactCiphertextAndIndexesRestored: true,
    ownershipGeneration: nextSource.request.source_generation,
    activationReplayPreservesLaterFence: true,
    lateKnownChunkPreservesRestoredRows: true,
  };
}

async function verifySourceCleanup(topology, source, receipt, credential, delivery, registrationCredential) {
  const command = { command: 'cleanup', activation: receipt };
  const changed = structuredClone(command);
  changed.activation.digest_hex = '00'.repeat(32);
  const rejected = await post(await topology.getWorker('router'), snapshotPath, changed, credential);
  assert.notEqual(rejected.status, 200, await rejected.text());
  const unauthorized = await post(await topology.getWorker('router'), snapshotPath, command, 'wrong-credential');
  assert.equal(unauthorized.status, 403);
  let cleaned;
  let calls = 0;
  for (; calls < 64; calls += 1) {
    const result = await accepted(source, snapshotPath, command, credential);
    await evictTransferredWallet(topology, workerName, receipt.source.scope);
    if (result.state === 'cleaned') {
      cleaned = result;
      break;
    }
    assert.deepEqual(result, { state: 'cleaning', receipt });
  }
  assert.deepEqual(cleaned, { state: 'cleaned', receipt });
  assert.ok(calls > 0, 'Cleanup must persist progress across bounded commands');
  assert.deepEqual(await accepted(source, snapshotPath, command, credential), cleaned);
  await rejectDestinationDelivery(await topology.getWorker(workerName), delivery, registrationCredential);
  const exported = await post(source, snapshotPath, {
    command: 'export', receipt, segment_index: 0,
  }, credential);
  assert.notEqual(exported.status, 200, await exported.text());
  return {
    calls: calls + 1,
    resumesAfterEviction: true,
    exactCompletionReplay: true,
    changedReceiptRejected: true,
    sourceRegistrationCannotReopen: true,
    commandsUseJournalActivation: true,
    cleanedSnapshotUnavailable: true,
  };
}

async function verifyReturnRestoration({
  topology, destination, receipt, segments, oldReceipt, credential,
  activation, fixture, signDestination,
}) {
  for (const segment of segments) {
    const command = { command: 'import', receipt, segment };
    const result = await accepted(destination, snapshotPath, command, credential);
    await evictTransferredWallet(topology, workerName, receipt.source.scope);
    assert.deepEqual(await accepted(destination, snapshotPath, command, credential), result);
  }
  let verified;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const result = await accepted(destination, snapshotPath, { command: 'verify', receipt }, credential);
    await evictTransferredWallet(topology, workerName, receipt.source.scope);
    if (result.state === 'verified') {
      verified = result;
      break;
    }
    assert.equal(result.state, 'restoring');
  }
  assert.deepEqual(verified, { state: 'verified', receipt });
  assert.deepEqual(await accepted(destination, snapshotPath, { command: 'activate', receipt }, credential), {
    state: 'activated', receipt,
  });
  const oldCleanup = { command: 'cleanup', activation: oldReceipt };
  assert.deepEqual(await accepted(destination, snapshotPath, oldCleanup, credential), {
    state: 'cleaned', receipt: oldReceipt,
  });
  await evictTransferredWallet(topology, workerName, receipt.source.scope);
  assert.deepEqual(await accepted(destination, snapshotPath, oldCleanup, credential), {
    state: 'cleaned', receipt: oldReceipt,
  });
  const signing = await signDestination(topology, activation, fixture, workerName, 3);
  return {
    ownershipGeneration: 3,
    registrationAndTerminalHistoryRestored: true,
    oldCleanupReplayPreservesReturnedWallet: true,
    signatureSha256Hex: signing.signatureSha256Hex,
    freshSignatureVerified: true,
  };
}
