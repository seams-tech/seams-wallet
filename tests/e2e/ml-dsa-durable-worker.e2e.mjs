import { bindWorkerClients, runParallelRefill } from '../helpers/mlDsaParallelRefill.e2e.mjs';
import { calibrateCpuProfiler } from './ml-dsa-cpu-profile.mjs';
import { calibrateMemoryCounters, startMemorySampling } from './ml-dsa-memory-profile.mjs';
import { installMlDsaActivation } from '../helpers/mlDsaActivation.e2e.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { cp, readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
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
const buildRoot = process.env.ML_DSA_TEST_BUILD_ROOT ?? join(root, 'crates/router-ab-cloudflare/build/ml-dsa');
const options = new Set(process.argv.slice(4));
for (const option of options) assert.ok(['--profile-preparation', '--profile-signing', '--profile-memory', '--passive-preparation-observer', '--calibrate-stage-delays', '--parallel-refill-only'].includes(option), 'Unknown measurement option');
const parallelOnly = options.has('--parallel-refill-only');
assert.ok(!parallelOnly || options.size === 1, 'Use the focused parallel scenario without profiling options');
const calibrateStages = options.has('--calibrate-stage-delays');
const stageEvents = [];
const signingEvents = [];
const preparationEvents = [];
const profilePreparation = options.has('--profile-preparation');
const profileSigning = options.has('--profile-signing');
const profileMemory = options.has('--profile-memory');
assert.ok(!profileMemory || (!profilePreparation && !profileSigning), 'Memory sampling needs a separate inspector run');
const passivePreparationObserver = options.has('--passive-preparation-observer');
const authHeader = 'x-router-ab-internal-service-auth';
const serviceAuth = randomBytes(32).toString('hex');
const gatewayAuth = randomBytes(32).toString('hex');
let persistence = await mkdtemp(join(tmpdir(), 'ml-dsa-worker-e2e-'));
// Fault proxies retain their own namespaces. The real object validates its actual namespace.
const admissionRouterPath = join(buildRoot, 'ml-dsa-admission-fault-router.e2e.mjs');
await writeFile(admissionRouterPath, `
export * from './router/worker/shim.mjs';
export { default } from './router/worker/shim.mjs';
import { RouterAbMlDsaAdmissionDurableObject as Admission } from './router/worker/shim.mjs';
export class RouterAbMlDsaAdmissionDurableObject extends Admission {
  constructor(state, env) {
    super(state, { ...env, ML_DSA_ADMISSION_DO: env.ML_DSA_REAL_ADMISSION_DO });
  }
}
`);

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
  max_active_preparations: parallelOnly ? 2 : 1,
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
  ML_DSA_WAIT_DIAGNOSTICS: '1',
};
let takeFaultEnabled = false;
const publicationBarrierScript = `
function holdPublication(resolve) { this.releasePublication = resolve; setTimeout(resolve, 60000); }
function delayAuthorization(resolve) { setTimeout(resolve, 200); }
function expireAdmission(resolve) { setTimeout(resolve, 31000); }
function waitForFailureRelease(resolve) { setTimeout(resolve, 50); }

export class PublicationBarrier {
  constructor(state, env) { this.state = state; this.env = env; }
  async hold(stage, job) {
    if (this.holdClaimed) return;
    this.holdClaimed = true;
    await this.state.storage.delete('hold_stage');
    await this.state.storage.put('held', { stage, job });
    await new Promise(holdPublication.bind(this));
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/release-publication') {
      if (this.releasePublication) this.releasePublication();
      return new Response('Released');
    }
    if (path === '/lose-publication-reply-once') {
      await this.state.storage.put('lose_publication_reply', true);
      return new Response('Armed');
    }
    if (path === '/fail-publication-once') {
      await this.state.storage.put('fail_publication_once', true);
      await this.state.storage.put('failure_released', false);
      await this.state.storage.delete('failed_publication');
      return new Response('Armed');
    }
    if (path === '/release-failed-publication') {
      await this.state.storage.put('failure_released', true);
      return new Response('Released');
    }
    if (path === '/arm-before' || path === '/arm-after' || path === '/arm-before-job') {
      const stage = path === '/arm-after' ? 'after' : 'before';
      const target = path === '/arm-before-job' ? await request.json() : null;
      this.holdClaimed = false;
      await this.state.storage.put('hold_target', target);
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
        inspectionFailures: await this.state.storage.get('inspection_failures') ?? 0,
        lostPublicationReply: await this.state.storage.get('lost_publication_reply') ?? null,
        failedPublication: await this.state.storage.get('failed_publication') ?? null });
    }
    const command = await request.clone().json();
    if (command.command === 'publication_recorded' && await this.state.storage.get('fail_inspection')) {
      await this.state.storage.put('fail_inspection', false);
      await this.state.storage.put('inspection_failures', 1);
      return new Response('Injected inventory failure', {status:503});
    }
    if (command.command === 'put' && await this.state.storage.get('fail_publication_once')) {
      await this.state.storage.delete('fail_publication_once');
      await this.state.storage.put('failed_publication', command.job);
      const deadline = Date.now() + 60000;
      while (!await this.state.storage.get('failure_released') && Date.now() < deadline) {
        await new Promise(waitForFailureRelease);
      }
      return new Response('Injected publication failure', { status: 503 });
    }
    const stage = await this.state.storage.get('hold_stage');
    const target = await this.state.storage.get('hold_target');
    const matchesTarget = !target || JSON.stringify(target) === JSON.stringify(command.job?.batch);
    if (command.command === 'put' && stage === 'before' && matchesTarget) {
      await this.hold(stage, command.job);
    }
    const response = await this.env.ROLE.fetch(request);
    if (command.command === 'put' && response.status === 200 && await this.state.storage.get('lose_publication_reply')) {
      await this.state.storage.delete('lose_publication_reply');
      await this.state.storage.put('lost_publication_reply', command.job);
      return new Response('Injected lost durable publication reply', {status:503});
    }
    if (command.command === 'wake_refill' && response.status === 200 && await this.state.storage.get('lose_wake_reply')) {
      await this.state.storage.put('lose_wake_reply', false);
      await this.state.storage.put('wake_reply_failures', 1);
      return new Response('Injected lost wake acknowledgement', {status:503});
    }
    if (command.command === 'put' && response.status === 200 && stage === 'after' && matchesTarget) {
      await this.hold(stage, command.job);
    }
    return response;
  }
}
export class TakeBarrier {
  constructor(state, env) { this.state = state; this.env = env; this.role = 'b'; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/arm') { await this.state.storage.put('armed', true); return new Response('Armed'); }
    if (path === '/arm-truncated') { await this.state.storage.put('truncate_once', true); return new Response('Armed'); }
    if (path === '/lost') return Response.json(await this.state.storage.get('lost') ?? null);
    if (path === '/takes') return Response.json(await this.state.storage.get('takes') ?? []);
    const command = await request.clone().json();
    const namespace = this.role === 'a' ? this.env.REAL_A : this.env.REAL_B;
    const id = namespace.idFromName(this.env.POOL_NAME);
    const response = await namespace.get(id).fetch(request);
    if ((command.command === 'load_signing_inputs' || command.command === 'take') && response.status === 200) {
      const takes = await this.state.storage.get('takes') ?? [];
      takes.push({ operation: command.permit.request.operation,
        material: command.command === 'take' ? command.batch : command.permit.batches[0] });
      await this.state.storage.put('takes', takes);
    }
    if ((command.command === 'load_signing_inputs' || command.command === 'take')
        && response.status === 200 && await this.state.storage.get('truncate_once')) {
      await this.state.storage.delete('truncate_once');
      await this.state.storage.put('lost', command.permit);
      const bytes = await response.arrayBuffer();
      return new Response(bytes.slice(0, 20), {
        status: 200, headers: { 'content-type': 'application/octet-stream' },
      });
    }
    if ((command.command === 'load_signing_inputs' || command.command === 'take')
        && response.status === 200 && await this.state.storage.get('armed')) {
      await this.state.storage.delete('armed');
      await this.state.storage.put('lost', command.permit);
      return new Response('Lost reply after durable consumption', { status: 503 });
    }
    return response;
  }
}
export class TakeBarrierA extends TakeBarrier {
  constructor(state, env) { super(state, env); this.role = 'a'; }
}
export class AdmissionBarrier {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    if (new URL(request.url).pathname === '/lose-admission') {
      await this.state.storage.put('lose_admission', true);
      return new Response('Armed');
    }
    if (new URL(request.url).pathname === '/lost-admission') {
      return Response.json(await this.state.storage.get('lost_admission') ?? null);
    }
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
    if (new URL(request.url).pathname === '/arm-unused') {
      await this.state.storage.put('unused_job', await request.json());
      return new Response('Armed');
    }
    if (new URL(request.url).pathname === '/unused-state') {
      return Response.json({ before: await this.state.storage.get('unused_before') ?? 0,
        after: await this.state.storage.get('unused_after') ?? 0 });
    }
    if (new URL(request.url).pathname === '/state') {
      return Response.json({ settlementFailures: await this.state.storage.get('failures') ?? 0,
        settlementReplyFailures: await this.state.storage.get('reply_failures') ?? 0,
        heldSettlement: await this.state.storage.get('held_settlement') ?? null });
    }
    const command = await request.clone().json();
    if (command.command === 'admit' && await this.state.storage.get('lose_admission')) {
      await this.state.storage.delete('lose_admission');
      await this.state.storage.put('lost_admission', command);
      await new Promise(expireAdmission);
      return new Response('Admission interrupted after paired reservation', {status:503});
    }
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
    const unused = await this.state.storage.get('unused_job');
    const unusedFinish = command.command === 'finish_refill' && command.outcome === 'unused'
      && unused && JSON.stringify(command.job.batch) === JSON.stringify(unused.batch);
    if (unusedFinish && !await this.state.storage.get('unused_before')) {
      await this.state.storage.put('unused_before', 1);
      return new Response('Injected unused settlement failure', { status: 503 });
    }
    const id = this.env.REAL_ADMISSION.idFromName('ml-dsa-admission-v1');
    const response = await this.env.REAL_ADMISSION.get(id).fetch(request);
    if (unusedFinish && response.status === 200 && !await this.state.storage.get('unused_after')) {
      await this.state.storage.put('unused_after', 1);
      return new Response('Injected lost unused settlement reply', { status: 503 });
    }
    if (command.command === 'finish_refill' && response.status === 200 && await this.state.storage.get('handoff_armed')) {
      await this.state.storage.put('handoff_armed', false);
      await this.state.storage.put('held_settlement', command.job);
      await new Promise(holdPublication.bind(this));
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
let holdNextPeerInventory = false;
let peerInventoryHeld = false;
let peerInventoryRelease = null;
function holdPeerInventory(resolve) { peerInventoryRelease = resolve; }
async function fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/arm-peer-inventory') {
    holdNextPeerInventory = true;
    return new Response('Armed');
  }
  if (path === '/peer-inventory-state') return Response.json({ held: peerInventoryHeld });
  if (path === '/release-peer-inventory') {
    if (peerInventoryRelease) peerInventoryRelease();
    return new Response('Released');
  }
  if (holdNextPeerInventory && path === '/router-ab/ml-dsa/role') {
    const command = await request.clone().json();
    if ((command.command === 'inventory' || command.command === 'live_inventory') && holdNextPeerInventory) {
      holdNextPeerInventory = false;
      peerInventoryHeld = true;
      await new Promise(holdPeerInventory);
      peerInventoryHeld = false;
      peerInventoryRelease = null;
    }
  }
  return env.PEER.fetch(request);
}
export default { fetch };
`;
const producerEvents = [];
const refillAlarmEvents = [];
const executionCompletionEvents = [];
const observations = {
  scope: 'Local workerd, real strict Worker bundles, synthetic canonical wallet key, typed Gateway owner admission, and durable signing. Verified factor inputs, claimed-operation persistence, and custody activation are injected. HTTP login, public session routes, and hosted latency remain outside this test.',
  policy,
  profilePreparation,
  profileSigning,
  profileMemory,
  preparationMemory: [],
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
    'tests/helpers/mlDsaParallelRefill.e2e.mjs',
    'tests/e2e/ml-dsa-memory-profile.mjs',
    'tests/e2e/ml-dsa-cpu-profile.mjs',
    'tests/helpers/mlDsaOwnerAdmission.fixtures.ts',
    'crates/ed25519-yao-cloudflare-bench/scripts/profile_prepared_worker.mjs',
    'crates/router-ab-cloudflare/Cargo.lock',
    'crates/ml-dsa-threshold/Cargo.toml',
    'crates/ml-dsa-threshold/src/runtime/boolean_mpc/silent.rs',
    'crates/ml-dsa-threshold/src/runtime/boolean_mpc/silent/pprf.rs',
    'crates/ml-dsa-threshold/src/runtime/boolean_mpc/silent/correlation_aes.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/workers/preparation.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/workers/preparation/producer.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/workers.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/workers/durable_trace.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/refill.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/pool.rs',
  ].map(fileDigest))),
  workerJsSha256: Object.fromEntries(await Promise.all(['router', 'deriver-a', 'deriver-b'].map(workerJsDigest))),
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
let clients;
let lastSuccessful;
let profileConnections = [];
let memorySamplers = [];
let initialRefillStarted;
try {
  runtime = await createRuntime();
  await runtime.ready;
  observations.idleTimerMs = await timerControl();
  if (profilePreparation || profileSigning) {
    observations.profilerCalibration = await calibrateCpuProfiler(`${artifact}-profiler`);
  }
  if (profilePreparation) {
    profileConnections = await startProfiles(runtime, participantTarget, 1000);
  }
  if (profileMemory) {
    observations.memoryCalibration = await calibrateMemoryCounters();
    for (const role of ['preparer-a', 'preparer-b']) {
      memorySamplers.push(await startMemorySampling(runtime, role));
    }
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
  assert.equal(emptyResult.stock.needed, policy.minimum_ready_batches);
  assert.ok(emptyResult.stock.ready < emptyResult.stock.needed, JSON.stringify(emptyResult.stock));
  const refillStarted = performance.now();
  observations.activationAndInstallationMs = refillStarted - initialRefillStarted;
  await waitReady(policy.refill_target_batches);
  // A full reserve reports every needed batch. The count never exceeds what admission needs.
  const stockKey = { key: records[0].activation.key };
  assert.deepEqual(await post('router', '/router-ab/ml-dsa/stock', stockKey, gatewayAuth), {
    ready: policy.minimum_ready_batches,
    needed: policy.minimum_ready_batches,
  });
  assert.equal((await raw('router', '/router-ab/ml-dsa/stock', stockKey, serviceAuth)).status, 403);
  observations.emptyPoolStock = emptyResult.stock;
  const storedPools = await passiveInventories();
  observations.maximumPreparedChunkCounts = storedPools.map(maximumChunks);
  for (const chunks of observations.maximumPreparedChunkCounts) {
    assert.ok(chunks > 16, 'Signing did not exercise multiple ciphertext I/O groups');
  }
  observations.initialReserveRefillMs = performance.now() - refillStarted;
  observations.activationToFullReserveMs = performance.now() - initialRefillStarted;
  if (profileMemory) {
    while (memorySamplers.length > 0) observations.preparationMemory.push(await memorySamplers.shift().stop());
    for (const record of observations.preparationMemory) assert.equal(record.status, 'complete', JSON.stringify(record));
  }
  if (passivePreparationObserver) await verifyPassiveInventory();
  initialRefillStarted = undefined;
  if (profilePreparation) {
    observations.preparationProfile = {
      scope: 'Local workerd V8 sampling from before activation through first full reserve. Includes setup, storage, protocol waits and idle samples. Sampling can perturb latency. This is not billed CPU.',
      profiles: await stopProfiles(profileConnections),
    };
    profileConnections = [];
  }
  if (!parallelOnly) {
    await runDurableCases(emptyInput);
    observations.storageRollback = await checkStorageRollback();
    observations.stockGeneration = await checkStockGeneration();
    observations.idleMaintenance = await checkIdleMaintenance();
  }
  await waitReady(policy.refill_target_batches);
  await waitForTerminalProducerSettlement();
  await runtime.dispose();
  const parallelPolicy = { ...policy, max_active_preparations: 2 };
  bindings.ML_DSA_ADMISSION_POLICY = JSON.stringify(parallelPolicy);
  runtime = await createRuntime();
  await runtime.ready;
  observations.parallelRefill = await runParallelRefill({
    inventories,
    post,
    admissionCheck: actualAdmissionCheck,
    producerReceipt,
    publicationBarrier: clients.publication,
    peerBarrier: clients.workers.get('publication-barrier'),
    key: records[0].activation.key,
    policy: parallelPolicy,
    preparationEvents,
    progress: parallelProgress,
    publicKey: records[0].public_key,
    verifyStandardSignature,
    serviceAuth,
    gatewayAuth,
  });
  observations.signatures.push({
    operationHex: observations.parallelRefill.operation,
    messageHex: observations.parallelRefill.messageHex,
    contextHex: observations.parallelRefill.contextHex,
    signatureHex: observations.parallelRefill.signatureHex,
    elapsedMs: observations.parallelRefill.signingMs,
    source: 'parallel_refill',
  });
  observations.standardSignaturesVerifiedByRouter = observations.signatures.length;
  observations.standardSignaturesVerifiedByOpenSsl = observations.signatures.length;
  observations.passed = true;
} catch (error) {
  observations.passed = false;
  observations.error = String(error);
  throw error;
} finally {
  closeProfiles(profileConnections);
  for (const sampler of memorySamplers) observations.preparationMemory.push(await sampler.stop());
  await mkdir(resolve(artifact, '..'), { recursive: true });
  observations.signingTraces = signingEvents;
  observations.stageTraces = stageEvents;
  await writeFile(artifact, `${JSON.stringify(observations, null, 2)}\n`);
  await runtime?.dispose();
  await mkdir(resolve(artifact, '..'), { recursive: true });
  observations.signingTraces = signingEvents;
  observations.stageTraces = stageEvents;
  await writeFile(artifact, `${JSON.stringify(observations, null, 2)}\n`);
  await rm(persistence, { recursive: true, force: true });
  console.log(JSON.stringify({ artifact, passed: observations.passed, signingMs: observations.signatures.map(signingTime), stalledPeerClosedMs: observations.stalledPeerClosedMs }));
}
async function restartRuntime() {
  await runtime.dispose();
  runtime = await createRuntime();
  await runtime.ready;
}
function poolDirectories(root) {
  return ['a', 'b'].map((role) => join(root, `${role}-RouterAbMlDsaPoolDurableObject`));
}
async function signRollbackMessage(label) {
  const message = digest(Array.from(Buffer.from(`ML-DSA rollback ${label}`)));
  const owner = await admission.mlDsaOwnerFixture(records[0], new Uint8Array(message), label);
  assert.equal(owner.admitted.kind, 'prepared');
  const deadline = performance.now() + 120000;
  while (true) {
    const response = await admission.dispatchMlDsaOwnerOperation(
      new OwnerRouterProxy(clients.workers.get('router')),
      owner.admitted.operation,
    );
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    if (result.status !== 'unavailable') return { message, result };
    assert.ok(performance.now() < deadline, 'Rollback signing stayed unavailable');
    await new Promise(waitOneSecond);
  }
}
/// Both role stores return to an earlier state. Router admission must still refuse the
/// masks that the earlier signature used, because reuse with a second challenge reveals
/// the key.
async function checkStorageRollback() {
  await waitReady(policy.refill_target_batches);
  await waitForTerminalProducerSettlement();
  await runtime.dispose();
  const snapshot = await mkdtemp(join(tmpdir(), 'ml-dsa-rollback-'));
  for (const directory of poolDirectories(persistence)) {
    await cp(directory, join(snapshot, directory.split('/').at(-1)), { recursive: true });
  }
  runtime = await createRuntime();
  await runtime.ready;
  const [before] = await inventories();
  const signed = await signRollbackMessage('rollback-first');
  assert.equal(signed.result.operation?.state, 'succeeded', JSON.stringify(signed.result));
  verifyStandardSignature(records[0].public_key, signed.message, [], signed.result.operation.signature);
  const [after] = await inventories();
  const remaining = new Set(after.ready.map(batchId));
  const spent = before.ready.map(batchId).filter((id) => !remaining.has(id));
  assert.ok(spent.length > 0, 'The first signature consumed no batch');
  await waitForTerminalProducerSettlement();
  await runtime.dispose();
  for (const directory of poolDirectories(persistence)) {
    await rm(directory, { recursive: true, force: true });
    await cp(join(snapshot, directory.split('/').at(-1)), directory, { recursive: true });
  }
  await rm(snapshot, { recursive: true, force: true });
  runtime = await createRuntime();
  await runtime.ready;
  const restored = await inventories();
  for (const inventory of restored) {
    const ready = inventory.ready.map(batchId);
    assert.ok(spent.every((id) => ready.includes(id)), 'The restore did not bring spent stock back');
  }
  const refused = await signRollbackMessage('rollback-second');
  assert.equal(refused.result.status, 'existing', JSON.stringify(refused.result));
  assert.equal(refused.result.operation.state, 'declined', 'A restored mask reached signing');
  const cleared = await inventories();
  for (const inventory of cleared) {
    const stock = inventory.ready.concat(inventory.reserved).map(batchId);
    assert.ok(spent.every((id) => !stock.includes(id)), 'Refused stock stayed in a role');
  }
  await waitReady(policy.minimum_ready_batches);
  const fresh = await signRollbackMessage('rollback-third');
  assert.equal(fresh.result.operation?.state, 'succeeded', JSON.stringify(fresh.result));
  verifyStandardSignature(records[0].public_key, fresh.message, [], fresh.result.operation.signature);
  return { spent: spent.length, restoredStockOffered: true, refusedOperation: true, freshSignature: true };
}
/// A restore of every store cannot bring back a generation held in deployment settings.
async function checkStockGeneration() {
  await waitReady(policy.refill_target_batches);
  await waitForTerminalProducerSettlement();
  const [before] = await inventories();
  assert.ok(before.ready.length > 0);
  await runtime.dispose();
  bindings.ML_DSA_ADMISSION_POLICY = JSON.stringify({ ...policy, stock_generation: 2 });
  runtime = await createRuntime();
  await runtime.ready;
  const burned = await inventories();
  const previous = new Set(before.ready.map(batchId));
  for (const inventory of burned) {
    assert.ok(inventory.ready.every((id) => !previous.has(batchId(id))), 'Stock of an old generation stayed');
  }
  await waitReady(policy.minimum_ready_batches);
  const signed = await signRollbackMessage('generation-two');
  assert.equal(signed.result.operation?.state, 'succeeded', JSON.stringify(signed.result));
  await waitReady(policy.minimum_ready_batches);
  await waitForTerminalProducerSettlement();
  await runtime.dispose();
  bindings.ML_DSA_ADMISSION_POLICY = JSON.stringify(policy);
  runtime = await createRuntime();
  await runtime.ready;
  return { burnedBatches: before.ready.length, signedAfterBurn: true };
}
/// A key with a full reserve waits for its next expiry. It must not keep polling.
async function checkIdleMaintenance() {
  await waitReady(policy.refill_target_batches);
  await waitForTerminalProducerSettlement();
  await new Promise(function waitForLastPass(resolve) { setTimeout(resolve, 35000); });
  const start = refillAlarmEvents.filter(isControllerPass).length;
  await new Promise(function waitForQuiet(resolve) { setTimeout(resolve, 65000); });
  const passes = refillAlarmEvents.filter(isControllerPass).length - start;
  assert.ok(passes === 0, `An idle key made ${passes} controller passes in 65 s`);
  return { passesIn65Seconds: passes };
}
function isControllerPass(event) {
  return event.event === 'ml_dsa_refill_controller_v1';
}
async function runDurableCases(emptyInput) {
  observations.refillWakeInterleaving = await checkRefillWakeInterleaving();
  observations.unusedPreparation = await checkUnusedPreparation();
  // Let the full-pool maintenance alarm settle before the first consumption.
  await new Promise(waitForQuietPool);
  const emptyReplay = await post('router', '/router-ab/ml-dsa/sign', emptyInput, gatewayAuth);
  assert.equal(emptyReplay.status, 'existing');
  assert.equal(emptyReplay.operation.state, 'succeeded');
  verifyStandardSignature(records[0].public_key, emptyInput.message, [], emptyReplay.operation.signature);
  assert.deepEqual(await post('router', '/router-ab/ml-dsa/sign', emptyInput, gatewayAuth), emptyReplay);
  observations.emptyPoolRetryPreservesOperationAndSignature = true;
  observations.expiredUnadmittedRecovery = await checkExpiredUnadmittedRecovery(emptyInput.request);
  observations.unopenedAfterFailure = await checkUnopenedAfterFailure('lost_reply');
  observations.truncatedMaterialDelivery = await checkUnopenedAfterFailure('truncated');
  await waitReady(policy.refill_target_batches);
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
    let initialStarts = await preprocessingStarts();
    const completionFault = observations.signatures.length === 1 && !observations.publicationCompletionRecovery;
    if (completionFault) {
      assert.equal((await (await publicationBarrier()).fetch('https://fault.internal/lose-publication-reply-once')).status, 200);
    }
    if (index === 0) {
      const barrier = await publicationBarrier();
      assert.equal((await barrier.fetch('https://fault.internal/fail-publication-once')).status, 200);
    }
    if (profileSigning) profileConnections = await startProfiles(runtime, signingTarget, 1000);
    const started = performance.now();
    const router = clients.workers.get('router');
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
        operationHex: Buffer.from(input.request.operation).toString('hex'),
        elapsedMs,
        scope: 'Local workerd online A/B sampling for one HTTP signing request. Includes storage, protocol waits and idle samples. Sampling can perturb latency. This is not billed CPU.',
        profiles: await stopProfiles(profileConnections),
      });
      profileConnections = [];
    }
    assert.equal(result.status, 'existing');
    if (completionFault) {
      const job = await waitForLostPublicationReply();
      await waitForRecoveredPublication(job);
      await waitForLeaseRelease(job);
      const [a, b] = await inventories();
      for (const id of preparationBatches(job)) {
        assert.ok(a.ready.map(batchId).includes(id));
        assert.ok(b.ready.map(batchId).includes(id));
      }
      observations.publicationCompletionRecovery = {
        job, terminalState: await producerState(job),
        pairedReady: true, leaseReleased: true,
        publicationEvidence: {
          state: 'paired_ready_after_lost_reply',
          batches: preparationBatches(job),
          readyA: a.ready.map(batchId),
          readyB: b.ready.map(batchId),
          preparationEventCount: preparationEvents.length,
        },
      };
    }
    if (index === 0) {
      await waitForPreprocessingStart(initialStarts);
      observations.responseToRefillStartedMs = performance.now() - responseAt;
      assert.ok(observations.responseToRefillStartedMs < 3000, 'Settled consumption did not wake refill within three seconds');
      const barrier = await publicationBarrier();
      assert.equal((await barrier.fetch('https://fault.internal/release-failed-publication')).status, 200);
      const failed = await waitForFailedPreparation(barrier);
      const beforeRetry = await admissionCheck({ command: 'claim_refill', key: failed.key, occupied: await stalePreparationStock() });
      assert.equal(beforeRetry.status, 'busy');
      assert.ok(beforeRetry.retry_at_ms > Date.now(), 'A failed producer retried without a delay');
      initialStarts = await preprocessingStarts();
      const [failedA, failedB] = await inventories();
      const readyA = new Set(failedA.ready.map(batchId));
      const readyB = new Set(failedB.ready.map(batchId));
      for (const material of preparationBatches(failed)) {
        assert.ok(!(readyA.has(material) && readyB.has(material)), 'Failed preparation entered paired stock');
      }
      observations.preparationFailure = {
        batch: failed.batch, retryAtMs: beforeRetry.retry_at_ms,
        observedAtMs: Date.now(), startsBeforeRetry: initialStarts,
        terminalState: await producerState(failed), pairedStockObserved: false,
      };
      // Capture the first replacement even if this signing operation exhausts candidates.
      await waitForPreprocessingStart(initialStarts);
      const replacements = await rolePreprocessingJobs('a');
      replacements.sort(newestJobFirst);
      const replacement = replacements[0];
      assert.notDeepEqual(replacement.batch, failed.batch);
      assert.ok(replacement.expires_at_ms - 90000 >= beforeRetry.retry_at_ms,
        'Replacement preparation was admitted before the retry deadline');
      observations.preparationFailure.replacementBatch = replacement.batch;
      observations.preparationFailure.replacementAdmittedAtMs = replacement.expires_at_ms - 90000;
    }
    if (result.operation.state === 'failed') {
      assert.equal(result.operation.failure.reason, 'candidates_exhausted');
      assert.equal(result.operation.failure.evaluated_candidates, result.operation.failure.consumed_batches * policy.candidate_group_size);
      observations.failedOperations.push({ operationHex: Buffer.from(input.request.operation).toString('hex'), elapsedMs, failure: result.operation.failure });
      assert.deepEqual(await (await admission.dispatchMlDsaOwnerOperation(new OwnerRouterProxy(router), prepared)).json(), result);
      continue;
    }
    assert.equal(result.operation.state, 'succeeded');
    assert.equal(result.operation.signature.length, 3309);
    verifyStandardSignature(records[0].public_key, message, input.context, result.operation.signature);
    const recoveredIds = new Set(observations.expiredUnadmittedRecovery.batches.map(batchId));
    for (const event of stageEvents) {
      if (event.operation === batchId(input.request.operation) && event.context.kind === 'take_store'
          && recoveredIds.has(batchId(event.context.material))) {
        observations.expiredUnadmittedRecovery.verifiedReuseOperation = event.operation;
      }
    }
    assert.deepEqual(await (await admission.dispatchMlDsaOwnerOperation(new OwnerRouterProxy(router), prepared)).json(), result);
    const changed = structuredClone(input);
    changed.message.push(0);
    changed.request.message_digest = digest(changed.message);
    const refusal = await raw('router', '/router-ab/ml-dsa/sign', changed, gatewayAuth);
    assert.notEqual(refusal.status, 200);
    observations.signatures.push({
      operationHex: Buffer.from(input.request.operation).toString('hex'),
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
      await assertProducerRefused(changedJob);
      observations.producerQueueRetryAndBindingChecks = true;
      const held = await waitForHeldPublication(barrier);
      assert.equal(held.stage, 'after');
      assert.deepEqual(held.job, job);
      const [publishedA, publishedB] = await inventories();
      const batches = preparationBatches(job);
      for (const role of [publishedA, publishedB]) {
        for (const batch of batches) {
          assert.ok(role.ready.map(batchId).includes(batch), 'The reset fixture lacks paired publication');
        }
      }
      observations.interruptedProducer = {
        batch: job.batch,
        publicationEvidence: {
          state: 'paired_ready_before_interruption',
          batches,
          readyA: publishedA.ready.map(batchId),
          readyB: publishedB.ready.map(batchId),
          preparationEventCount: preparationEvents.length,
        },
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
      runtime = await createRuntime();
      await runtime.ready;
      await waitForRecoveredPublication(job);
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
  assert.equal(observations.publicationCompletionRecovery?.terminalState, 'published');
  observations.automaticRefillAfterSigning = true;
  await waitReady(policy.refill_target_batches);
  await runtime.dispose();
  bindings.ML_DSA_ADMISSION_POLICY = JSON.stringify({ ...policy, operation_timeout_ms: 1000 });
  runtime = await createRuntime();
  await runtime.ready;
  assert.deepEqual(
    await (await admission.dispatchMlDsaOwnerOperation(new OwnerRouterProxy(clients.workers.get('router')), lastSuccessful.prepared)).json(),
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
  const peer = clients.workers.get('b');
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
  const firstReply = once(socket, 'message', { signal: AbortSignal.timeout(2000) });
  socket.accept();
  await new Promise(waitBeforeProtocolFrame);
  const executionBinding = executionRequestBinding(admitted.permit, policy.candidate_group_size);
  socket.send(protocolFrame(executionBinding, 0, 0));
  const [firstMessage] = await firstReply;
  checkProtocolReply(firstMessage, executionBinding, 0, 1);
  const secondReply = once(socket, 'message', { signal: AbortSignal.timeout(2000) });
  await new Promise(waitBeforeProtocolFrame);
  const activationBinding = reservationBinding(records[1].public_key, admitted.permit, policy.candidate_group_size);
  socket.send(protocolFrame(activationBinding, 1, 1));
  const [secondMessage] = await secondReply;
  checkProtocolReply(secondMessage, activationBinding, 1, 2);
  observations.stalledValidExchanges = 2;
  const inspectStarted = performance.now();
  const activePool = await post('b', '/router-ab/ml-dsa/role', {
    command: 'inspect', key: stalled.key, batches: [admitted.permit.batches[0]],
  });
  observations.stalledPoolResponsiveMs = performance.now() - inspectStarted;
  assert.deepEqual(activePool, ['retired'], 'Pending signing did not commit single-use material');
  assert.ok(Date.now() < admitted.permit.expires_at_ms, 'Pool inspection waited for signing to end');
  observations.stalledPairRetiredBeforeClose = true;
  const [closeEvent] = await closed;
  assert.equal(closeEvent.code, 1011, 'The stalled peer did not signal an execution failure');
  observations.stalledPeerCloseCode = closeEvent.code;
  observations.stalledPeerClosedMs = performance.now() - started;
  observations.stalledDeadlineOverrunMs = Date.now() - admitted.permit.expires_at_ms;
  assert.ok(observations.stalledDeadlineOverrunMs < 200, 'Later valid frames extended the absolute signing deadline');
  observations.stalledSocketWaitMs = observations.stalledPeerClosedMs - observations.stalledHandshakeMs;
  observations.concurrentTimerMs = await control;
  assert.ok(observations.stalledPeerClosedMs < 2000, 'The idle signing peer exceeded the timeout tolerance');
  assert.ok(observations.concurrentTimerMs < 2000, 'Background work delayed the independent timer');
  const expired = await post('router', '/router-ab/ml-dsa/status', stalled, gatewayAuth);
  assert.equal(expired.state, 'failed');
  assert.deepEqual(expired.failure, { reason: 'deadline_exceeded' });
  observations.stalledOperationExpiredWithoutSignature = true;
  const stopped = [];
  for (const trace of signingEvents) {
    if (trace.role === 'b' && trace.operation === batchId(stalled.operation)) stopped.push(trace);
  }
  assert.equal(stopped.length, 1, 'Missing canceled B signing trace');
  assert.equal(stopped[0].completed, false);
  const consumedAfterCancellation = await post('b', '/router-ab/ml-dsa/role', {
    command: 'inspect', key: stalled.key, batches: [admitted.permit.batches[0]],
  });
  assert.deepEqual(consumedAfterCancellation, ['retired']);
  let consumedJob = null;
  for (const job of await rolePreprocessingJobs('b')) {
    if (preparationBatches(job).includes(batchId(admitted.permit.batches[0]))) consumedJob = job;
  }
  assert.ok(consumedJob, 'Consumed pair lacks its preparation job');
  assert.equal(await post('b', '/router-ab/ml-dsa/role', {
    command: 'publication_recorded', job: consumedJob,
  }), true);
  const wrongExpiry = structuredClone(consumedJob);
  wrongExpiry.material_expires_at_ms += 1;
  assert.equal(await post('b', '/router-ab/ml-dsa/role', {
    command: 'publication_recorded', job: wrongExpiry,
  }), false);
  observations.publicationEvidenceSurvivesConsumption = true;
  observations.publicationEvidenceRejectsChangedExpiry = true;
  const canceledReplay = await raw('b', '/router-ab/ml-dsa/role', {
    command: 'take', permit: admitted.permit, batch: admitted.permit.batches[0],
  }, serviceAuth);
  assert.notEqual(canceledReplay.status, 200);
  observations.canceledSigningExecution = {
    operation: batchId(stalled.operation),
    firstPairRetired: true,
    consumedReplayRejected: true,
  };
  observations.prepublicationFallback = await checkPrepublicationFallback();
  observations.producerHandoff = {
    liveTimeout: await checkProducerHandoff(false),
    restart: await checkProducerHandoff(true),
  };
  observations.committedExecution = committedExecutionEvidence();
  observations.preparationResources = preparationResourceEvidence();
  assert.ok(observations.expiredUnadmittedRecovery.verifiedReuseOperation,
    'No verified signature consumed the reclaimed untouched material');
}

async function parallelProgress(stage, data) {
  const entry = { stage, atMs: Date.now(), ...data };
  await writeFile(artifact + '.parallel-progress.json', JSON.stringify(entry, null, 2) + '\n');
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
async function createRuntime() {
  const next = new Miniflare({
    handleRuntimeStdio,
    workers: workers(),
    durableObjectsPersist: persistence,
    inspectorPort: profilePreparation || profileSigning || profileMemory ? 0 : undefined,
  });
  await next.ready;
  clients = await bindWorkerClients(next, fixturePoolName());
  return next;
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
      scriptPath: admissionRouterPath,
      durableObjects: {
        ML_DSA_ADMISSION_DO: {
          className: 'AdmissionBarrier', scriptName: 'publication-barrier',
        },
        ML_DSA_REAL_ADMISSION_DO: {
          className: 'RouterAbMlDsaAdmissionDurableObject', useSQLite: true,
        },
      },
      serviceBindings: { DERIVER_A: 'a', DERIVER_B: 'b' },
    },
    roleWorker('a', 0),
    roleWorker('b', 1),
    preparerWorker('a', 0, 'primary'),
    preparerWorker('b', 1, 'primary'),
    preparerWorker('a', 0, 'secondary'),
    preparerWorker('b', 1, 'secondary'),
    {
      name: 'publication-barrier',
      modules: true,
      script: publicationBarrierScript,
      bindings: { POOL_NAME: fixturePoolName() },
      durableObjects: {
        BARRIER: { className: 'PublicationBarrier', useSQLite: true },
        TAKE_BARRIER: { className: 'TakeBarrier', useSQLite: true },
        TAKE_BARRIER_A: { className: 'TakeBarrierA', useSQLite: true },
        REAL_A: { className: 'RouterAbMlDsaPoolDurableObject', scriptName: 'a' },
        REAL_B: { className: 'RouterAbMlDsaPoolDurableObject', scriptName: 'b' },
        ADMISSION_BARRIER: { className: 'AdmissionBarrier', useSQLite: true },
        REAL_ADMISSION: { className: 'RouterAbMlDsaAdmissionDurableObject', scriptName: 'router' },
      },
      serviceBindings: { ROLE: 'a', PEER: 'b' },
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
    serviceBindings: { DERIVER_B: role === 'a' ? 'publication-barrier' : 'b' },
  };
  if (takeFaultEnabled) {
    worker.durableObjects.ML_DSA_POOL_DO = { className: role === 'a' ? 'TakeBarrierA' : 'TakeBarrier', scriptName: 'publication-barrier' };
  }
  if (role === 'a') {
    worker.durableObjects.ML_DSA_PRODUCER_DO = {
      className: 'RouterAbMlDsaProducerDurableObject', scriptName: 'preparer-a',
    };
    worker.durableObjects.ML_DSA_SECONDARY_PRODUCER_DO = {
      className: 'RouterAbMlDsaProducerDurableObject', scriptName: 'preparer-a-secondary',
    };
  }
  if (calibrateStages && role === 'a') {
    worker.durableObjects.ML_DSA_ADMISSION_DO = {
      className: 'AdmissionBarrier', scriptName: 'publication-barrier',
    };
  }
  return worker;
}
function preparerWorker(role, index, slot) {
  const worker = roleWorker(role, index);
  const suffix = slot === 'secondary' ? '-secondary' : '';
  worker.name = `preparer-${role}${suffix}`;
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
  worker.serviceBindings = { DERIVER_B: `preparer-b${suffix}` };
  return worker;
}
async function producerReceipt(job, credential) {
  const stub = clients.producers.get(job.producer_slot);
  return stub.fetch('https://ml-dsa.internal/router-ab/ml-dsa/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [authHeader]: credential },
    body: JSON.stringify(job),
  });
}

async function assertProducerRefused(job) {
  const before = await producerSnapshot(job.batch);
  const response = await producerReceipt(job, serviceAuth);
  assert.equal(response.status, 202);
  assert.equal(await response.json(), false, 'A producer queued a job without a live lease');
  assert.deepEqual(await producerSnapshot(job.batch), before, 'A refused job changed producer state');
}

async function raw(worker, path, input, credential) {
  const fetcher = clients.workers.get(worker);
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
  return clients.publication;
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

async function waitForLostPublicationReply() {
  const deadline = Date.now() + 60000;
  const barrier = await publicationBarrier();
  while (Date.now() < deadline) {
    const state = await (await barrier.fetch('https://fault.internal/state')).json();
    if (state.lostPublicationReply) return state.lostPublicationReply;
    await new Promise(waitForMarker);
  }
  throw new Error('Publication reply loss was not observed');
}

async function waitForFailedPreparation(barrier) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const state = await (await barrier.fetch('https://fault.internal/state')).json();
    const job = state.failedPublication;
    if (job && await producerState(job) === 'failed'
      && !await admissionCheck({ command: 'check_refill', job })) return job;
    await new Promise(waitForMarker);
  }
  throw new Error('Injected publication failure did not settle durably');
}

async function waitForRecoveredPublication(job) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    if (await producerState(job) === 'published') return;
    await new Promise(waitForMarker);
  }
  throw new Error('Paired publication was not confirmed after restart before its deadline');
}

async function admissionBarrier() {
  return clients.admissionBarrier;
}

async function checkExpiredUnadmittedRecovery(template) {
  await waitReady(policy.refill_target_batches);
  const request = {...template, operation: Array.from(randomBytes(32))};
  const barrier = await admissionBarrier();
  assert.equal((await barrier.fetch('https://fault.internal/lose-admission')).status, 200);
  const interrupted = await raw('router', '/router-ab/ml-dsa/admit', request, gatewayAuth);
  assert.notEqual(interrupted.status, 200);
  const attempted = await (await barrier.fetch('https://fault.internal/lost-admission')).json();
  assert.deepEqual(attempted.claim.request, request);
  assert.equal(attempted.batches.length, policy.refill_target_batches);
  const status = await post('router', '/router-ab/ml-dsa/status', request, gatewayAuth);
  assert.equal(status.state, 'declined');
  const inventoriesAfterRecovery = await inventories();
  for (const role of inventoriesAfterRecovery) {
    const ready = new Set(role.ready.map(batchId));
    assert.ok(attempted.batches.every(batchInSet.bind(null, ready)), 'Unadmitted material was lost');
  }
  const forgedPermit = {request, expires_at_ms: attempted.claim.expires_at_ms, batches: attempted.batches};
  for (const role of ['a', 'b']) {
    assert.notEqual((await raw(role, '/router-ab/ml-dsa/role', {
      command:'reserve', claim:attempted.claim, batches:attempted.batches,
    }, serviceAuth)).status, 200);
    assert.notEqual((await raw(role, '/router-ab/ml-dsa/role', {
      command:'take', permit:forgedPermit, batch:attempted.batches[0],
    }, serviceAuth)).status, 200);
  }
  assert.equal((await post('router', '/router-ab/ml-dsa/admit', request, gatewayAuth)).operation.state, 'declined');
  return {request, batches:attempted.batches, status, recoveredPairs:attempted.batches.length,
    delayedReservationRejected:true, unadmittedTakeRejected:true};
}
function batchInSet(ids, batch) { return ids.has(batchId(batch)); }

async function admissionCheck(command) {
  return admissionQuery(clients.admission, command);
}
async function actualAdmissionCheck(command) {
  return admissionQuery(clients.actualAdmission, command);
}
async function admissionQuery(stub, command) {
  const response = await stub.fetch('https://admission.internal/check', {
    method: 'POST', headers: { 'content-type': 'application/json', [authHeader]: serviceAuth },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
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
  runtime = await createRuntime();
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
  assert.deepEqual(await admissionCheck({ command: 'finish_refill', job, outcome: 'interrupted' }), []);
  assert.equal(await admissionCheck({ command: 'check_refill', job: fresh }), true);
  await assertProducerRefused(job);
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
  if (event.event === 'ml_dsa_refill_controller_v1' || event.event === 'ml_dsa_refill_alarm_v1') refillAlarmEvents.push(event);
  if (event.event === 'ml_dsa_stage_trace_v1') stageEvents.push(event);
  if (event.event === 'ml_dsa_signing_trace_v1') signingEvents.push(event);
  if (event.event === 'ml_dsa_preparation_stage_v1') preparationEvents.push(event);
  if (event.event === 'ml_dsa_socket_completion_v1' || event.event === 'ml_dsa_signing_outcome_v1') executionCompletionEvents.push(event);
}

function preparationResourceEvidence() {
  assert.ok(preparationEvents.length > 0, 'Preparation resource observations are absent');
  for (const event of preparationEvents) {
    assert.match(event.module_instance, /^[0-9a-f]{32}$/);
    assert.ok(Number.isSafeInteger(event.wasm_linear_memory_bytes) && event.wasm_linear_memory_bytes > 0);
    assert.equal(event.wasm_linear_memory_bytes % 65536, 0);
    assert.ok(Number.isSafeInteger(event.resource_observed_at_ms) && event.resource_observed_at_ms > 0);
  }
  return {
    scope: 'Allocated Wasm linear memory at logging boundaries. This excludes JS heap and does not measure live allocations or total isolate peak memory.',
    stages: preparationEvents,
  };
}

function committedExecutionEvidence() {
  const rows = [];
  for (const signature of observations.signatures) {
    const roles = new Set();
    for (const trace of signingEvents) {
      if (trace.operation !== signature.operationHex || !trace.completed) continue;
      assert.equal(roles.has(trace.role), false, 'A signature repeated participant execution');
      roles.add(trace.role);
      let onlineStart = null;
      const layers = [];
      for (const phase of trace.transport.phases) {
        if (phase.phase === 4) {
          assert.equal(onlineStart, null);
          onlineStart = phase.sent_frames;
        } else if (phase.phase === 5) {
          assert.notEqual(onlineStart, null);
          layers.push(phase.sent_frames - onlineStart);
          onlineStart = null;
        }
      }
      assert.equal(onlineStart, null);
      let pairs = 0;
      const publicationSources = [];
      for (const batch of trace.batches) {
        if (batch.value.stage !== 'checked') continue;
        pairs += 1;
        const material = Buffer.from(batch.value.material_id).toString('hex');
        let commitment = -1;
        let publication = -1;
        for (let index = 0; index < preparationEvents.length; index += 1) {
          const event = preparationEvents[index];
          if (event.role !== trace.role || event.batch !== material) continue;
          if (event.stage === 'commitment_completed') commitment = index;
          if (event.stage === 'published') publication = index;
        }
        assert.ok(commitment >= 0, 'Consumed refill lacks completed private commitments');
        if (publication < 0) {
          const evidence = durablePublicationEvidence(material);
          assert.ok(evidence, 'Missing publication lacks an exact paired-ready proof');
          assert.ok(evidence.readyA.includes(material) && evidence.readyB.includes(material),
            'Interrupted publication lacks paired durable ready state');
          assert.ok(commitment < evidence.preparationEventCount,
            'Private commitments were not observed before durable ready state');
          publicationSources.push({ material, source: evidence.state });
        } else {
          assert.ok(publication > commitment, 'Refill publication preceded private commitment completion');
          publicationSources.push({ material, source: 'producer_completion' });
        }
      }
      assert.ok(pairs > 0);
      let andLayerDataFrames = 0;
      for (const depth of layers) andLayerDataFrames += depth;
      assert.ok(andLayerDataFrames > 0 && andLayerDataFrames <= pairs * 214,
        'Committed refill exceeded its reviewed online AND-layer budget');
      rows.push({ operation: trace.operation, role: trace.role, pairs, layers,
        andLayerDataFrames, commitmentsFinishedBeforePublication: true, publicationSources });
    }
    assert.deepEqual(roles, new Set(['a', 'b']));
  }
  return {
    scope: 'GMW Online-to-Output data-frame deltas. Binding, inputs, outputs, acknowledgments, and control messages are excluded.',
    andLayerDataFramesBudgetPerPair: 214,
    roleTraces: rows,
  };
}

async function checkProducerHandoff(restart) {
  await runtime.dispose();
  await rm(persistence, { recursive: true, force: true });
  persistence = await mkdtemp(join(tmpdir(), 'ml-dsa-handoff-e2e-'));
  bindings.ML_DSA_ADMISSION_POLICY = JSON.stringify(policy);
  runtime = await createRuntime();
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
    runtime = await createRuntime();
    await runtime.ready;
  }
  await assertProducerRefused(held);
  assert.deepEqual(await admissionCheck({ command: 'finish_refill', job: held, outcome: 'interrupted' }), []);
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

async function checkRefillWakeInterleaving() {
  await waitForTerminalProducerSettlement();
  const barrier = clients.workers.get('publication-barrier');
  assert.equal((await barrier.fetch('https://fault.internal/arm-peer-inventory')).status, 200);
  await post('a', '/router-ab/ml-dsa/role', { command: 'wake_refill', key: records[0].activation.key });
  const deadline = performance.now() + 10000;
  let held = false;
  while (performance.now() < deadline) {
    const state = await (await barrier.fetch('https://fault.internal/peer-inventory-state')).json();
    if (state.held) { held = true; break; }
    await new Promise(waitForMarker);
  }
  assert.equal(held, true, 'The controller did not reach the held peer inventory');
  const previous = refillAlarmEvents.filter(isControllerAlarm).length;
  const eventCount = refillAlarmEvents.length;
  await post('a', '/router-ab/ml-dsa/role', { command: 'wake_refill', key: records[0].activation.key });
  const scheduled = refillAlarmEvents.slice(eventCount).filter(isWakeAlarm);
  assert.ok(scheduled.length > 0, 'The wake alarm observation is missing');
  for (const event of scheduled) {
    assert.ok(event.after_ms <= event.requested_ms + 50, 'Wake acknowledgement retained the maintenance delay');
  }
  const releasedAt = performance.now();
  await new Promise(waitPastWakeDeadline);
  assert.equal((await barrier.fetch('https://fault.internal/release-peer-inventory')).status, 200);
  while (performance.now() - releasedAt < 3000 && refillAlarmEvents.filter(isControllerAlarm).length <= previous) {
    await new Promise(waitForMarker);
  }
  const next = refillAlarmEvents.filter(isControllerAlarm).length;
  assert.ok(next > previous, 'Maintenance scheduling postponed a pending refill wake');
  const stocks = await inventories();
  for (const stock of stocks) assert.equal(stock.ready.length, policy.refill_target_batches);
  return { heldPeerInventory: true, wakeAcknowledgedDuringAlarm: true,
    maintenanceDidNotPostponeWake: true, heldBeyondWakeDeadline: true, releaseToNextAlarmUpperBoundMs: performance.now() - releasedAt,
    sameActorAlarmObservations: scheduled };
}
function waitPastWakeDeadline(resolve) { setTimeout(resolve, 200); }
function isControllerAlarm(event) { return event.event === 'ml_dsa_refill_controller_v1'; }
function isWakeAlarm(event) { return event.event === 'ml_dsa_refill_alarm_v1'; }

async function stalePreparationStock() {
  const [a, b] = await inventories();
  const known = new Map();
  for (const batch of [...a.ready, ...a.reserved, ...b.ready, ...b.reserved]) known.set(batchId(batch), batch);
  return Array.from(known.values()).slice(0, policy.refill_target_batches - 2);
}

async function claimPreparation() {
  const result = await admissionCheck({ command: 'claim_refill', key: records[0].activation.key, occupied: await stalePreparationStock() });
  assert.equal(result.status, 'acquired');
  return result.job;
}

async function waitUnused(job) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    if (await producerState(job) === 'unused') return;
    await new Promise(waitForMarker);
  }
  throw new Error('An unnecessary producer did not settle without cryptographic work');
}

async function checkUnusedPreparation() {
  await waitForTerminalProducerSettlement();
  const initial = await inventories();
  const markers = await preprocessingStarts();
  for (const role of initial) assert.equal(role.ready.length, policy.refill_target_batches);
  const failed = await claimPreparation();
  await admissionCheck({ command: 'finish_refill', job: failed, outcome: 'failed' });
  const blocked = await admissionCheck({ command: 'claim_refill', key: failed.key, occupied: await stalePreparationStock() });
  assert.equal(blocked.status, 'busy');
  await delayUntil(blocked.retry_at_ms);
  const unused = await claimPreparation();
  const barrier = await admissionBarrier();
  assert.equal((await barrier.fetch('https://fault.internal/arm-unused', {
    method: 'POST', body: JSON.stringify(unused),
  })).status, 200);
  assert.equal((await producerReceipt(unused, serviceAuth)).status, 202);
  await waitUnused(unused);
  const failureDeadline = performance.now() + 5000;
  let faults;
  while (performance.now() < failureDeadline) {
    faults = await (await barrier.fetch('https://fault.internal/unused-state')).json();
    if (faults.before === 1) break;
    await new Promise(waitForMarker);
  }
  assert.equal(faults.before, 1);
  assert.equal(await admissionCheck({ command: 'check_refill', job: unused }), true);
  await runtime.dispose();
  runtime = await createRuntime();
  await runtime.ready;
  await waitForLeaseRelease(unused);
  await waitForTerminalProducerSettlement();
  const restartedBarrier = await admissionBarrier();
  faults = await (await restartedBarrier.fetch('https://fault.internal/unused-state')).json();
  assert.deepEqual(faults, { before: 1, after: 1 });
  assert.equal(await producerState(unused), 'unused');
  assert.deepEqual(await preprocessingStarts(), markers, 'Unused work claimed participant material');
  const after = await inventories();
  for (let index = 0; index < initial.length; index++) {
    assert.deepEqual(after[index].ready.map(batchId).sort(), initial[index].ready.map(batchId).sort());
  }
  const running = producerEvents.filter(isRunningJob, batchId(unused.batch));
  assert.equal(running.length, 1, 'Unused recovery restarted the producer');
  const cryptographicStages = preparationEvents.filter(matchesCryptoJob.bind(null, unused));
  assert.deepEqual(cryptographicStages, [], 'Unused work entered the cryptographic protocol');
  const replacement = await claimPreparation();
  assert.deepEqual(await admissionCheck({ command: 'finish_refill', job: unused, outcome: 'unused' }), []);
  assert.equal(await admissionCheck({ command: 'check_refill', job: replacement }), true);
  await admissionCheck({ command: 'finish_refill', job: replacement, outcome: 'failed' });
  const finishedAt = Date.now();
  const secondBackoff = await admissionCheck({ command: 'claim_refill', key: failed.key, occupied: await stalePreparationStock() });
  assert.equal(secondBackoff.status, 'busy');
  assert.ok(secondBackoff.retry_at_ms - finishedAt >= 3500, 'Unused settlement reset failure backoff');
  await delayUntil(secondBackoff.retry_at_ms);
  const onePair = initial[0].ready.slice(0, 1);
  for (const role of ['a', 'b']) {
    await post(role, '/router-ab/ml-dsa/role', {
      command: 'retire_unpaired', key: failed.key, batches: onePair,
    });
  }
  const oversized = await claimPreparation();
  assert.equal((await producerReceipt(oversized, serviceAuth)).status, 202);
  await waitUnused(oversized);
  await waitForLeaseRelease(oversized);
  await waitReady(policy.refill_target_batches);
  await waitForTerminalProducerSettlement();
  const restored = await inventories();
  for (const role of restored) assert.equal(role.ready.length, policy.refill_target_batches);
  const freshJobs = await rolePreprocessingJobs('a');
  const beforeJobs = new Set((await rolePreprocessingJobs('b')).map(preparationIdentity));
  const bounded = freshJobs.filter(isSingleGroup);
  assert.ok(bounded.length > 0, 'A smaller replacement did not refill the single missing pair');
  for (const job of bounded) assert.ok(beforeJobs.has(preparationIdentity(job)));
  return { unusedJob: unused, shrunkJob: oversized, fullStockUnchanged: true,
    roleClaimsAbsent: true, cryptoStagesAbsent: true, producerExecutions: running.length,
    restart: true, lostSettlementBeforeAndAfterCommit: faults,
    staleFinishPreservedNewLease: true, failureBackoffPreserved: true,
    smallerReplacement: true, readyPairs: restored.map(readyCount) };
}

function matchesCryptoJob(job, event) {
  return event.job === batchId(job.batch) && event.stage === 'crypto_started';
}
function preparationIdentity(job) { return batchId(job.batch); }
function isSingleGroup(job) { return job.groups === 'one'; }
function readyCount(value) { return value.ready.length; }
async function delayUntil(timestamp) {
  const deadline = timestamp + 50;
  while (Date.now() < deadline) await new Promise(waitForMarker);
}

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
        if (['published', 'unused', 'failed', 'interrupted'].includes(value.state)) jobs.push(value.job);
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

async function workerJsDigest(role) {
  const bytes = await readFile(join(buildRoot, role, 'index.js'));
  return [role, createHash('sha256').update(bytes).digest('hex')];
}

async function wasmDigest(role) {
  const bytes = await readFile(join(buildRoot, role, 'index_bg.wasm'));
  return [role, createHash('sha256').update(bytes).digest('hex')];
}

async function timerControl() {
  const peer = clients.workers.get('timer-control');
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

function waitBeforeProtocolFrame(resolve) {
  setTimeout(resolve, 150);
}
function keyWire(key) {
  return {
    wallet: {
      org: key.wallet.org,
      project: key.wallet.project,
      environment: key.wallet.environment,
      wallet: key.wallet.wallet,
    },
    key_id: key.key_id,
    epoch: key.epoch,
    public_key_digest: key.public_key_digest,
    schedule_digest: key.schedule_digest,
  };
}
function executionRequestBinding(permit, candidates) {
  const request = permit.request;
  const canonical = {
    request: {
      key: keyWire(request.key),
      operation: request.operation,
      message_digest: request.message_digest,
      context_digest: request.context_digest,
    },
    expires_at_ms: permit.expires_at_ms,
    batches: permit.batches,
  };
  return createHash('sha256')
    .update('seams/ml-dsa/durable-execution/v1')
    .update(JSON.stringify([canonical, candidates]))
    .digest();
}
function reservationBinding(publicKey, permit, candidates) {
  const epoch = createHash('sha256')
    .update('seams/ml-dsa/material-epoch/v1')
    .update(JSON.stringify(keyWire(permit.request.key)))
    .digest();
  const width = Buffer.alloc(2);
  width.writeUInt16LE(candidates);
  return createHash('shake256', { outputLength: 64 })
    .update('seams/ml-dsa-65/prepared-signing/reservation/v1')
    .update(Buffer.from(publicKey))
    .update(Buffer.from(permit.batches[0]))
    .update(epoch)
    .update(width)
    .update(Buffer.from([1]))
    .digest();
}
function protocolFrame(payload, sequence, acknowledged) {
  const frame = Buffer.alloc(payload.length + 9);
  frame[0] = 0;
  frame.writeUInt32LE(sequence, 1);
  frame.writeUInt32LE(acknowledged, 5);
  payload.copy(frame, 9);
  return frame;
}
function checkProtocolReply(message, payload, sequence, acknowledged) {
  assert.deepEqual(Buffer.from(message.data), protocolFrame(payload, sequence, acknowledged));
}

function fixturePoolName() {
  const wallet = records[0].activation.key.wallet;
  const ordered = { org: wallet.org, project: wallet.project, environment: wallet.environment, wallet: wallet.wallet };
  return 'ml-dsa-pool-' + createHash('sha256').update('wallet').update(JSON.stringify(ordered)).digest('hex');
}
async function dispatchFixtureMessage(label) {
  const message = digest(Array.from(Buffer.from(label)));
  const owner = await admission.mlDsaOwnerFixture(records[0], new Uint8Array(message), label);
  assert.equal(owner.admitted.kind, 'prepared');
  const router = clients.workers.get('router');
  const response = await admission.dispatchMlDsaOwnerOperation(new OwnerRouterProxy(router), owner.admitted.operation);
  assert.equal(response.status, 200, await response.clone().text());
  return { message, operation: JSON.parse(owner.admitted.operation.encode()).request.operation, result: await response.json() };
}
async function checkUnopenedAfterFailure(fault) {
  await waitReady(policy.refill_target_batches);
  await new Promise(waitForQuietPool);
  await runtime.dispose();
  takeFaultEnabled = true;
  runtime = await createRuntime();
  await runtime.ready;
  const barrier = clients.takeB;
  assert.equal((await barrier.fetch('https://fault.internal' + materialFaultPath(fault))).status, 200);
  const failureStarted = performance.now();
  const failed = await dispatchFixtureMessage('retained-after-' + fault);
  const failureSettledMs = performance.now() - failureStarted;
  assert.ok(failureSettledMs < 5000, 'Input-load failure waited for signing expiry');
  assert.equal(failed.result.status, 'existing');
  assert.equal(failed.result.operation.state, 'failed');
  const operationId = batchId(failed.operation);
  const closeEvents = executionCompletionEvents.filter(isFailedSocketClose, operationId);
  assert.ok(closeEvents.length > 0, 'Initialization failure did not request peer closure');
  const expectedFailure = fault === 'truncated' ? 'invalid_material' : 'material_unavailable';
  assert.equal(failed.result.operation.failure.reason, expectedFailure);
  const lost = await (await barrier.fetch('https://fault.internal/lost')).json();
  assert.ok(lost && lost.batches.length === policy.refill_target_batches);
  const rows = await inventories();
  const oldIds = new Set(lost.batches.map(batchId));
  const paired = rows[0].ready.filter(batchInSet.bind(null, new Set(rows[1].ready.map(batchId))));
  const retained = paired.filter(batchInSet.bind(null, oldIds));
  assert.ok(retained.length >= policy.minimum_ready_batches, 'Unopened pairs were discarded after failure');
  assert.ok(!retained.some(batchInSet.bind(null, new Set([batchId(lost.batches[0])]))), 'Consumed first pair was reused');
  for (const role of ['a','b']) {
    assert.notEqual((await raw(role, '/router-ab/ml-dsa/role', {command:'take',permit:lost,batch:retained[0]}, serviceAuth)).status, 200);
  }
  await new Promise(waitForQuietPool);
  const fresh = await dispatchFixtureMessage('fresh-after-' + fault);
  assert.equal(fresh.result.operation.state, 'succeeded');
  verifyStandardSignature(records[0].public_key, fresh.message, [], fresh.result.operation.signature);
  const aBarrier = clients.takeA;
  const aTakes = await (await aBarrier.fetch('https://fault.internal/takes')).json();
  const bTakes = await (await barrier.fetch('https://fault.internal/takes')).json();
  const retainedIds = new Set(retained.map(batchId));
  const freshId = batchId(fresh.operation);
  const aConsumed = aTakes.filter(retainedTake.bind(null, freshId, retainedIds)).map(takenId).sort();
  const bConsumed = bTakes.filter(retainedTake.bind(null, freshId, retainedIds)).map(takenId).sort();
  assert.ok(aConsumed.length > 0, 'Fresh signature did not consume retained material');
  assert.deepEqual(aConsumed, bConsumed, 'Both roles must confirm the retained takes');
  assert.equal(new Set(aConsumed).size, aConsumed.length);
  const recoveredIds = new Set(observations.expiredUnadmittedRecovery.batches.map(batchId));
  if (aConsumed.some(recoveredIds.has.bind(recoveredIds))) {
    observations.expiredUnadmittedRecovery.verifiedReuseOperation = freshId;
  }
  await runtime.dispose();
  takeFaultEnabled = false;
  runtime = await createRuntime();
  await runtime.ready;
  return { failureSettledMs, failureRequestedPeerClose: true, failureOutcome: failed.result.operation.failure, retainedPairs: retained.length, consumedRetainedPairs: aConsumed.length,
    failedOperation: batchId(failed.operation), freshOperation: freshId, retainedIds: [...retainedIds],
    committedTakesA: aConsumed, committedTakesB: bConsumed,
    lostReplyAfterConsumption: true, oldTakeRejected: true, freshSignatureVerifiedByOpenSsl: true,
    messageHex: Buffer.from(fresh.message).toString('hex'), signatureHex: Buffer.from(fresh.result.operation.signature).toString('hex') };
}

function isFailedSocketClose(event) {
  return event.event === 'ml_dsa_socket_completion_v1' && event.kind === 'signing'
    && event.id === this && event.close_code === 1011 && event.close_requested === true;
}
function retainedTake(operation, retained, event) {
  return batchId(event.operation) === operation && retained.has(batchId(event.material));
}
function takenId(event) { return batchId(event.material); }

function materialFaultPath(fault) {
  switch (fault) {
    case 'lost_reply': return '/arm';
    case 'truncated': return '/arm-truncated';
    default: throw new Error('Unknown material delivery fault');
  }
}

function durablePublicationEvidence(material) {
  const interrupted = observations.interruptedProducer.publicationEvidence;
  const lostReply = observations.publicationCompletionRecovery.publicationEvidence;
  for (const evidence of [interrupted, lostReply]) {
    if (evidence.batches.includes(material)) return evidence;
  }
  return null;
}
