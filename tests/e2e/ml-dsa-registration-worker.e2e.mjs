import assert from 'node:assert/strict';
import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { calibrateCpuProfiler, startCpuProfile } from './ml-dsa-cpu-profile.mjs';
import { registrationDeliveryScript } from '../helpers/mlDsaRegistrationDelivery.e2e.mjs';

const registrationFaultScript = `
let injections = 0;
let delayedRequest = null;
async function fetch(request, env) {
  if (new URL(request.url).pathname === '/injections') return new Response(String(injections));
  if (new URL(request.url).pathname === '/late-result') {
    if (!delayedRequest) return new Response('No delayed request', { status: 409 });
    await scheduler.wait(2000);
    const response = await env.NEXT.fetch(delayedRequest.url, delayedRequest.init);
    return Response.json({ injections, lateStatus: response.status });
  }
  if (env.STALL_EXECUTION && new URL(request.url).pathname === '/router-ab/ml-dsa/registration/role') {
    const command = await request.clone().json();
    if (command.command === 'execute' && injections === 0) {
      injections += 1;
      delayedRequest = {
        url: request.url,
        init: { method: request.method, headers: Object.fromEntries(request.headers), body: await request.text() },
      };
      await scheduler.wait(45000);
      return new Response('Injected execution stall', { status: 503 });
    }
  }
  if (!env.STALL_EXECUTION && new URL(request.url).pathname === '/router-ab/ml-dsa/role') {
    const command = await request.clone().json();
    if (command.command === 'initialize_registration_storage') {
      injections += 1;
      await scheduler.wait(10000);
      return new Response('Injected initialization stall', { status: 503 });
    }
  }
  return env.NEXT.fetch(request);
}
export default { fetch };
`;

const root = resolve(import.meta.dirname, '../..');
const buildRoot = process.env.ML_DSA_TEST_BUILD_ROOT ?? join(root, 'crates/router-ab-cloudflare/build');
const directory = resolve(process.argv[2]);
const artifact = resolve(process.argv[3]);
const hostedUrl = process.env.ML_DSA_REGISTRATION_ROUTER_URL;
const profilePrefix = process.env.ML_DSA_REGISTRATION_CPU_PROFILE;
const stallDelivery = process.env.ML_DSA_REGISTRATION_STALL_DELIVERY === '1';
const loseDeliveryReply = process.env.ML_DSA_REGISTRATION_LOSE_DELIVERY_REPLY === '1';
const stallInitialization = process.env.ML_DSA_REGISTRATION_STALL_INITIALIZATION === '1';
const stallExecution = process.env.ML_DSA_REGISTRATION_STALL_EXECUTION === '1';
assert.ok(!(stallInitialization && stallExecution), 'Select one registration fault');
assert.ok(!(hostedUrl && (stallInitialization || stallExecution || loseDeliveryReply || stallDelivery)), 'Fault injection is local-only');
assert.ok(!((loseDeliveryReply || stallDelivery) && (stallInitialization || stallExecution || profilePrefix)), 'Delivery faults require a separate unprofiled lifecycle run');
assert.ok(!(loseDeliveryReply && stallDelivery), 'Select one delivery fault');
const deliveryFault = loseDeliveryReply || stallDelivery;
assert.ok(!(hostedUrl && profilePrefix), 'Inspector profiling requires local workerd');
const gatewayAuth = process.env.ML_DSA_GATEWAY_TOKEN_FILE
  ? (await readFile(process.env.ML_DSA_GATEWAY_TOKEN_FILE, 'utf8')).trim()
  : randomBytes(32).toString('hex');
const serviceAuth = randomBytes(32).toString('hex');
const persistence = await mkdtemp(join(tmpdir(), 'ml-dsa-registration-e2e-'));
const discoveryPath = join(persistence, 'recipient-discovery.mjs');
await build({
  entryPoints: [join(root, 'packages/wallet-server/src/router/transport/fetch/routes/mlDsaRegistration.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: discoveryPath,
  tsconfig: join(root, 'packages/wallet-server/tsconfig.json'),
});
const { discoverMlDsaRecipientKeys } = await import(pathToFileURL(discoveryPath).href);
const cooldownMs = Number(process.env.ML_DSA_TEST_COOLDOWN_MS ?? 60000);
assert.ok(Number.isSafeInteger(cooldownMs) && cooldownMs >= 1000 && cooldownMs <= 300000);
const candidateGroupSize = Number(process.env.ML_DSA_TEST_CANDIDATE_GROUP_SIZE ?? 2);
assert.ok([2, 4, 8].includes(candidateGroupSize));
const preparationGroupSize = Number(process.env.ML_DSA_TEST_PREPARATION_GROUP_SIZE ?? 4);
assert.ok(preparationGroupSize === candidateGroupSize || (preparationGroupSize === 4 && candidateGroupSize === 2));
const policy = {
  wallet_cooldown: { mode: 'enabled', interval_ms: cooldownMs },
  max_active_operations: 1,
  operation_timeout_ms: 30000,
  candidate_group_size: candidateGroupSize,
  preparation_group_size: preparationGroupSize,
  minimum_ready_batches: 16 / candidateGroupSize,
  refill_target_batches: 32 / candidateGroupSize,
};
const wallet = {
  org: 'registration-e2e',
  project: 'wallet',
  environment: 'temporary',
  wallet: process.env.ML_DSA_TEST_WALLET_ID ?? `wallet-${randomBytes(8).toString('hex')}`,
};
const children = [];
const observations = {
  observedAt: new Date().toISOString(),
  wallet,
  scope:
    'Authenticated private Gateway request through real Worker key generation, durable two-role installation, initial signing stock, and client custody verification. Public login and SDK UI are outside this campaign.',
  hosted: Boolean(hostedUrl),
  initializationStallMs: stallInitialization ? 10000 : 0,
  policy,
  cases: [],
  httpAttempts: [],
  stageTraces: [],
  functionalPassed: false,
  latencyTargetMet: false,
};
observations.builds = Object.fromEntries(
  await Promise.all(['router', 'deriver-a', 'deriver-b'].map(buildHash)),
);
observations.deliveryFixtureSha256 = createHash('sha256').update(registrationDeliveryScript).digest('hex');
observations.scriptSha256 = createHash('sha256')
  .update(await readFile(import.meta.filename))
  .digest('hex');
observations.discoverySourceHashes = {};
for (const file of [
  'crates/router-ab-cloudflare/src/ml_dsa/workers/recipient_keys.rs',
  'packages/wallet-server/src/router/transport/fetch/routes/mlDsaRegistration.ts',
  'tools/ml-dsa-investigation/src/worker_registration_client.rs',
]) {
  observations.discoverySourceHashes[file] = createHash('sha256')
    .update(await readFile(join(root, file)))
    .digest('hex');
}
class RegistrationRouterProxy {
  constructor(credential) {
    this.internalServiceAuthSecret = credential;
  }
  async fetch(request) {
    if (hostedUrl) {
      const url = new URL(new URL(request.url).pathname, hostedUrl);
      return fetch(new Request(url, request));
    }
    return (await runtime.getWorker('router')).fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.arrayBuffer(),
    });
  }
}
let runtime;
let keks;
let executionFaultArmed = stallExecution;
let discoveryFault = 'none';
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (profilePrefix) observations.profilerCalibration = await calibrateCpuProfiler(profilePrefix);
  let client = await startClient();
  keks = await Promise.all(['a', 'b'].map(readKek));
  if (!hostedUrl) {
    runtime = new Miniflare({
      handleRuntimeStdio,
      workers: workers(),
      durableObjectsPersist: persistence,
      inspectorPort: profilePrefix ? 0 : undefined,
    });
    await runtime.ready;
  }
  const denied = await raw('/router-ab/ml-dsa/registration/prepare', { wallet }, serviceAuth);
  assert.equal(denied.status, 403);
  observations.wrongCredentialRejected = true;
  await checkRecipientDiscovery(client);
  let previous;
  let firstRequest;
  for (const epoch of [1, 2]) {
    if (epoch === 2) client = await startClient();
    const continuity =
      epoch === 1
        ? { kind: 'create' }
        : {
            kind: 'recover',
            public_key_digest: previous.a.activation.key.public_key_digest,
            manifest_digest: previous.a.activation.manifest_digest,
          };
    let payload = await registrationInput(client, epoch, continuity);
    if (epoch === 1) {
      const empty = await post('/router-ab/ml-dsa/register', payload.request);
      assert.equal(empty.status, 'unavailable');
      assert.ok(empty.retry_at_ms > Date.now() - 10000);
      observations.emptyPoolRetryTime = true;
      firstRequest = payload.request;
    }
    const prepareStarted = performance.now();
    let ready = await post('/router-ab/ml-dsa/registration/prepare', { wallet });
    assert.equal(ready.ready, true);
    assert.equal(ready.job.signing_batches, Math.max(2, policy.minimum_ready_batches));
    let preparationMs = performance.now() - prepareStarted;
    if (epoch === 1 && stallExecution) {
      observations.executionDeadline = await checkExecutionDeadline(payload.request);
      observations.executionDeadline.failedPreparationMs = preparationMs;
      const consumedJob = ready.job.id;
      executionFaultArmed = false;
      await runtime.dispose();
      runtime = new Miniflare({ handleRuntimeStdio, workers: workers(), durableObjectsPersist: persistence });
      await runtime.ready;
      assert.equal((await post('/router-ab/ml-dsa/register', payload.request)).operation.state, 'failed');
      observations.executionDeadline.failedReplaySurvivesRestart = true;
      // Use direct role bindings after the injected request and runtime restart.
      client.process.kill();
      client = await startClient();
      payload = await registrationInput(client, epoch, continuity);
      firstRequest = payload.request;
      const refillStarted = performance.now();
      ready = await post('/router-ab/ml-dsa/registration/prepare', { wallet });
      assert.equal(ready.ready, true);
      assert.equal(ready.job.signing_batches, Math.max(2, policy.minimum_ready_batches));
      preparationMs = performance.now() - refillStarted;
      assert.notDeepEqual(ready.job.id, consumedJob);
      observations.executionDeadline.freshPreparation = true;
    }
    if (stallDelivery && epoch === 1) {
      observations.deliveryDeadline = await checkDeliveryDeadline(payload.request);
      break;
    }
    if (loseDeliveryReply && epoch === 1) observations.deliveryRecovery = await checkDeliveryRecovery(payload.request);
    const profiler = profilePrefix ? await startCpuProfile(runtime, 'b') : null;
    const started = performance.now();
    const response = await post('/router-ab/ml-dsa/register', payload.request);
    const serverResponseMs = performance.now() - started;
    if (stallInitialization)
      assert.ok(serverResponseMs < 10000, 'Optional initialization blocked registration');
    assert.equal(response.status, 'existing');
    assert.equal(response.operation.state, 'complete');
    const result = response.operation.result;
    assert.deepEqual(result.a.public_key, payload.expected_public_key);
    assert.deepEqual(result.a.public_key, result.b.public_key);
    client.process.stdin.write(`${JSON.stringify(result)}\n`);
    const checked = await next(client);
    assert.equal(checked.verified, true);
    const registrationWithClientVerificationMs = performance.now() - started;
    if (profiler) await profiler.stop(`${profilePrefix}-epoch-${epoch}.cpuprofile`);
    if (!hostedUrl) {
      const inactive = { job: ready.job, request: payload.request, deadline: Date.now() + 30000 };
      await rejectInactiveInitialization(inactive);
      observations.inactiveInitializationRejected = true;
    }
    if (stallInitialization) await requireInjectedInitialization();
    if (loseDeliveryReply && epoch === 1) await checkFinishedDeliveryRefusal();
    assert.deepEqual(await post('/router-ab/ml-dsa/register', payload.request), response);
    const changed = structuredClone(payload.request);
    changed.epoch += 1;
    const replay = await raw('/router-ab/ml-dsa/register', changed, gatewayAuth);
    assert.notEqual(replay.status, 200);
    if (previous) assert.deepEqual(result.a.public_key, previous.a.public_key);
    const measurement = {
      epoch,
      operation: Buffer.from(payload.request.operation).toString('hex'),
      key: result.a.activation.key,
      preparationMs,
      initialSigningBatches: ready.job.signing_batches,
      serverResponseMs,
      registrationWithClientVerificationMs,
      underFiveSeconds: registrationWithClientVerificationMs < 5000,
      canonicalKeyVerified: true,
      holderResultsAuthenticated: true,
      manifestVerified: true,
      exactReplay: true,
      changedReplayRejected: true,
      initialStockSign: { state: 'pending' },
      publicKeyHex: Buffer.from(result.a.public_key).toString('hex'),
    };
    observations.cases.push(measurement);
    measurement.initialStockSign = await sign(result);
    previous = result;
    if (!hostedUrl && epoch === 1) {
      await runtime.dispose();
      runtime = new Miniflare({
        handleRuntimeStdio,
        workers: workers(),
        durableObjectsPersist: persistence,
        inspectorPort: profilePrefix ? 0 : undefined,
      });
      await runtime.ready;
      assert.deepEqual(await post('/router-ab/ml-dsa/register', firstRequest), response);
      observations.registrationSurvivesRestart = true;
    }
  }
  if (stallDelivery) {
    observations.scope = 'Local delivery-deadline probe only. No successful registration or recovery latency is claimed.';
    observations.functionalPassed = observations.deliveryDeadline.failedReplayAfterLateReply;
    observations.registrationChecksPassed = false;
    observations.latencyTargetMet = false;
  } else {
    observations.recoveryPreservesCanonicalKey = true;
    observations.registrationChecksPassed = true;
    observations.functionalPassed = observations.cases.every(signatureCheckPassed);
    observations.latencyTargetMet = observations.cases.every(meetsLatencyTarget);
  }
  if (!observations.functionalPassed) process.exitCode = 1;
} catch (error) {
  observations.error = String(error);
  throw error;
} finally {
  for (const child of children) child.kill();
  await runtime?.dispose();
  await mkdir(resolve(artifact, '..'), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(observations, null, 2)}\n`);
  await rm(persistence, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      artifact,
      functionalPassed: observations.functionalPassed,
      latencyTargetMet: observations.latencyTargetMet,
      cases: observations.cases.map(caseSummary),
    }),
  );
}
async function startClient() {
  const process = spawn(
    join(root, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation'),
    ['worker-registration-client', directory],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  children.push(process);
  const lines = createInterface({ input: process.stdout })[Symbol.asyncIterator]();
  const client = { process, lines };
  const ready = await next(client);
  assert.equal(ready.ready, true);
  client.holderPublicKeys = ready.holder_public_keys;
  return client;
}
async function registrationInput(client, epoch, continuity) {
  const recipients = await discoverMlDsaRecipientKeys(new RegistrationRouterProxy(gatewayAuth));
  assert.equal(recipients.kind, 'ready');
  const holderPublicKeys = [
    Array.from(Buffer.from(recipients.a.publicKeyB64u, 'base64url')),
    Array.from(Buffer.from(recipients.b.publicKeyB64u, 'base64url')),
  ];
  assert.deepEqual(holderPublicKeys, client.holderPublicKeys);
  client.process.stdin.write(
    `${JSON.stringify({ wallet, key_id: 'near', epoch, operation: Array.from(randomBytes(32)), continuity, holder_public_keys: holderPublicKeys })}\n`,
  );
  return next(client);
}

async function checkRecipientDiscovery(client) {
  const path = '/router-ab/ml-dsa/registration/recipient-keys';
  const denied = await raw(path, {}, serviceAuth);
  assert.equal(denied.status, 403);
  assert.deepEqual(
    await discoverMlDsaRecipientKeys(new RegistrationRouterProxy(serviceAuth)),
    { kind: 'unavailable', reason: 'refused' },
  );
  const response = await raw(path, {}, gatewayAuth);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const keys = await response.json();
  assert.deepEqual([keys.a.public_key, keys.b.public_key], client.holderPublicKeys);
  assert.notDeepEqual(keys.a.public_key, keys.b.public_key);
  assert.deepEqual(Object.keys(keys).sort(), ['a', 'b']);
  for (const [role, key] of Object.entries(keys)) {
    assert.deepEqual(Object.keys(key).sort(), ['key_version', 'public_key', 'role']);
    assert.equal(key.role, role);
    assert.ok(key.key_version.length > 0);
  }
  observations.recipientDiscovery = { keys, gatewayCredentialRequired: true, noStore: true };
  if (hostedUrl) return;
  for (const name of ['a', 'b']) {
    const deniedRole = await (await runtime.getWorker(name)).fetch(
      'https://role.internal/router-ab/ml-dsa/registration/recipient-key',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-router-ab-internal-service-auth': gatewayAuth,
        },
        body: '{}',
      },
    );
    assert.equal(deniedRole.status, 403);
  }
  observations.recipientDiscovery.gatewayCannotReadRoleDirectly = true;
  if (profilePrefix || deliveryFault || stallInitialization || stallExecution) return;
  for (const fault of ['swapped', 'shared-key']) {
    await runtime.dispose();
    discoveryFault = fault;
    runtime = new Miniflare({
      handleRuntimeStdio,
      workers: workers(),
      durableObjectsPersist: persistence,
    });
    await runtime.ready;
    const refused = await raw(path, {}, gatewayAuth);
    assert.ok(refused.status >= 400, `Discovery accepted ${fault} participants`);
    assert.deepEqual(
      await discoverMlDsaRecipientKeys(new RegistrationRouterProxy(gatewayAuth)),
      { kind: 'unavailable', reason: 'refused' },
    );
    observations.recipientDiscovery[fault] = { rejectedStatus: refused.status };
  }
  await runtime.dispose();
  discoveryFault = 'none';
  runtime = new Miniflare({
    handleRuntimeStdio,
    workers: workers(),
    durableObjectsPersist: persistence,
  });
  await runtime.ready;
}

async function checkExecutionDeadline(input) {
  const started = performance.now();
  const response = await raw('/router-ab/ml-dsa/register', input, gatewayAuth);
  const elapsedMs = performance.now() - started;
  assert.notEqual(response.status, 200);
  assert.ok(elapsedMs >= 29000 && elapsedMs < 32000, 'Execution did not end at its deadline');
  const late = await (await runtime.getWorker('stall-a')).fetch('https://fault.internal/late-result', { signal: AbortSignal.timeout(10000) });
  const evidence = await late.json();
  assert.equal(evidence.injections, 1);
  assert.ok(evidence.lateStatus >= 400, 'Late execution was accepted');
  const replay = await post('/router-ab/ml-dsa/register', input);
  assert.equal(replay.status, 'existing');
  assert.equal(replay.operation.state, 'failed');
  return { elapsedMs, lateStatus: evidence.lateStatus, exactReplayFailed: true };
}
async function next(client) {
  const line = await client.lines.next();
  assert.equal(line.done, false, 'Native custody verifier ended early');
  return JSON.parse(line.value);
}
async function readKek(role) {
  return readFile(join(directory, `${role}-kek`), 'utf8');
}
function base(name, build, extra) {
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
    bindings: {
      ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING: 'INTERNAL_AUTH',
      INTERNAL_AUTH: serviceAuth,
      ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: gatewayAuth,
      ML_DSA_ADMISSION_POLICY: JSON.stringify(policy),
      ...extra,
    },
  };
}
function workers() {
  return [
    {
      ...base('router', 'router', {}),
      durableObjects: {
        ML_DSA_ADMISSION_DO: { className: 'RouterAbMlDsaAdmissionDurableObject', useSQLite: true },
      },
      serviceBindings: registrationRoleBindings(),
    },
    role('a', 0),
    role('b', 1),
    preparerWorker('a', 0),
    preparerWorker('b', 1),
    ...(stallInitialization ? [registrationFaultWorker('a'), registrationFaultWorker('b')] : []),
    ...(executionFaultArmed ? [registrationFaultWorker('a')] : []),
    ...(deliveryFault ? [deliveryBarrierWorker()] : []),
  ];
}
function registrationRoleBindings() {
  if (discoveryFault === 'swapped') return { DERIVER_A: 'b', DERIVER_B: 'a' };
  return {
    DERIVER_A: stallInitialization || executionFaultArmed ? 'stall-a' : 'a',
    DERIVER_B: stallInitialization ? 'stall-b' : 'b',
  };
}
function role(name, index) {
  const worker = {
    ...base(name, `deriver-${name}`, {
      DERIVER_ROLE_PRIVATE_D1_ROLE: `deriver_${name}`,
      DERIVER_ROLE_PRIVATE_D1_KEK_BINDING: 'ROLE_KEK',
      ROLE_KEK: discoveryFault === 'shared-key' ? keks[0] : keks[index],
      DERIVER_ROLE_PRIVATE_D1_KEK_VERSION: 'registration-e2e',
    }),
    durableObjects: {
      ML_DSA_POOL_DO: { className: 'RouterAbMlDsaPoolDurableObject', useSQLite: true },
      ML_DSA_REGISTRATION_DO: {
        className: 'RouterAbMlDsaRegistrationDurableObject',
        useSQLite: true,
      },
      ML_DSA_ADMISSION_DO: {
        className: 'RouterAbMlDsaAdmissionDurableObject',
        scriptName: 'router',
      },
    },
    serviceBindings: { DERIVER_B: 'b' },
  };
  if (name === 'a') {
    worker.durableObjects.ML_DSA_PRODUCER_DO = {
      className: 'RouterAbMlDsaProducerDurableObject', scriptName: 'preparer-a',
    };
  }
  if (deliveryFault && name === 'a') {
    worker.durableObjects.ML_DSA_POOL_DO = {
      className: 'RegistrationDeliveryBarrier', scriptName: 'delivery-barrier',
    };
  }
  return worker;
}
function preparerWorker(participant, index) {
  const worker = role(participant, index);
  worker.name = `preparer-${participant}`;
  worker.durableObjects.ML_DSA_POOL_DO = deliveryFault && participant === 'a'
    ? { className: 'RegistrationDeliveryBarrier', scriptName: 'delivery-barrier' }
    : { className: 'RouterAbMlDsaPoolDurableObject', scriptName: participant };
  if (participant === 'a') {
    worker.durableObjects.ML_DSA_PRODUCER_DO = {
      className: 'RouterAbMlDsaProducerDurableObject', useSQLite: true,
    };
  }
  delete worker.durableObjects.ML_DSA_REGISTRATION_DO;
  worker.serviceBindings = { DERIVER_B: 'preparer-b' };
  return worker;
}
function deliveryBarrierWorker() {
  return {
    name: 'delivery-barrier', modules: true, script: registrationDeliveryScript,
    compatibilityDate: '2026-06-12', bindings: { INTERNAL_AUTH: serviceAuth, STALL_DELIVERY: stallDelivery },
    durableObjects: {
      BARRIER: { className: 'RegistrationDeliveryBarrier', useSQLite: true },
      REAL_POOL: { className: 'RouterAbMlDsaPoolDurableObject', scriptName: 'a', useSQLite: true },
    },
    serviceBindings: { REGISTRATION_A: 'a' },
  };
}
async function deliveryBarrier() {
  const namespace = await runtime.getDurableObjectNamespace('ML_DSA_POOL_DO', 'a');
  const name = 'ml-dsa-pool-' + createHash('sha256').update('wallet').update(JSON.stringify(wallet)).digest('hex');
  return namespace.get(namespace.idFromName(name));
}
async function deliveryState() {
  return (await (await deliveryBarrier()).fetch('https://fault.internal/state')).json();
}
async function checkDeliveryDeadline(input) {
  const started = performance.now();
  const response = await raw('/router-ab/ml-dsa/register', input, gatewayAuth);
  await response.text();
  const elapsedMs = performance.now() - started;
  assert.notEqual(response.status, 200);
  assert.ok(elapsedMs >= 29000 && elapsedMs < 33000, 'Installation did not stop at its claim deadline');
  const held = await deliveryState();
  assert.equal(held.heldReply, true);
  assert.ok(held.maximumActive <= 2);
  const retryStarted = performance.now();
  const replies = await (await (await deliveryBarrier()).fetch('https://fault.internal/retry-installs')).json();
  assert.ok(replies.every(isRefusedStatus));
  const expiredRetryMs = performance.now() - retryStarted;
  assert.ok(expiredRetryMs < 2000, 'Expired installation retries did not return promptly');
  assert.equal((await post('/router-ab/ml-dsa/register', input)).operation.state, 'failed');
  const deadline = performance.now() + 20000;
  let settled = await deliveryState();
  while (!settled.lateReplyReleased && performance.now() < deadline) {
    await new Promise(waitDeliveryProbe);
    settled = await deliveryState();
  }
  assert.equal(settled.lateReplyReleased, true);
  assert.equal(settled.active, 0);
  assert.equal((await post('/router-ab/ml-dsa/register', input)).operation.state, 'failed');
  return { elapsedMs, expiredRetryMs, expiredStatuses: replies, held, settled,
    failedReplayAfterLateReply: true, scope: 'Remote success can outlive the local deadline; it cannot complete the expired registration.' };
}
function waitDeliveryProbe(resolve) { setTimeout(resolve, 100); }

async function checkDeliveryRecovery(input) {
  const response = await raw('/router-ab/ml-dsa/register', input, gatewayAuth);
  await response.text();
  assert.notEqual(response.status, 200, 'Lost delivery reply did not interrupt installation');
  const before = await deliveryState();
  assert.equal(before.lostReplies, 1);
  assert.equal(before.active, 0, 'The peer delivery was not drained');
  assert.equal(before.maximumActive, 2, 'The bounded delivery pair did not overlap');
  assert.deepEqual(Object.keys(before.deliveries).sort(), ['delivery/1/0', 'delivery/1/1']);
  await runtime.dispose();
  runtime = new Miniflare({ handleRuntimeStdio, workers: workers(), durableObjectsPersist: persistence });
  await runtime.ready;
  const resumed = await (await deliveryBarrier()).fetch('https://fault.internal/retry-installs');
  assert.deepEqual(await resumed.json(), [200, 200], 'Concurrent installation retries did not complete');
  const after = await deliveryState();
  assert.equal(after.active, 0);
  assert.equal(after.maximumActive, 2, 'Concurrent retries exceeded the two-delivery bound');
  assert.equal(Object.keys(after.deliveries).length, policy.minimum_ready_batches);
  for (let ordinal = 0; ordinal < policy.minimum_ready_batches; ordinal += 1) {
    const item = after.deliveries['delivery/1/' + ordinal];
    assert.equal(item.attempts, ordinal === 0 ? 2 : 1);
    if (ordinal < 2) assert.equal(item.hash, before.deliveries['delivery/1/' + ordinal].hash);
  }
  return { lostReplyStatus: response.status, beforeRestart: before, afterConcurrentRetries: after,
    restarted: true, exactPayloadReplay: true, deliveryWindow: 2 };
}
async function checkFinishedDeliveryRefusal() {
  const before = await deliveryState();
  const response = await (await deliveryBarrier()).fetch('https://fault.internal/retry-installs');
  const statuses = await response.json();
  assert.ok(statuses.every(isRefusedStatus));
  const after = await deliveryState();
  assert.deepEqual(after.deliveries, before.deliveries, 'Finished claims caused another delivery');
  observations.deliveryRecovery.finishedClaimRefusals = statuses;
}
function isRefusedStatus(status) { return status >= 400; }

function handleRuntimeStdio(stdout, stderr) {
  stdout.pipe(process.stdout);
  stderr.pipe(process.stderr);
  createInterface({ input: stdout }).on('line', recordStageTrace);
  createInterface({ input: stderr }).on('line', recordStageTrace);
}
function recordStageTrace(line) {
  if (!line.startsWith('{')) return;
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (event.event === 'ml_dsa_stage_trace_v1') observations.stageTraces.push(event);
}

async function raw(path, input, credential, requestId = randomBytes(16).toString('hex')) {
  const init = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ml-dsa-request-id': requestId,
      'x-router-ab-internal-service-auth': credential,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(360000),
  };
  if (hostedUrl) return fetch(new URL(path, hostedUrl), init);
  return (await runtime.getWorker('router')).fetch(`https://ml-dsa.internal${path}`, init);
}
async function post(path, input) {
  const requestId = randomBytes(16).toString('hex');
  const operation = path === '/router-ab/ml-dsa/sign' ? input.request.operation : input.operation;
  const attempt = {
    path,
    httpRequest: requestId,
    operation: Array.isArray(operation) ? Buffer.from(operation).toString('hex') : null,
    headersMs: null,
    bodyMs: null,
    elapsedMs: null,
    status: null,
    echoedRequestId: null,
    completed: false,
    failedStage: null,
  };
  observations.httpAttempts.push(attempt);
  const started = performance.now();
  let stage = 'request';
  try {
    const response = await raw(path, input, gatewayAuth, requestId);
    attempt.headersMs = performance.now() - started;
    attempt.status = response.status;
    attempt.echoedRequestId = response.headers.get('x-ml-dsa-request-id');
    stage = 'body';
    const text = await response.text();
    attempt.bodyMs = performance.now() - started;
    stage = 'status';
    assert.equal(response.status, 200, `${path}: ${text}`);
    stage = 'decode';
    const result = JSON.parse(text);
    stage = 'identity';
    if (attempt.echoedRequestId !== null) assert.equal(attempt.echoedRequestId, requestId);
    attempt.completed = true;
    return result;
  } catch (error) {
    attempt.failedStage = stage;
    throw error;
  } finally {
    attempt.elapsedMs = performance.now() - started;
  }
}

function digest(bytes) {
  return Array.from(createHash('sha256').update(Buffer.from(bytes)).digest());
}
async function sign(result) {
  const message = digest(Array.from(Buffer.from('ML-DSA registered Worker key')));
  const request = {
    key: result.a.activation.key,
    operation: Array.from(randomBytes(32)),
    message_digest: digest(message),
    context_digest: digest([]),
  };
  const started = performance.now();
  const response = await post('/router-ab/ml-dsa/sign', { request, message, context: [] });
  const elapsedMs = performance.now() - started;
  // Recovery preserves wallet cooldown. A cooldown response is valid for the second case.
  if (response.status === 'unavailable') {
    assert.equal(response.reason, 'wallet_cooldown');
    return { cooldownPreserved: true, retryAtMs: response.retry_at_ms };
  }
  assert.equal(response.status, 'existing');
  if (response.operation.state === 'failed') {
    return { failed: true, elapsedMs, operation: request.operation };
  }
  assert.equal(response.operation.state, 'succeeded');
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
      Buffer.from(result.a.public_key),
    ]),
    type: 'spki',
    format: 'der',
  });
  assert.equal(
    verify(null, Buffer.from(message), key, Buffer.from(response.operation.signature)),
    true,
  );
  return {
    verified: true, elapsedMs, operation: request.operation,
    messageHex: Buffer.from(message).toString('hex'),
    contextHex: '',
    signatureHex: Buffer.from(response.operation.signature).toString('hex'),
  };
}

function caseSummary(value) {
  return {
    epoch: value.epoch,
    preparationMs: value.preparationMs,
    registrationMs: value.registrationWithClientVerificationMs,
    underFiveSeconds: value.underFiveSeconds,
    initialStockSign: value.initialStockSign,
  };
}
async function buildHash(name) {
  const bytes = await readFile(
    join(buildRoot, name, 'index_bg.wasm'),
  );
  return [name, createHash('sha256').update(bytes).digest('hex')];
}
function meetsLatencyTarget(value) {
  return (
    value.underFiveSeconds &&
    value.initialStockSign.verified === true &&
    value.initialStockSign.elapsedMs < 5000
  );
}

async function rejectInactiveInitialization(claim) {
  for (const role of ['a', 'b']) {
    const response = await (
      await runtime.getWorker(role)
    ).fetch('https://ml-dsa.internal/router-ab/ml-dsa/role', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-router-ab-internal-service-auth': serviceAuth,
      },
      body: JSON.stringify({ command: 'initialize_registration_storage', claim }),
    });
    assert.notEqual(response.status, 200, 'Inactive storage initialization succeeded');
  }
}
function registrationFaultWorker(role) {
  return {
    name: 'stall-' + role,
    modules: true,
    script: registrationFaultScript,
    bindings: { STALL_EXECUTION: stallExecution },
    compatibilityDate: '2026-06-12',
    serviceBindings: { NEXT: role },
  };
}

async function requireInjectedInitialization() {
  for (const role of ['a', 'b']) {
    const response = await (
      await runtime.getWorker('stall-' + role)
    ).fetch('https://ml-dsa.internal/injections');
    assert.ok(Number(await response.text()) >= 1, 'Initialization stall was not exercised');
  }
}

function signatureCheckPassed(value) {
  return (
    value.initialStockSign.verified === true || value.initialStockSign.cooldownPreserved === true
  );
}
