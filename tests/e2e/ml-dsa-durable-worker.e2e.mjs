import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Miniflare } from 'miniflare';
import { once } from 'node:events';

const fixtures = resolve(process.argv[2] ?? '/private/tmp/ml-dsa-worker-fixtures');
const artifact = resolve(process.argv[3] ?? '.artifacts/ml-dsa/durable-worker.json');
const root = resolve(import.meta.dirname, '../..');
const authHeader = 'x-router-ab-internal-service-auth';
const serviceAuth = randomBytes(32).toString('hex');
const gatewayAuth = randomBytes(32).toString('hex');
const persistence = await mkdtemp(join(tmpdir(), 'ml-dsa-worker-e2e-'));
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
  scope: 'Local workerd, real strict Worker bundles, synthetic wallet-derived key, durable admission and automatic paired preprocessing. Gateway custody authorization is injected by this harness. This is not a public SDK or hosted-latency test.',
  policy,
  signatures: [],
  failedOperations: [],
  publicKeyHex: Buffer.from(records[0].public_key).toString("hex"),
};
observations.workerWasmSha256 = Object.fromEntries(await Promise.all(["router", "deriver-a", "deriver-b"].map(wasmDigest)));
let runtime;
let lastSuccessful;
try {
  runtime = new Miniflare({ workers: workers(), durableObjectsPersist: persistence });
  await runtime.ready;
  const denied = await raw('router', '/router-ab/ml-dsa/activate', records[0].activation, serviceAuth);
  assert.equal(denied.status, 403);
  await post('router', '/router-ab/ml-dsa/activate', records[0].activation, gatewayAuth);
  await Promise.all(records.map(installRecord));
  observations.wrongAuthorityRejected = true;
  const refillStarted = performance.now();
  await waitReady(4);
  observations.initialFourBatchRefillMs = performance.now() - refillStarted;
  for (let index = 0; index < 8 && observations.signatures.length < 3; index += 1) {
    await waitReady(4);
    const message = Array.from(Buffer.from(`ML-DSA durable Worker transaction ${index}`));
    const input = {
      request: {
        key: records[0].activation.key,
        operation: Array.from(randomBytes(32)),
        message_digest: digest(message),
        context_digest: digest([]),
      },
      message,
      context: [],
    };
    const started = performance.now();
    const result = await post('router', '/router-ab/ml-dsa/sign', input, gatewayAuth);
    const elapsedMs = performance.now() - started;
    assert.equal(result.status, 'existing');
    if (result.operation.state === 'failed') {
      observations.failedOperations.push({ elapsedMs });
      assert.deepEqual(await post('router', '/router-ab/ml-dsa/sign', input, gatewayAuth), result);
      continue;
    }
    assert.equal(result.operation.state, 'succeeded');
    assert.equal(result.operation.signature.length, 3309);
    assert.deepEqual(await post('router', '/router-ab/ml-dsa/sign', input, gatewayAuth), result);
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
    lastSuccessful = { input, result };
    const inventory = await inventories();
    assert.ok(inventory.some((value) => value.refill_due));
  }
  assert.equal(observations.signatures.length, 3);
  observations.automaticRefillAfterSigning = true;
  await waitReady(4);
  await runtime.dispose();
  bindings.ML_DSA_ADMISSION_POLICY = JSON.stringify({ ...policy, operation_timeout_ms: 1000 });
  runtime = new Miniflare({ workers: workers(), durableObjectsPersist: persistence });
  await runtime.ready;
  assert.deepEqual(
    await post('router', '/router-ab/ml-dsa/sign', lastSuccessful.input, gatewayAuth),
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
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  assert.ok(socket);
  const closed = once(socket, 'close', { signal: AbortSignal.timeout(10000) });
  socket.accept();
  await closed;
  observations.stalledPeerClosedMs = performance.now() - started;
  const expired = await post('router', '/router-ab/ml-dsa/status', stalled, gatewayAuth);
  assert.equal(expired.state, 'failed');
  observations.stalledOperationExpiredWithoutSignature = true;
  observations.standardSignaturesVerifiedByRouter = observations.signatures.length;
  observations.passed = true;
} catch (error) {
  observations.passed = false;
  observations.error = String(error);
  throw error;
} finally {
  await runtime?.dispose();
  await mkdir(resolve(artifact, '..'), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(observations, null, 2)}\n`);
  await rm(persistence, { recursive: true, force: true });
  console.log(JSON.stringify(observations));
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
async function installRecord(record, index) {
  await post(index === 0 ? 'a' : 'b', '/router-ab/ml-dsa/role', {
    command: 'install_material', record,
  });
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
    const [a, b] = await inventories();
    const peer = new Set(b.ready.map(batchId));
    let paired = 0;
    for (const id of a.ready) {
      if (peer.has(batchId(id))) paired += 1;
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
