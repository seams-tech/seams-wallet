import { installMlDsaActivation } from '../helpers/mlDsaActivation.e2e.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Miniflare } from 'miniflare';
import { once } from 'node:events';
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
const options = new Set(process.argv.slice(4));
for (const option of options) assert.ok(['--profile-preparation', '--passive-preparation-observer'].includes(option), 'Unknown measurement option');
const profilePreparation = options.has('--profile-preparation');
const passivePreparationObserver = options.has('--passive-preparation-observer');
const authHeader = 'x-router-ab-internal-service-auth';
const serviceAuth = randomBytes(32).toString('hex');
const gatewayAuth = randomBytes(32).toString('hex');
const persistence = await mkdtemp(join(tmpdir(), 'ml-dsa-worker-e2e-'));
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
  minimum_ready_batches: 2,
  refill_target_batches: 4,
};
const bindings = {
  ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING: 'INTERNAL_AUTH',
  INTERNAL_AUTH: serviceAuth,
  ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: gatewayAuth,
  ML_DSA_ADMISSION_POLICY: JSON.stringify(policy),
};
const observations = {
  scope: 'Local workerd, real strict Worker bundles, synthetic canonical wallet key, typed Gateway owner admission, and durable signing. Verified factor inputs, claimed-operation persistence, and custody activation are injected. HTTP login, public session routes, and hosted latency remain outside this test.',
  policy,
  profilePreparation,
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
  runtime = new Miniflare({ workers: workers(), durableObjectsPersist: persistence, ...(profilePreparation ? { inspectorPort: 0 } : {}) });
  await runtime.ready;
  observations.idleTimerMs = await timerControl();
  if (profilePreparation) profileConnections = await startProfiles(runtime, participantTarget);
  const denied = await raw('router', '/router-ab/ml-dsa/activate', records[0].activation, serviceAuth);
  assert.equal(denied.status, 403);
  initialRefillStarted = performance.now();
  observations.activation = await installMlDsaActivation(runtime, records, gatewayAuth, serviceAuth);
  observations.wrongAuthorityRejected = true;
  const refillStarted = performance.now();
  observations.activationAndInstallationMs = refillStarted - initialRefillStarted;
  await waitReady(4);
  const storedPools = await passiveInventories();
  observations.maximumPreparedChunkCounts = storedPools.map(maximumChunks);
  for (const chunks of observations.maximumPreparedChunkCounts) {
    assert.ok(chunks > 16, 'Signing did not exercise multiple ciphertext I/O groups');
  }
  observations.initialFourBatchRefillMs = performance.now() - refillStarted;
  observations.activationToFourBatchReserveMs = performance.now() - initialRefillStarted;
  if (passivePreparationObserver) await verifyPassiveInventory();
  initialRefillStarted = undefined;
  if (profilePreparation) {
    observations.preparationProfile = {
      scope: 'Local workerd V8 sampling from before activation through first four-batch reserve. Includes setup, storage, protocol waits and idle samples. Sampling can perturb latency. This is not billed CPU.',
      profiles: await stopProfiles(profileConnections),
    };
    profileConnections = [];
  }
  // Let the full-pool maintenance alarm settle before the first consumption.
  await new Promise(waitForQuietPool);
  for (let index = 0; index < 8 && observations.signatures.length < 3; index += 1) {
    await waitReady(4);
    const message = digest(Array.from(Buffer.from(`ML-DSA durable Worker transaction ${index}`)));
    const owner = await admission.mlDsaOwnerFixture(records[0], new Uint8Array(message), `worker-${index}`);
    assert.equal(owner.admitted.kind, 'prepared');
    if (index === 0) observations.ownerAdmission = await admission.verifyMlDsaAdmissionRefusals(owner);
    const prepared = owner.admitted.operation;
    const input = JSON.parse(prepared.encode());
    const initialStarts = await preprocessingStarts();
    const started = performance.now();
    const router = await runtime.getWorker('router');
    const response = await admission.dispatchMlDsaOwnerOperation(new OwnerRouterProxy(router), prepared);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    const elapsedMs = performance.now() - started;
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
      await waitForPreprocessingStart(initialStarts);
      observations.firstConsumptionRefillStartedMs = performance.now() - started;
      assert.ok(observations.firstConsumptionRefillStartedMs < 3000, 'Consumption did not advance the maintenance alarm');
    }
    const inventory = await inventories();
    observations.postSignInventories.push(inventory);
    assert.ok(inventory.some(refillRequested) || pairedStock(inventory) >= policy.refill_target_batches);
  }
  assert.equal(observations.signatures.length, 3);
  observations.automaticRefillAfterSigning = true;
  await waitReady(4);
  await runtime.dispose();
  bindings.ML_DSA_ADMISSION_POLICY = JSON.stringify({ ...policy, operation_timeout_ms: 1000 });
  runtime = new Miniflare({ workers: workers(), durableObjectsPersist: persistence });
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
function base(name, build, extraBindings) {
  return {
    name,
    modules: true,
    scriptPath: join(root, 'crates/router-ab-cloudflare/build', build, 'worker/shim.mjs'),
    modulesRoot: root,
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
  return {
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
function batchId(id) {
  return Buffer.from(id).toString('hex');
}
function waitOneSecond(resolve) {
  setTimeout(resolve, 1000);
}

async function wasmDigest(role) {
  const bytes = await readFile(join(root, 'crates/router-ab-cloudflare/build', role, 'index_bg.wasm'));
  return [role, createHash('sha256').update(bytes).digest('hex')];
}

async function timerControl() {
  const peer = await runtime.getWorker('timer-control');
  const started = performance.now();
  const response = await peer.fetch('https://timer.internal');
  assert.deepEqual(await response.json(), { completed: true });
  return performance.now() - started;
}

function signingTime(value) { return value.elapsedMs; }

function waitForQuietPool(resolve) { setTimeout(resolve, 2500); }
async function preprocessingStarts() {
  return Promise.all(['a', 'b'].map(rolePreprocessingStarts));
}
async function rolePreprocessingStarts(role) {
  const directory = join(persistence, `${role}-RouterAbMlDsaPoolDurableObject`);
  const files = (await readdir(directory)).filter(walletDatabase);
  assert.equal(files.length, 1);
  const database = new DatabaseSync(join(directory, files[0]), { readOnly: true });
  try {
    return database.prepare("SELECT count(*) AS count FROM _cf_KV WHERE key LIKE 'preprocessing/%'").get().count;
  } finally {
    database.close();
  }
}
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

function participantTarget(target) { return /core:user:(a|b)$/.test(target.title); }

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
  const bytes = await readFile(join(root, path));
  return [path, createHash('sha256').update(bytes).digest('hex')];
}
