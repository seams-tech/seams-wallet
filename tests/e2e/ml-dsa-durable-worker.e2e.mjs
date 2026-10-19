import { calibrateCpuProfiler } from './ml-dsa-cpu-profile.mjs';
import { installMlDsaActivation } from '../helpers/mlDsaActivation.e2e.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Miniflare } from 'miniflare';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { deserialize } from 'node:v8';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { startProfiles, stopProfiles, closeProfiles } from '../../crates/ed25519-yao-cloudflare-bench/scripts/profile_prepared_worker.mjs';

const fixtures = resolve(process.argv[2] ?? '/private/tmp/ml-dsa-worker-fixtures');
const artifact = resolve(process.argv[3] ?? '.artifacts/ml-dsa/durable-worker.json');
const root = resolve(import.meta.dirname, '../..');
const buildRoot = process.env.ML_DSA_TEST_BUILD_ROOT ?? join(root, 'crates/router-ab-cloudflare/build');
const options = new Set(process.argv.slice(4));
for (const option of options) assert.ok(['--profile-preparation', '--profile-signing', '--passive-preparation-observer', '--calibrate-stage-delays'].includes(option), 'Unknown measurement option');
const calibrateStages = options.has('--calibrate-stage-delays');
const stageEvents = [];
const profilePreparation = options.has('--profile-preparation');
const profileSigning = options.has('--profile-signing');
const passivePreparationObserver = options.has('--passive-preparation-observer');
const authHeader = 'x-router-ab-internal-service-auth';
const serviceAuth = randomBytes(32).toString('hex');
const gatewayAuth = randomBytes(32).toString('hex');
let persistence = await mkdtemp(join(tmpdir(), 'ml-dsa-worker-e2e-'));
const admissionBundle = await build({
  entryPoints: [join(root, 'tests/helpers/mlDsaOwnerAdmission.fixtures.ts')],
  bundle: true, format: 'esm', platform: 'node', write: false,
  tsconfig: join(root, 'packages/wallet-server/tsconfig.json'),
});
const admissionPath = join(persistence, 'owner-admission.mjs');
await writeFile(admissionPath, admissionBundle.outputFiles[0].contents);
const admission = await import(pathToFileURL(admissionPath).href);
const records = await Promise.all(['a', 'b'].map(readRecord));
const keks = await Promise.all(['a', 'b'].map(readKek));
const policy = {
  wallet_cooldown: { mode: 'enabled', interval_ms: 1000 },
  max_active_operations: 1,
  operation_timeout_ms: 30000,
  candidate_group_size: 2,
  preparation_group_size: 4,
  minimum_ready_batches: 8,
  refill_target_batches: 16,
};
const bindings = {
  ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING: 'INTERNAL_AUTH',
  INTERNAL_AUTH: serviceAuth,
  ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: gatewayAuth,
  ML_DSA_ADMISSION_POLICY: JSON.stringify(policy),
};
const publicationBarrierScript = `
function holdPublication(resolve) { setTimeout(resolve, 60000); }
function delayAuthorization(resolve) { setTimeout(resolve, 200); }
function finalPublication(command) {
  switch (command.job.groups) {
    case 'one': return true;
    case 'two': return JSON.stringify(command.binding.batch) !== JSON.stringify(command.job.batch);
    default: throw new Error('Unknown preparation group count');
  }
}
export class PublicationBarrier {
  constructor(state, env) { this.state = state; this.env = env; }
  async hold(stage, job) {
    await this.state.storage.delete('hold_stage');
    await this.state.storage.put('held', { stage, job });
    await new Promise(holdPublication);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/arm-before' || path === '/arm-after') {
      const stage = path === '/arm-before' ? 'before' : 'after';
      await this.state.storage.put('hold_stage', stage);
      await this.state.storage.delete('held');
      await this.state.storage.put('fail_inspection', stage === 'after');
      return new Response('Armed');
    }
    if (path === '/arm-wake-reply') {
      await this.state.storage.put('lose_wake_reply', true);
      return new Response('Armed');
    }
    if (path === '/state') {
      return Response.json({ wakeReplyFailures: await this.state.storage.get('wake_reply_failures') ?? 0, held: await this.state.storage.get('held') ?? null,
        inspectionFailures: await this.state.storage.get('inspection_failures') ?? 0 });
    }
    const command = await request.clone().json();
    if (command.command === 'inspect' && await this.state.storage.get('fail_inspection')) {
      await this.state.storage.put('fail_inspection', false);
      await this.state.storage.put('inspection_failures', 1);
      return new Response('Injected inventory failure', {status:503});
    }
    const stage = await this.state.storage.get('hold_stage');
    if (command.command === 'put' && stage === 'before') {
      await this.hold(stage, command.job);
    }
    const response = await this.env.ROLE.fetch(request);
    if (command.command === 'wake_refill' && response.status === 200 && await this.state.storage.get('lose_wake_reply')) {
      await this.state.storage.put('lose_wake_reply', false);
      await this.state.storage.put('wake_reply_failures', 1);
      return new Response('Injected lost wake acknowledgement', {status:503});
    }
    if (command.command === 'put' && response.status === 200 && stage === 'after' && finalPublication(command)) {
      await this.hold(stage, command.job);
    }
    return response;
  }
}
export class AdmissionBarrier {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    if (new URL(request.url).pathname === '/calibrate') {
      await this.state.storage.put('calibration_operation', await request.json());
      return new Response('Armed');
    }
    if (new URL(request.url).pathname === '/arm-handoff') {
      await this.state.storage.put('handoff_armed', true);
      return new Response('Armed');
    }
    if (new URL(request.url).pathname === '/arm') {
      await this.state.storage.put('armed', await request.json());
      return new Response('Armed');
    }
    if (new URL(request.url).pathname === '/state') {
      return Response.json({ settlementFailures: await this.state.storage.get('failures') ?? 0,
        settlementReplyFailures: await this.state.storage.get('reply_failures') ?? 0,
        heldSettlement: await this.state.storage.get('held_settlement') ?? null });
    }
    const command = await request.clone().json();
    if (command.command === 'lookup') {
      const operation = await this.state.storage.get('calibration_operation');
      if (operation && JSON.stringify(command.request.operation) === JSON.stringify(operation)) {
        await new Promise(delayAuthorization);
      }
    }
    const armed = await this.state.storage.get('armed');
    if (command.command === 'finish_refill' && armed && JSON.stringify(command.job.batch) === JSON.stringify(armed.batch)) {
      await this.state.storage.put('armed', false);
      await this.state.storage.put('failures', 1);
      await this.state.storage.put('lose_reply', command.job.batch);
      return new Response('Injected settlement failure', {status:503});
    }
    const id = this.env.REAL_ADMISSION.idFromName('ml-dsa-admission-v1');
    const response = await this.env.REAL_ADMISSION.get(id).fetch(request);
    if (command.command === 'finish_refill' && response.status === 200 && await this.state.storage.get('handoff_armed')) {
      await this.state.storage.put('handoff_armed', false);
      await this.state.storage.put('held_settlement', command.job);
      await new Promise(holdPublication);
    }
    const lostReply = await this.state.storage.get('lose_reply');
    if (command.command === 'finish_refill' && response.status === 200 && lostReply && JSON.stringify(command.job.batch) === JSON.stringify(lostReply)) {
      await this.state.storage.put('lose_reply', false);
      await this.state.storage.put('reply_failures', 1);
      return new Response('Injected lost settlement acknowledgement', {status:503});
    }
    return response;
  }
}
async function fetch() { return new Response('Local fault fixture'); }
export default { fetch };
`;
const producerEvents = [];
const observations = {
  scope: 'Local workerd, real strict Worker bundles, synthetic canonical wallet key, typed Gateway owner admission, and durable signing. Verified factor inputs, claimed-operation persistence, and custody activation are injected. HTTP login, public session routes, and hosted latency remain outside this test.',
  policy,
  profilePreparation,
  profileSigning,
  signingProfiles: [],
  passivePreparationObserver,
  initialReserveMilestones: [],
  preparationReads: [],
  postSignInventories: [],
  signatures: [],
  failedOperations: [],
  publicKeyHex: Buffer.from(records[0].public_key).toString("hex"),
};
observations.provenance = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version,
  openssl: process.versions.openssl,
  miniflare: JSON.parse(await readFile(join(root, 'node_modules/miniflare/package.json'), 'utf8')).version,
  sourceSha256: Object.fromEntries(await Promise.all([
    'tests/e2e/ml-dsa-durable-worker.e2e.mjs',
    'tests/helpers/mlDsaOwnerAdmission.fixtures.ts',
    'crates/ed25519-yao-cloudflare-bench/scripts/profile_prepared_worker.mjs',
    'crates/router-ab-cloudflare/Cargo.lock',
    'crates/router-ab-cloudflare/src/ml_dsa/workers/preparation.rs',
  ].map(fileDigest))),
  workerJsSha256: Object.fromEntries(await Promise.all([
    'crates/router-ab-cloudflare/build/router/worker/shim.mjs',
    'crates/router-ab-cloudflare/build/deriver-a/worker/shim.mjs',
    'crates/router-ab-cloudflare/build/deriver-b/worker/shim.mjs',
    'crates/router-ab-cloudflare/build/router/index.js',
    'crates/router-ab-cloudflare/build/deriver-a/index.js',
    'crates/router-ab-cloudflare/build/deriver-b/index.js',
  ].map(fileDigest))),
};
observations.workerWasmSha256 = Object.fromEntries(await Promise.all(["router", "deriver-a", "deriver-b"].map(wasmDigest)));

class OwnerRouterProxy {
  constructor(router) { this.router = router; }
  get internalServiceAuthSecret() { return gatewayAuth; }
  async fetch(request) {
    return this.router.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.arrayBuffer(),
    });
  }
}

let runtime;
let lastSuccessful;
let profileConnections = [];
let initialRefillStarted;
try {
  runtime = createRuntime();
  await runtime.ready;
  observations.idleTimerMs = await timerControl();
  if (profilePreparation || profileSigning) {
    observations.profilerCalibration = await calibrateCpuProfiler(`${artifact}-profiler`);
  }
  if (profilePreparation) {
    profileConnections = await startProfiles(runtime, participantTarget, 1000);
  }
  const denied = await raw('router', '/router-ab/ml-dsa/activate', records[0].activation, serviceAuth);
  assert.equal(denied.status, 403);
  initialRefillStarted = performance.now();
  observations.activation = await installMlDsaActivation(runtime, records, gatewayAuth, serviceAuth);
  observations.wrongAuthorityRejected = true;
  const emptyMessage = digest(Array.from(Buffer.from('ML-DSA empty-pool replay')));
  const emptyInput = {
    request: { key: records[0].activation.key, operation: Array.from(randomBytes(32)),
      message_digest: digest(emptyMessage), context_digest: digest([]) },
    message: emptyMessage,
    context: [],
  };
  const emptyResult = await post('router', '/router-ab/ml-dsa/sign', emptyInput, gatewayAuth);
  assert.equal(emptyResult.status, 'unavailable');
  assert.equal(emptyResult.reason, 'empty_pool');
  const refillStarted = performance.now();
  observations.activationAndInstallationMs = refillStarted - initialRefillStarted;
  await waitReady(policy.refill_target_batches);
  const emptyReplay = await post('router', '/router-ab/ml-dsa/sign', emptyInput, gatewayAuth);
  assert.equal(emptyReplay.status, 'existing');
  assert.equal(emptyReplay.operation.state, 'declined');
  observations.emptyPoolReplayRemainsDeclinedAfterRefill = true;
  const storedPools = await passiveInventories();
  observations.maximumPreparedChunkCounts = storedPools.map(maximumChunks);
  for (const chunks of observations.maximumPreparedChunkCounts) {
    assert.ok(chunks > 16, 'Signing did not exercise multiple ciphertext I/O groups');
  }
  observations.initialReserveRefillMs = performance.now() - refillStarted;
  observations.activationToFullReserveMs = performance.now() - initialRefillStarted;
  if (passivePreparationObserver) await verifyPassiveInventory();
  initialRefillStarted = undefined;
  if (profilePreparation) {
    observations.preparationProfile = {
      scope: 'Local workerd V8 sampling from before activation through first full reserve. Includes setup, storage, protocol waits and idle samples. Sampling can perturb latency. This is not billed CPU.',
      profiles: await stopProfiles(profileConnections),
    };
    profileConnections = [];
  }
  // Let the full-pool maintenance alarm settle before the first consumption.
  await new Promise(waitForQuietPool);
  for (let index = 0; index < 8 && observations.signatures.length < 3; index += 1) {
    await waitReady(policy.refill_target_batches);
    const message = digest(Array.from(Buffer.from(`ML-DSA durable Worker transaction ${index}`)));
    const owner = await admission.mlDsaOwnerFixture(records[0], new Uint8Array(message), `worker-${index}`);
    assert.equal(owner.admitted.kind, 'prepared');
    if (index === 0) observations.ownerAdmission = await admission.verifyMlDsaAdmissionRefusals(owner);
    const prepared = owner.admitted.operation;
    const input = JSON.parse(prepared.encode());
    if (calibrateStages && index === 0) {
      const barrier = await admissionBarrier();
      const armed = await barrier.fetch('https://fault.internal/calibrate', {
        method: 'POST', body: JSON.stringify(input.request.operation),
      });
      assert.equal(armed.status, 200);
    }
    const initialStarts = await preprocessingStarts();
    if (profileSigning) profileConnections = await startProfiles(runtime, signingTarget, 1000);
    const started = performance.now();
    const router = await runtime.getWorker('router');
    const response = await admission.dispatchMlDsaOwnerOperation(new OwnerRouterProxy(router), prepared);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    const responseAt = performance.now();
    const elapsedMs = responseAt - started;
    if (calibrateStages && index === 0) {
      await new Promise(waitForMarker);
      const operation = Buffer.from(input.request.operation).toString('hex');
      const stores = stageEvents.filter(isCalibrationStore, operation);
      assert.ok(stores.length > 0, 'No delayed material consumption trace was observed');
      observations.stageCalibration = stores.map(calibrationSpan);
      assert.ok(observations.stageCalibration.every(hasInjectedDelay), 'Stage clock missed the injected authorization wait');
    }
    if (profileSigning) {
      observations.signingProfiles.push({
        index,
        elapsedMs,
        scope: 'Local workerd online A/B sampling for one HTTP signing request. Includes storage, protocol waits and idle samples. Sampling can perturb latency. This is not billed CPU.',
        profiles: await stopProfiles(profileConnections),
      });
      profileConnections = [];
    }
    assert.equal(result.status, 'existing');
    if (result.operation.state === 'failed') {
      observations.failedOperations.push({ elapsedMs });
      assert.deepEqual(await (await admission.dispatchMlDsaOwnerOperation(new OwnerRouterProxy(router), prepared)).json(), result);
      continue;
    }
    assert.equal(result.operation.state, 'succeeded');
    assert.equal(result.operation.signature.length, 3309);
    verifyStandardSignature(records[0].public_key, message, input.context, result.operation.signature);
    assert.deepEqual(await (await admission.dispatchMlDsaOwnerOperation(new OwnerRouterProxy(router), prepared)).json(), result);
    const changed = structuredClone(input);
    changed.message.push(0);
    changed.request.message_digest = digest(changed.message);
    const refusal = await raw('router', '/router-ab/ml-dsa/sign', changed, gatewayAuth);
    assert.notEqual(refusal.status, 200);
    observations.signatures.push({
      elapsedMs,
      underFiveSeconds: elapsedMs < 5000,
      duplicateReturnedSameSignature: true,
      changedRequestRejected: true,
      messageHex: Buffer.from(message).toString('hex'),
      contextHex: Buffer.from(input.context).toString('hex'),
      signatureHex: Buffer.from(result.operation.signature).toString('hex'),
    });
    lastSuccessful = { input, result, prepared };
    if (observations.signatures.length === 1) {
      const barrier = await publicationBarrier();
      assert.equal((await barrier.fetch('https://fault.internal/arm-after')).status, 200);
      await waitForPreprocessingStart(initialStarts);
      observations.responseToRefillStartedMs = performance.now() - responseAt;
      assert.ok(observations.responseToRefillStartedMs < 3000, 'Settled consumption did not wake refill within three seconds');
      const jobs = await rolePreprocessingJobs('a');
      jobs.sort(newestJobFirst);
      const job = jobs[0];
      assert.equal(await producerState(job), 'running');
      const inventoryStarted = performance.now();
      await inventories();
      observations.inventoryDuringPreparationMs = performance.now() - inventoryStarted;
      assert.ok(observations.inventoryDuringPreparationMs < 2000, 'Producer work blocked pool inventory');
      assert.equal(await producerState(job), 'running');
      observations.inventoryOverlappedRunningProducer = true;
      const deniedProducer = await producerReceipt(job, gatewayAuth);
      assert.equal(deniedProducer.status, 403);
      observations.producerRejectsWrongAuthority = true;
      const retry = await producerReceipt(job, serviceAuth);
      assert.equal(retry.status, 202, 'A duplicate producer receipt was rejected');
      const changedJob = structuredClone(job);
      changedJob.expires_at_ms += 1;
      await assert.rejects(producerReceipt(changedJob, serviceAuth), /ML-DSA preprocessing lease is inactive/);
      observations.producerQueueRetryAndBindingChecks = true;
      const held = await waitForHeldPublication(barrier);
      assert.equal(held.stage, 'after');
      assert.deepEqual(held.job, job);
      const published = await inventories();
      const batches = preparationBatches(job);
      for (const role of published) {
        for (const batch of batches) {
          assert.ok(role.ready.map(batchId).includes(batch), 'The reset fixture lacks paired publication');
        }
      }
      observations.interruptedProducer = {
        batch: job.batch,
        beforeResetState: await producerState(job),
        recoveryAlarmBeforeReset: (await producerSnapshot(job.batch)).alarm,
        remainingLeaseMs: job.expires_at_ms - Date.now(),
      };
      assert.equal(observations.interruptedProducer.beforeResetState, 'running');
      assert.notEqual(observations.interruptedProducer.recoveryAlarmBeforeReset, null);
      assert.ok(observations.interruptedProducer.remainingLeaseMs > 30000);
      const resetStarted = performance.now();
      const startsBeforeReset = await preprocessingStarts();
      assert.equal((await barrier.fetch('https://fault.internal/arm-wake-reply')).status, 200);
      const settlementBarrier = await admissionBarrier();
      assert.equal((await settlementBarrier.fetch('https://fault.internal/arm', { method: 'POST', body: JSON.stringify(job) })).status, 200);
      await runtime.dispose();
      runtime = createRuntime();
      await runtime.ready;
      await waitForInterruptedProducer(job);
      observations.interruptedProducer.terminalStateMs = performance.now() - resetStarted;
      observations.interruptedProducer.afterResetState = await producerState(job);
      await waitForLeaseRelease(job);
      observations.interruptedProducer.leaseReleasedMs = performance.now() - resetStarted;
      observations.interruptedProducer.releasedBeforeOriginalDeadline = Date.now() < job.expires_at_ms;
      await waitForSettlementReplyFailures();
      observations.interruptedProducer.settlementQueueDrain = await waitForTerminalProducerSettlement();
      observations.interruptedProducer.afterSettlement = await producerSnapshot(job.batch);
      assert.equal(observations.interruptedProducer.afterSettlement.pending, false);
      observations.interruptedProducer.inspectionFailure = await (await (await publicationBarrier()).fetch('https://fault.internal/state')).json();
      observations.interruptedProducer.settlementFailure = await (await (await admissionBarrier()).fetch('https://fault.internal/state')).json();
      assert.equal(observations.interruptedProducer.inspectionFailure.inspectionFailures, 1);
      assert.equal(observations.interruptedProducer.settlementFailure.settlementFailures, 1);
      assert.equal(observations.interruptedProducer.settlementFailure.settlementReplyFailures, 1);
      assert.equal(observations.interruptedProducer.inspectionFailure.wakeReplyFailures, 1);
      for (const role of ['a', 'b']) {
        const jobs = await rolePreprocessingJobs(role);
        let matching = 0;
        for (const candidate of jobs) {
          if (batchId(candidate.batch) === batchId(job.batch)) matching += 1;
        }
        assert.equal(matching, 1);
      }
      observations.interruptedProducer.startsBeforeReset = startsBeforeReset;
      observations.interruptedProducer.startsAfterRecovery = await preprocessingStarts();
      const originalEvents = [];
      for (const event of producerEvents) {
        if (event.batch === batchId(job.batch)) originalEvents.push(event);
      }
      observations.interruptedProducer.executionEvents = originalEvents;
      let executions = 0;
      for (const event of originalEvents) {
        if (event.stage === 'running') executions += 1;
      }
      assert.equal(executions, 1);
      observations.interruptedProducer.originalPreparationRemainsSingleUse = true;
      assert.ok(observations.interruptedProducer.leaseReleasedMs < 15000);
      assert.equal(observations.interruptedProducer.releasedBeforeOriginalDeadline, true);
    }
    const inventory = await inventories();
    observations.postSignInventories.push(inventory);
    assert.ok(inventory.some(refillRequested) || pairedStock(inventory) >= policy.refill_target_batches);
  }
  assert.equal(observations.signatures.length, 3);
  observations.automaticRefillAfterSigning = true;
  await waitReady(policy.refill_target_batches);
  await runtime.dispose();
  bindings.ML_DSA_ADMISSION_POLICY = JSON.stringify({ ...policy, operation_timeout_ms: 1000 });
  runtime = createRuntime();
  await runtime.ready;
  assert.deepEqual(
    await (await admission.dispatchMlDsaOwnerOperation(new OwnerRouterProxy(await runtime.getWorker('router')), lastSuccessful.prepared)).json(),
    lastSuccessful.result,
  );
  assert.deepEqual(
    Object.fromEntries(await Promise.all(['router', 'deriver-a', 'deriver-b'].map(wasmDigest))),
    observations.workerWasmSha256,
  );
  observations.duplicateSurvivesWorkerRestart = true;
  const stalled = {
    ...lastSuccessful.input.request,
    operation: Array.from(randomBytes(32)),
  };
  const admitted = await post('router', '/router-ab/ml-dsa/admit', stalled, gatewayAuth);
  assert.equal(admitted.status, 'admitted');
  const changedLayout = structuredClone(admitted.permit);
  changedLayout.request.key.schedule_digest[0] ^= 1;
  const wrongLayout = await raw('b', '/router-ab/ml-dsa/role', {
    command: 'take', permit: changedLayout, batch: admitted.permit.batches[0],
  }, serviceAuth);
  assert.notEqual(wrongLayout.status, 200);
  const untouched = await post('b', '/router-ab/ml-dsa/role', {
    command: 'inspect', key: stalled.key, batches: admitted.permit.batches,
  });
  assert.ok(untouched.every(isReserved), 'Layout refusal consumed a reserved group');
  observations.changedSigningLayoutRejectedBeforeConsumption = true;
  observations.stalledPermitRemainingMs = admitted.permit.expires_at_ms - Date.now();
  observations.stalledReservationStates = await Promise.all([
    post('a', '/router-ab/ml-dsa/role', { command: 'inspect', key: stalled.key, batches: admitted.permit.batches }),
    post('b', '/router-ab/ml-dsa/role', { command: 'inspect', key: stalled.key, batches: admitted.permit.batches }),
  ]);
  observations.reservedInventory = await inventories();
  for (const inventory of observations.reservedInventory) {
    assert.equal(inventory.ready.length, 0);
    assert.equal(inventory.reserved.length, admitted.permit.batches.length);
    assert.equal(inventory.refill_due, false);
  }
  const control = timerControl();
  const peer = await runtime.getWorker('b');
  const started = performance.now();
  const response = await peer.fetch('https://ml-dsa.internal/router-ab/ml-dsa/connect', {
    headers: {
      upgrade: 'websocket',
      [authHeader]: serviceAuth,
      'x-ml-dsa-input': Buffer.from(JSON.stringify({
        permit: admitted.permit,
        message: lastSuccessful.input.message,
        context: lastSuccessful.input.context,
      })).toString('base64url'),
    },
  });
  observations.stalledHandshakeMs = performance.now() - started;
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  assert.ok(socket);
  const closed = once(socket, 'close', { signal: AbortSignal.timeout(30000) });
  socket.accept();
  const [closeEvent] = await closed;
  assert.equal(closeEvent.code, 1011, 'The stalled peer did not signal an execution failure');
  observations.stalledPeerCloseCode = closeEvent.code;
  observations.stalledPeerClosedMs = performance.now() - started;
  observations.stalledSocketWaitMs = observations.stalledPeerClosedMs - observations.stalledHandshakeMs;
  observations.concurrentTimerMs = await control;
  assert.ok(observations.stalledPeerClosedMs < 2000, 'The idle signing peer exceeded the timeout tolerance');
  assert.ok(observations.concurrentTimerMs < 2000, 'Background work delayed the independent timer');
  const expired = await post('router', '/router-ab/ml-dsa/status', stalled, gatewayAuth);
  assert.equal(expired.state, 'failed');
  observations.stalledOperationExpiredWithoutSignature = true;
  observations.prepublicationFallback = await checkPrepublicationFallback();
  observations.producerHandoff = {
    liveTimeout: await checkProducerHandoff(false),
    restart: await checkProducerHandoff(true),
  };
  observations.standardSignaturesVerifiedByRouter = observations.signatures.length;
  observations.standardSignaturesVerifiedByOpenSsl = observations.signatures.length;
  observations.passed = true;
} catch (error) {
  observations.passed = false;
  observations.error = String(error);
  throw error;
} finally {
  closeProfiles(profileConnections);
  await runtime?.dispose();
  await mkdir(resolve(artifact, '..'), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(observations, null, 2)}\n`);
  await rm(persistence, { recursive: true, force: true });
  console.log(JSON.stringify({ artifact, passed: observations.passed, signingMs: observations.signatures.map(signingTime), stalledPeerClosedMs: observations.stalledPeerClosedMs }));
}
async function readRecord(role) {
  return JSON.parse(await readFile(join(fixtures, `${role}.json`), 'utf8'));
}
async function readKek(role) {
  return readFile(join(fixtures, `${role}-kek`), 'utf8');
}
function digest(bytes) {
  return Array.from(createHash('sha256').update(Buffer.from(bytes)).digest());
}
function createRuntime() {
  return new Miniflare({
    handleRuntimeStdio,
    workers: workers(),
    durableObjectsPersist: persistence,
    inspectorPort: profilePreparation || profileSigning ? 0 : undefined,
  });
}

function base(name, build, extraBindings) {
  return {
    name,
    modules: true,
    scriptPath: join(buildRoot, build, 'worker/shim.mjs'),
    modulesRoot: buildRoot,
    modulesRules: [
      { type: 'ESModule', include: ['**/*.js', '**/*.mjs'] },
      { type: 'CompiledWasm', include: ['**/*.wasm'] },
    ],
    compatibilityDate: '2026-06-12',
    bindings: { ...bindings, ...extraBindings },
  };
}
function workers() {
  return [
    {
      ...base('router', 'router', {}),
      durableObjects: {
        ML_DSA_ADMISSION_DO: {
          className: 'RouterAbMlDsaAdmissionDurableObject', useSQLite: true,
        },
      },
      serviceBindings: { DERIVER_A: 'a', DERIVER_B: 'b' },
    },
    roleWorker('a', 0),
    roleWorker('b', 1),
    preparerWorker('a', 0),
    preparerWorker('b', 1),
    {
      name: 'publication-barrier',
      modules: true,
      script: publicationBarrierScript,
      durableObjects: {
        BARRIER: { className: 'PublicationBarrier', useSQLite: true },
        ADMISSION_BARRIER: { className: 'AdmissionBarrier', useSQLite: true },
        REAL_ADMISSION: { className: 'RouterAbMlDsaAdmissionDurableObject', scriptName: 'router' },
      },
      serviceBindings: { ROLE: 'a' },
    },
    {
      name: 'timer-control',
      modules: true,
      script: `
        function waitOneSecond(resolve) { setTimeout(resolve, 1000); }
        async function fetch() {
          await new Promise(waitOneSecond);
          return Response.json({ completed: true });
        }
        export default { fetch };
      `,
    },
  ];
}
function roleWorker(role, index) {
  const worker = {
    ...base(role, `deriver-${role}`, {
      DERIVER_ROLE_PRIVATE_D1_ROLE: `deriver_${role}`,
      DERIVER_ROLE_PRIVATE_D1_KEK_BINDING: 'ROLE_KEK',
      ROLE_KEK: keks[index],
      DERIVER_ROLE_PRIVATE_D1_KEK_VERSION: 'role-private-e2e',
    }),
    durableObjects: {
      ML_DSA_POOL_DO: {
        className: 'RouterAbMlDsaPoolDurableObject', useSQLite: true,
      },
      ML_DSA_ADMISSION_DO: {
        className: 'RouterAbMlDsaAdmissionDurableObject', scriptName: 'router',
      },
    },
    serviceBindings: { DERIVER_B: 'b' },
  };
  if (role === 'a') {
    worker.durableObjects.ML_DSA_PRODUCER_DO = {
      className: 'RouterAbMlDsaProducerDurableObject', scriptName: 'preparer-a',
    };
  }
  if (calibrateStages && role === 'a') {
    worker.durableObjects.ML_DSA_ADMISSION_DO = {
      className: 'AdmissionBarrier', scriptName: 'publication-barrier',
    };
  }
  return worker;
}
function preparerWorker(role, index) {
  const worker = roleWorker(role, index);
  worker.name = `preparer-${role}`;
  worker.durableObjects.ML_DSA_POOL_DO = {
    className: role === 'a' ? 'PublicationBarrier' : 'RouterAbMlDsaPoolDurableObject',
    scriptName: role === 'a' ? 'publication-barrier' : role,
  };
  if (role === 'a') {
    worker.durableObjects.ML_DSA_ADMISSION_DO = {
      className: 'AdmissionBarrier', scriptName: 'publication-barrier',
    };
    worker.durableObjects.ML_DSA_PRODUCER_DO = {
      className: 'RouterAbMlDsaProducerDurableObject', useSQLite: true,
    };
  }
  delete worker.durableObjects.ML_DSA_REGISTRATION_DO;
  worker.serviceBindings = { DERIVER_B: 'preparer-b' };
  return worker;
}
async function producerReceipt(job, credential) {
  const namespace = await runtime.getDurableObjectNamespace('ML_DSA_PRODUCER_DO', 'preparer-a');
  const stub = namespace.get(namespace.idFromName('ml-dsa-producer-v1'));
  return stub.fetch('https://ml-dsa.internal/router-ab/ml-dsa/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [authHeader]: credential },
    body: JSON.stringify(job),
  });
}
async function raw(worker, path, input, credential) {
  const fetcher = await runtime.getWorker(worker);
  return fetcher.fetch(`https://ml-dsa.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [authHeader]: credential },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(45000),
  });
}
async function post(worker, path, input, credential = serviceAuth) {
  const response = await raw(worker, path, input, credential);
  const body = await response.text();
  assert.equal(response.status, 200, `${worker}${path}: ${body}`);
  return JSON.parse(body);
}

async function inventory(role) {
  return post(role, '/router-ab/ml-dsa/role', {
    command: 'inventory',
    key: records[0].activation.key,
    target: policy.refill_target_batches,
    ready_until_ms: Date.now() + policy.operation_timeout_ms,
  });
}
async function inventories() {
  return Promise.all(['a', 'b'].map(inventory));
}
async function waitReady(count) {
  const deadline = performance.now() + 300000;
  while (performance.now() < deadline) {
    const readStarted = performance.now();
    const [a, b] = passivePreparationObserver && initialRefillStarted !== undefined
      ? await passiveInventories() : await inventories();
    if (initialRefillStarted !== undefined) {
      observations.preparationReads.push({ startMs: readStarted - initialRefillStarted, finishMs: performance.now() - initialRefillStarted });
    }
    const peer = new Set(b.ready.map(batchId));
    let paired = 0;
    for (const id of a.ready) {
      if (peer.has(batchId(id))) paired += 1;
    }
    if (initialRefillStarted !== undefined) {
      const previous = observations.initialReserveMilestones.at(-1);
      if (previous === undefined || previous.paired !== paired) {
        observations.initialReserveMilestones.push({ paired, elapsedMs: performance.now() - initialRefillStarted });
      }
    }
    if (paired >= count) return;
    await new Promise(waitOneSecond);
  }
  throw new Error('Automatic paired preprocessing did not refill before its deadline');
}
function preparationBatches(job) {
  const first = batchId(job.batch);
  switch (job.groups) {
    case 'one': return [first];
    case 'two': return [first, createHash('sha256')
      .update('seams/ml-dsa/preparation-second-pair/v1')
      .update(Buffer.from(job.batch)).digest('hex')];
    default: throw new Error('Unknown preparation group count');
  }
}
function batchId(id) {
  return Buffer.from(id).toString('hex');
}
function isReserved(value) {
  return value === 'reserved';
}

async function publicationBarrier() {
  const namespace = await runtime.getDurableObjectNamespace('BARRIER', 'publication-barrier');
  const wallet = records[0].activation.key.wallet;
  const ordered = { org: wallet.org, project: wallet.project, environment: wallet.environment, wallet: wallet.wallet };
  const name = createHash('sha256').update('wallet').update(JSON.stringify(ordered)).digest('hex');
  return namespace.get(namespace.idFromName(`ml-dsa-pool-${name}`));
}

async function waitForHeldPublication(barrier) {
  const deadline = performance.now() + 60000;
  while (performance.now() < deadline) {
    const state = await (await barrier.fetch('https://fault.internal/state')).json();
    if (state.held) return state.held;
    await new Promise(waitForMarker);
  }
  throw new Error('The producer did not reach the paired-publication barrier');
}

async function waitForInterruptedProducer(job) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    if (await producerState(job) === 'interrupted') return;
    await new Promise(waitForMarker);
  }
  throw new Error('Paired publication did not persist interrupted state before its deadline');
}

async function admissionBarrier() {
  const namespace = await runtime.getDurableObjectNamespace('ADMISSION_BARRIER', 'publication-barrier');
  return namespace.get(namespace.idFromName('ml-dsa-admission-v1'));
}

async function admissionCheck(command) {
  const namespace = await runtime.getDurableObjectNamespace('ML_DSA_ADMISSION_DO', 'router');
  const stub = namespace.get(namespace.idFromName('ml-dsa-admission-v1'));
  const response = await stub.fetch('https://admission.internal/check', {
    method: 'POST', headers: { 'content-type': 'application/json', [authHeader]: serviceAuth },
    body: JSON.stringify(command),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForLeaseRelease(job) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    if (!await admissionCheck({ command: 'check_refill', job })) return;
    await new Promise(waitForMarker);
  }
  throw new Error('The interrupted producer still holds its global lease');
}

async function checkPrepublicationFallback() {
  const barrier = await publicationBarrier();
  assert.equal((await barrier.fetch('https://fault.internal/arm-before')).status, 200);
  await inventories();
  const held = await waitForHeldPublication(barrier);
  assert.equal(held.stage, 'before');
  const job = held.job;
  const inspection = { command: 'inspect', key: job.key, batches: [job.batch] };
  const beforeReset = { a: await post('a', '/router-ab/ml-dsa/role', inspection),
    b: await post('b', '/router-ab/ml-dsa/role', inspection) };
  assert.deepEqual(beforeReset.a, ['missing']);
  assert.deepEqual(beforeReset.b, ['ready']);
  assert.equal(await producerState(job), 'running');
  const started = performance.now();
  await runtime.dispose();
  runtime = createRuntime();
  await runtime.ready;
  await new Promise(waitSixSeconds);
  assert.equal(await producerState(job), 'running');
  assert.equal(await admissionCheck({ command: 'check_refill', job }), true);
  const retainedLeaseMs = performance.now() - started;
  const markers = await preprocessingStarts();
  while (Date.now() < job.expires_at_ms + 1000) await new Promise(waitOneSecond);
  await waitForPreprocessingStart(markers);
  const later = await rolePreprocessingJobs('a');
  later.sort(newestJobFirst);
  const fresh = later[0];
  assert.notDeepEqual(fresh.batch, job.batch);
  assert.equal(await producerState(job), 'interrupted');
  assert.equal(await admissionCheck({ command: 'check_refill', job: fresh }), true);
  assert.deepEqual(await admissionCheck({ command: 'finish_refill', job }), []);
  assert.equal(await admissionCheck({ command: 'check_refill', job: fresh }), true);
  await assert.rejects(producerReceipt(job, serviceAuth), /ML-DSA preprocessing lease is inactive/);
  return { batch: job.batch, freshBatch: fresh.batch, beforeReset, retainedLeaseMs, elapsedMs: performance.now() - started,
    unknownPublicationRetainedLease: true, deadlineFallback: true, staleSettlementPreservedNewLease: true, expiredProducerRetryRejected: true };
}

async function waitForSettlementReplyFailures() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const admission = await (await (await admissionBarrier()).fetch('https://fault.internal/state')).json();
    const publication = await (await (await publicationBarrier()).fetch('https://fault.internal/state')).json();
    if (admission.settlementReplyFailures === 1 && publication.wakeReplyFailures === 1) return;
    await new Promise(waitOneSecond);
  }
  assert.fail('The settlement and wake reply faults were not exercised');
}

function handleRuntimeStdio(stdout, stderr) {
  stdout.pipe(process.stdout);
  stderr.pipe(process.stderr);
  createInterface({ input: stdout }).on('line', recordProducerEvent);
  createInterface({ input: stderr }).on('line', recordProducerEvent);
}
function recordProducerEvent(line) {
  if (!line.startsWith('{')) return;
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (event.event === 'ml_dsa_producer_job_v1') producerEvents.push(event);
  if (event.event === 'ml_dsa_stage_trace_v1') stageEvents.push(event);
}
async function checkProducerHandoff(restart) {
  await runtime.dispose();
  await rm(persistence, { recursive: true, force: true });
  persistence = await mkdtemp(join(tmpdir(), 'ml-dsa-handoff-e2e-'));
  bindings.ML_DSA_ADMISSION_POLICY = JSON.stringify(policy);
  runtime = createRuntime();
  await runtime.ready;
  const barrier = await admissionBarrier();
  assert.equal((await barrier.fetch('https://fault.internal/arm-handoff')).status, 200);
  await installMlDsaActivation(runtime, records, gatewayAuth, serviceAuth);
  const deadline = performance.now() + 60000;
  let held;
  let snapshot;
  while (performance.now() < deadline) {
    const state = await (await barrier.fetch('https://fault.internal/state')).json();
    if (state.heldSettlement) {
      held = state.heldSettlement;
      await inventories();
      snapshot = await producerSnapshot(held.batch);
      if (snapshot.pendingIds.length === 2) break;
    }
    await new Promise(waitForMarker);
  }
  assert.ok(held && snapshot?.pendingIds.length === 2, 'A new job did not queue behind held settlement');
  assert.equal(snapshot.state, 'published');
  assert.deepEqual(snapshot.pendingIds[0], held.batch);
  const next = await producerSnapshot(snapshot.pendingIds[1]);
  assert.equal(next.state, 'queued');
  assert.notEqual(next.alarm, null);
  assert.equal(await admissionCheck({ command: 'check_refill', job: next.job }), true);
  const handoffStarted = performance.now();
  if (restart) {
    await runtime.dispose();
    runtime = createRuntime();
    await runtime.ready;
  }
  await assert.rejects(producerReceipt(held, serviceAuth), /ML-DSA preprocessing lease is inactive/);
  assert.deepEqual(await admissionCheck({ command: 'finish_refill', job: held }), []);
  assert.equal(await admissionCheck({ command: 'check_refill', job: next.job }), true);
  const releaseDeadline = performance.now() + 15000;
  while ((await producerSnapshot(held.batch)).pending && performance.now() < releaseDeadline) {
    await new Promise(waitForMarker);
  }
  assert.equal((await producerSnapshot(held.batch)).pending, false, 'Held settlement blocked the next job');
  const settlementReleaseMs = performance.now() - handoffStarted;
  assert.ok(settlementReleaseMs < 15000);
  await waitReady(policy.refill_target_batches);
  const settled = await waitForTerminalProducerSettlement();
  const oldAfter = await producerSnapshot(held.batch);
  const nextAfter = await producerSnapshot(next.job.batch);
  assert.equal(oldAfter.state, 'published');
  assert.equal(oldAfter.pending, false);
  assert.equal(nextAfter.state, 'published');
  assert.equal(nextAfter.pending, false);
  const oldRuns = producerEvents.filter(isRunningJob, batchId(held.batch));
  const nextRuns = producerEvents.filter(isRunningJob, batchId(next.job.batch));
  assert.equal(oldRuns.length, 1);
  assert.equal(nextRuns.length, 1);
  assert.equal(oldRuns[0].producer, nextRuns[0].producer);
  assert.equal(nextAfter.pendingIds.length, 0);
  assert.equal(nextAfter.alarm, null);
  return { heldJob: held.batch, nextJob: next.job.batch, sameProducer: true, queuedDuringSettlement: true,
    restart, settlementReleaseMs, heldReplyDelayMs: 60000, queuedJobPreserved: true, staleRetryRejected: true, staleFinishPreservedNewLease: true,
    oldExecutions: oldRuns.length, nextExecutions: nextRuns.length, settled, idleAlarmCleared: true };
}
function isRunningJob(event) { return event.stage === 'running' && event.batch === this; }

async function waitForTerminalProducerSettlement() {
  const directory = join(persistence, 'preparer-a-RouterAbMlDsaProducerDurableObject');
  const files = (await readdir(directory)).filter(walletDatabase);
  const jobs = [];
  for (const file of files) {
    const database = new DatabaseSync(join(directory, file), { readOnly: true });
    try {
      const rows = database.prepare("SELECT value FROM _cf_KV WHERE key LIKE 'producer-job/%'").all();
      for (const row of rows) {
        const value = deserialize(row.value);
        if (['published', 'failed', 'interrupted'].includes(value.state)) jobs.push(value.job);
      }
    } finally { database.close(); }
  }
  assert.ok(jobs.length > 0);
  const pending = [];
  for (const job of jobs) {
    if ((await producerSnapshot(job.batch)).pending) pending.push(batchId(job.batch));
  }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    let remaining = 0;
    for (const job of jobs) {
      if ((await producerSnapshot(job.batch)).pending) remaining += 1;
    }
    if (remaining === 0) return { checked: jobs.length, initiallyPending: pending, allCleared: true };
    await new Promise(waitOneSecond);
  }
  assert.fail('Terminal producer settlement queue did not drain after injected reply failures');
}

function waitSixSeconds(resolve) {
  setTimeout(resolve, 6000);
}
function waitOneSecond(resolve) {
  setTimeout(resolve, 1000);
}

async function wasmDigest(role) {
  const bytes = await readFile(join(buildRoot, role, 'index_bg.wasm'));
  return [role, createHash('sha256').update(bytes).digest('hex')];
}

async function timerControl() {
  const peer = await runtime.getWorker('timer-control');
  const started = performance.now();
  const response = await peer.fetch('https://timer.internal');
  assert.deepEqual(await response.json(), { completed: true });
  return performance.now() - started;
}

function isCalibrationStore(event) {
  return event.operation === this && event.role === 'a' && event.context.kind === 'take_store';
}
function calibrationSpan(event) {
  const marks = Object.fromEntries(event.marks.map(stageEntry));
  assert.ok(Number.isFinite(marks.started) && Number.isFinite(marks.authorized));
  return { operation: event.operation, material: event.context.material,
    injectedMs: 200, observedAuthorizationMs: marks.authorized - marks.started };
}
function stageEntry(mark) { return [mark.stage, mark.at_ms]; }
function hasInjectedDelay(span) { return span.observedAuthorizationMs >= 190; }

function signingTime(value) { return value.elapsedMs; }

function waitForQuietPool(resolve) { setTimeout(resolve, 2500); }
async function preprocessingStarts() {
  return Promise.all(['a', 'b'].map(rolePreprocessingStarts));
}
async function rolePreprocessingStarts(role) {
  return (await rolePreprocessingJobs(role)).length;
}
async function rolePreprocessingJobs(role) {
  const directory = join(persistence, `${role}-RouterAbMlDsaPoolDurableObject`);
  const files = (await readdir(directory)).filter(walletDatabase);
  assert.equal(files.length, 1);
  const database = new DatabaseSync(join(directory, files[0]), { readOnly: true });
  try {
    return database.prepare("SELECT value FROM _cf_KV WHERE key LIKE 'preprocessing/%'").all().map(storedPreparationJob);
  } finally {
    database.close();
  }
}
async function producerState(job) {
  return (await producerSnapshot(job.batch)).state;
}
async function producerSnapshot(batch) {
  const directory = join(persistence, 'preparer-a-RouterAbMlDsaProducerDurableObject');
  const files = (await readdir(directory)).filter(walletDatabase);
  for (const file of files) {
    const database = new DatabaseSync(join(directory, file), { readOnly: true });
    database.exec('PRAGMA busy_timeout = 1000');
    database.exec('BEGIN');
    try {
      const row = database.prepare("SELECT value FROM _cf_KV WHERE key = ?").get('producer-job/' + batchId(batch));
      if (row) {
        const state = deserialize(row.value);
        if (JSON.stringify(state.job.batch) === JSON.stringify(batch)) {
          const alarm = database.prepare('SELECT CAST(value AS TEXT) AS alarm FROM _cf_METADATA WHERE key = 1').get();
          const queued = database.prepare("SELECT value FROM _cf_KV WHERE key = 'producer-pending'").get();
          const pendingIds = queued ? deserialize(queued.value) : [];
          return { state: state.state, job: state.job, pendingIds, pending: pendingIds.some(matchesBatch, batch), alarm: alarm?.alarm ?? null };
        }
      }
    } finally {
      database.exec('ROLLBACK');
      database.close();
    }
  }
  throw new Error('Producer state is missing');
}
function matchesBatch(value) { return batchId(value) === batchId(this); }
function storedPreparationJob(row) { return deserialize(row.value); }
function newestJobFirst(a, b) { return b.expires_at_ms - a.expires_at_ms; }
function walletDatabase(name) { return name.endsWith('.sqlite') && name !== 'metadata.sqlite'; }
async function waitForPreprocessingStart(before) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    const current = await preprocessingStarts();
    if (current[0] > before[0] && current[1] > before[1]) return;
    await new Promise(waitForMarker);
  }
  throw new Error('Neither participant started replacement preparation after consumption');
}
function waitForMarker(resolve) { setTimeout(resolve, 50); }

function signingTarget(target) { return /core:user:(a|b)$/.test(target.title); }
function participantTarget(target) { return /core:user:preparer-(a|b)$/.test(target.title); }

function verifyStandardSignature(publicKey, message, context, signature) {
  assert.equal(context.length, 0, 'This NEAR transaction fixture uses an empty ML-DSA context');
  const prefix = Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex');
  const key = createPublicKey({
    key: Buffer.concat([prefix, Buffer.from(publicKey)]), type: 'spki', format: 'der',
  });
  assert.equal(verify(null, Buffer.from(message), key, Buffer.from(signature)), true);
  const changed = Buffer.from(message);
  changed[0] ^= 1;
  assert.equal(verify(null, changed, key, Buffer.from(signature)), false);
}

function refillRequested(value) { return value.refill_due; }
function pairedStock([a, b]) {
  const peer = new Set([...b.ready, ...b.reserved].map(batchId));
  return [...a.ready, ...a.reserved].map(batchId).filter(Set.prototype.has.bind(peer)).length;
}
async function passiveInventories() { return Promise.all(['a', 'b'].map(passiveInventory)); }
async function passiveInventory(role) {
  const directory = join(persistence, `${role}-RouterAbMlDsaPoolDurableObject`);
  const files = (await readdir(directory)).filter(walletDatabase);
  assert.equal(files.length, 1);
  const database = new DatabaseSync(join(directory, files[0]), { readOnly: true });
  try {
    const rows = database.prepare("SELECT value FROM _cf_KV WHERE key LIKE 'batch/%'").all();
    const ready = [];
    let maximumChunks = 0;
    for (const row of rows) {
      const record = deserialize(row.value);
      if (record.state.state === 'ready'
        && isDeepStrictEqual(record.binding.key, records[0].activation.key)
        && record.binding.expires_at_ms >= Date.now() + policy.operation_timeout_ms) {
        ready.push(record.binding.batch);
        maximumChunks = Math.max(maximumChunks, record.chunks);
      }
    }
    return { ready, maximumChunks };
  } finally {
    database.close();
  }
}
function maximumChunks(value) { return value.maximumChunks; }
async function verifyPassiveInventory() {
  const passive = await passiveInventories();
  const active = await inventories();
  for (let role = 0; role < 2; role += 1) {
    assert.deepEqual(passive[role].ready.map(batchId).sort(), active[role].ready.map(batchId).sort());
  }
  observations.passiveInventoryMatchesWorker = true;
}
async function fileDigest(path) {
  const buildPrefix = 'crates/router-ab-cloudflare/build/';
  const location = path.startsWith(buildPrefix) ? join(buildRoot, path.slice(buildPrefix.length)) : join(root, path);
  const bytes = await readFile(location);
  return [path, createHash('sha256').update(bytes).digest('hex')];
}
