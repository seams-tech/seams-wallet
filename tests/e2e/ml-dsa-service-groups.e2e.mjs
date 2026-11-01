import assert from 'node:assert/strict';
import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { Miniflare } from 'miniflare';

const root = resolve(import.meta.dirname, '../..');
const buildRoot =
  process.env.ML_DSA_TEST_BUILD_ROOT ?? join(root, 'crates/router-ab-cloudflare/build/ml-dsa');
const artifact = resolve(process.argv[2]);
const directory = await mkdtemp(join(tmpdir(), 'ml-dsa-service-groups-'));
const auth = randomBytes(32).toString('hex');
const gateway = randomBytes(32).toString('hex');
const policy = {
  wallet_cooldown: { mode: 'enabled', interval_ms: 1000 },
  max_active_operations: 1,
  max_active_preparations: 1,
  operation_timeout_ms: 30000,
  candidate_group_size: 2,
  preparation_group_size: 4,
  minimum_ready_batches: 8,
  refill_target_batches: 16,
};
const native = join(root, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation');
const keys = join(directory, 'keys');
execFileSync(native, ['worker-registration-keys', keys]);
const keks = await Promise.all(['a', 'b'].map(readKek));
const publics = JSON.parse(await readFile(join(keys, 'publics.json'), 'utf8'));
const events = [];
const children = [];
const observations = {
  profile: 'real local workerd, one shared group followed by two and four groups',
  initialPolicy: JSON.parse(JSON.stringify(policy)),
  registrations: [],
  signatures: [],
  assertions: {},
  passed: false,
};
const routerPath = join(buildRoot, 'ml-dsa-group-migration.e2e.mjs');
await writeFile(
  routerPath,
  `
export * from './router/worker/shim.mjs';
export { default } from './router/worker/shim.mjs';
import { RouterAbMlDsaAdmissionDurableObject as Core } from './router/worker/shim.mjs';
export class RouterAbMlDsaAdmissionDurableObject {
  constructor(state, env) { this.core = new Core(state, env); this.state = state; this.env = env; }
  alarm() { return this.core.alarm(); }
  async fetch(request) {
    if (new URL(request.url).pathname === '/__remove-placement-metadata') {
      if (request.headers.get('x-router-ab-internal-service-auth') !== this.env.INTERNAL_AUTH) return new Response('Denied', { status: 403 });
      const input = await request.json();
      // Persisted records from before placement existed. The failed journal retains its wallet digest only.
      for (const digest of input.failedWalletDigests) {
        await this.state.storage.put('registration-operation/' + digest + '/' + '00'.repeat(32), { fingerprint: Array(32).fill(7), state: { state: 'failed' } });
      }
      await this.state.storage.put('cooldown/' + input.cooldownWalletDigest, Date.now() + 60000);
      const records = await this.state.storage.list({ prefix: 'routing/' });
      await this.state.storage.delete(Array.from(records.keys()));
      return Response.json({ removed: records.size });
    }
    return this.core.fetch(request);
  }
}
`,
);
let runtime;
let clients;
try {
  runtime = await startRuntime();
  const original = await register(wallet('original'), 1, { kind: 'create' });
  assert.equal((await placement(original.key.wallet)).group, 0);
  await fullReserve(original.key);
  const removed = await direct(0, '/__remove-placement-metadata', {
    failedWalletDigests: legacyFailedDigests(),
    cooldownWalletDigest: walletDigest(wallet('legacy-cooldown')),
  });
  assert.ok(removed.removed >= 3);
  await runtime.dispose();
  policy.service_groups = 2;
  runtime = await startRuntime();
  assert.equal(
    (await placement(original.key.wallet)).group,
    0,
    'Existing activation must migrate to group zero',
  );
  assert.equal((await placement(wallet('placement-only'))).group, 0);
  for (let index = 0; index < 70; index += 1) {
    assert.equal((await placement(wallet('legacy-failed-' + index))).group, 0);
  }
  observations.assertions.migrationCrossesSixtyFourRowPage = true;
  assert.equal((await placement(wallet('legacy-cooldown'))).group, 0);
  observations.assertions.legacyJournalsAndCooldownKeepGroupZero = true;
  const added = await register(wallet('added'), 1, { kind: 'create' });
  assert.equal((await placement(added.key.wallet)).group, 1);
  await fullReserve(added.key);
  const slotRequest = signingRequest(original.key, 'held admission');
  const held = await direct(0, '/control', { command: 'begin', request: slotRequest }, gateway);
  assert.equal(held.status, 'claimed');
  const another = await direct(
    0,
    '/control',
    { command: 'begin', request: signingRequest(original.key, 'same group busy') },
    gateway,
  );
  assert.equal(another.reason, 'service_capacity');
  const signed = await sign(added, 'Other group signs while group zero is busy');
  const requests = await Promise.all([
    request('router', '/router-ab/ml-dsa/sign', signed.input, gateway),
    request('router', '/router-ab/ml-dsa/sign', signed.input, gateway),
  ]);
  for (const response of requests) {
    assert.equal(response.status, 'existing');
    assert.deepEqual(response.operation.signature, signed.signature);
  }
  await assert.rejects(
    direct(
      0,
      '/control',
      { command: 'begin', request: signingRequest(added.key, 'wrong admission') },
      gateway,
    ),
    /wrong service group/,
  );
  await direct(0, '/control', { command: 'cancel', claim: held.claim }, gateway);
  const lease = await direct(0, '/check', {
    command: 'claim_refill',
    key: original.key,
    occupied: [],
  });
  assert.equal(lease.status, 'acquired');
  assert.equal(
    (await direct(0, '/check', { command: 'claim_refill', key: original.key, occupied: [] }))
      .status,
    'busy',
  );
  const producer = await producerClient(1);
  await assert.rejects(
    send(producer, '/router-ab/ml-dsa/prepare', lease.job, auth),
    /wrong service group/,
  );
  const before = events.length;
  await sign(added, 'Other group refills while group zero retains a lease');
  await fullReserve(added.key);
  const jobs = events
    .slice(before)
    .filter(groupOnePreparation.bind(null, added.key.public_key_digest));
  assert.ok(jobs.length > 0, 'Group one did no real preparation while the other lease was held');
  const groupOneProducer = (await producerClient(1)).id.toString();
  assert.ok(jobs.every(matchesProducer.bind(null, groupOneProducer)));
  observations.assertions.independentProducerIdentity = groupOneProducer;
  await direct(0, '/check', { command: 'finish_refill', job: lease.job, outcome: 'unused' });
  await fullReserve(original.key);
  const parallelStart = events.length;
  await Promise.all([retirePairGroup(original.key), retirePairGroup(added.key)]);
  await Promise.all([fullReserve(original.key), fullReserve(added.key)]);
  observations.parallelRefill = parallelRefillEvidence(
    events.slice(parallelStart),
    original.key,
    added.key,
  );
  const resourceEvents = events.filter(hasPreparationResource);
  const maximumActiveCrypto = Math.max(...events.map(activeCrypto));
  const maximumWasmBytes = Math.max(...resourceEvents.map(wasmBytes));
  assert.equal(maximumActiveCrypto, 1, 'Co-located preparation exceeded one compute slot');
  assert.ok(
    maximumWasmBytes < 128 * 1024 * 1024,
    'Preparation exceeded the Worker isolate memory limit',
  );
  observations.preparationResources = {
    maximumActiveCrypto,
    maximumWasmBytes,
    scope:
      'Wasm memory and public activity counters. JavaScript heap and physical CPU parallelism are not measured.',
  };

  observations.assertions.otherGroupSignsDuringHeldAdmission = true;
  observations.assertions.otherGroupPreparesDuringHeldProducerLease = true;
  observations.assertions.capacityBoundAndWrongGroupChecks = true;
  observations.assertions.duplicateResultReused = true;
  await runtime.dispose();
  policy.service_groups = 4;
  runtime = await startRuntime();
  assert.equal((await placement(original.key.wallet)).group, 0);
  assert.equal((await placement(added.key.wallet)).group, 1);
  assert.equal((await placement(wallet('third'))).group, 2);
  assert.equal((await placement(wallet('fourth'))).group, 3);
  const recovered = await register(added.key.wallet, 2, {
    kind: 'recover',
    public_key_digest: added.key.public_key_digest,
    manifest_digest: added.manifestDigest,
  });
  assert.deepEqual(recovered.publicKey, added.publicKey);
  assert.equal((await placement(recovered.key.wallet)).group, 1);
  await fullReserve(recovered.key);
  await sign(recovered, 'Recovered wallet keeps its group and canonical key');
  observations.assertions.restartAndExpansionPreservePlacement = true;
  observations.assertions.recoveryPreservesCanonicalKeyAndGroup = true;
  await fullReserve(recovered.key);
  observations.finalStocks = await Promise.all([stock(original.key), stock(recovered.key)]);
  for (const stocks of observations.finalStocks) {
    for (const inventory of stocks)
      assert.ok(inventory.ready.length + inventory.reserved.length <= 16);
  }
  await runtime.dispose();
  policy.service_groups = 2;
  runtime = await startRuntime();
  await assert.rejects(placement(wallet('forbidden-shrink')));
  await runtime.dispose();
  policy.service_groups = 4;
  runtime = await startRuntime();
  assert.equal(
    (await placement(wallet('forbidden-shrink'))).group,
    0,
    'Rejected shrink must not advance allocation',
  );
  assert.equal((await placement(added.key.wallet)).group, 1);
  observations.assertions.groupCountCannotShrink = true;
  observations.passed = true;
} catch (error) {
  observations.error = String(error);
  throw error;
} finally {
  await runtime?.dispose();
  for (const child of children) child.kill();
  observations.events = events;
  observations.sourceHashes = await sourceHashes();
  await mkdir(resolve(artifact, '..'), { recursive: true });
  await writeFile(artifact, JSON.stringify(observations, null, 2) + '\n');
  await rm(directory, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      artifact,
      passed: observations.passed,
      signatures: observations.signatures.length,
    }),
  );
}
function legacyFailedDigests() {
  const digests = [];
  for (let index = 0; index < 70; index += 1)
    digests.push(walletDigest(wallet('legacy-failed-' + index)));
  return digests;
}
function walletDigest(wallet) {
  return createHash('sha256').update('wallet').update(JSON.stringify(wallet)).digest('hex');
}
function wallet(name) {
  return { org: 'e2e', project: 'ml-dsa-groups', environment: 'local', wallet: name };
}
async function readKek(role) {
  return readFile(join(keys, role + '-kek'), 'utf8');
}
function worker(name, role, extra) {
  return {
    name,
    modules: true,
    scriptPath: join(buildRoot, role, 'worker/shim.mjs'),
    modulesRoot: buildRoot,
    modulesRules: [
      { type: 'ESModule', include: ['**/*.js', '**/*.mjs'] },
      { type: 'CompiledWasm', include: ['**/*.wasm'] },
    ],
    compatibilityDate: '2026-06-12',
    bindings: {
      INTERNAL_AUTH: auth,
      ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING: 'INTERNAL_AUTH',
      ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: gateway,
      ML_DSA_ADMISSION_POLICY: JSON.stringify(policy),
      ML_DSA_WAIT_DIAGNOSTICS: '1',
      ...extra,
    },
  };
}
function roleWorker(role, index, preparing) {
  const name = preparing ? 'preparer-' + role : role;
  const result = worker(name, 'deriver-' + role, {
    DERIVER_ROLE_PRIVATE_D1_ROLE: 'deriver_' + role,
    DERIVER_ROLE_PRIVATE_D1_KEK_BINDING: 'ROLE_KEK',
    ROLE_KEK: keks[index],
    DERIVER_ROLE_PRIVATE_D1_KEK_VERSION: 'group-e2e',
  });
  result.durableObjects = {
    ML_DSA_ADMISSION_DO: { className: 'RouterAbMlDsaAdmissionDurableObject', scriptName: 'router' },
    ML_DSA_POOL_DO: {
      className: 'RouterAbMlDsaPoolDurableObject',
      ...(preparing ? { scriptName: role } : { useSQLite: true }),
    },
  };
  if (!preparing)
    result.durableObjects.ML_DSA_REGISTRATION_DO = {
      className: 'RouterAbMlDsaRegistrationDurableObject',
      useSQLite: true,
    };
  if (role === 'a')
    result.durableObjects.ML_DSA_PRODUCER_DO = {
      className: 'RouterAbMlDsaProducerDurableObject',
      ...(preparing ? { useSQLite: true } : { scriptName: 'preparer-a' }),
    };
  result.serviceBindings = { DERIVER_B: preparing ? 'preparer-b' : 'b' };
  return result;
}
async function startRuntime() {
  const router = worker('router', 'router', {});
  router.scriptPath = routerPath;
  router.durableObjects = {
    ML_DSA_ADMISSION_DO: { className: 'RouterAbMlDsaAdmissionDurableObject', useSQLite: true },
  };
  router.serviceBindings = { DERIVER_A: 'a', DERIVER_B: 'b' };
  const next = new Miniflare({
    durableObjectsPersist: join(directory, 'state'),
    handleRuntimeStdio,
    workers: [
      router,
      roleWorker('a', 0, false),
      roleWorker('b', 1, false),
      roleWorker('a', 0, true),
      roleWorker('b', 1, true),
    ],
  });
  await next.ready;
  clients = await bindClients(next);
  return next;
}
function handleRuntimeStdio(stdout, stderr) {
  createInterface({ input: stdout }).on('line', captureLine);
  createInterface({ input: stderr }).on('line', captureLine);
}
function captureLine(line) {
  const start = line.indexOf('{');
  if (start < 0) return;
  try {
    const event = JSON.parse(line.slice(start));
    if (event.event?.startsWith('ml_dsa_')) events.push(event);
  } catch {}
}
async function send(target, path, body, secret) {
  const response = await target.fetch('https://ml-dsa.internal' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': secret },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function request(role, path, body, secret = auth) {
  return send(clients.workers.get(role), path, body, secret);
}
async function admissionClient(group) {
  return clients.admissions.get(group);
}
async function direct(group, path, body, secret = auth) {
  return send(await admissionClient(group), path, body, secret);
}
async function placement(wallet) {
  return direct(0, '/routing', { wallet });
}
async function producerClient(group) {
  return clients.producers.get(group);
}
async function bindClients(next) {
  const workers = new Map();
  for (const name of ['router', 'a', 'b', 'preparer-a', 'preparer-b']) {
    const worker = await next.getWorker(name);
    workers.set(name, { fetch: worker.fetch.bind(worker) });
  }
  const admissions = new Map();
  const producers = new Map();
  const admission = await next.getDurableObjectNamespace('ML_DSA_ADMISSION_DO', 'router');
  const producer = await next.getDurableObjectNamespace('ML_DSA_PRODUCER_DO', 'preparer-a');
  for (const group of [0, 1, 2, 3]) {
    const suffix = group === 0 ? '' : '-group-' + group;
    const admissionId = admission.idFromName('ml-dsa-admission-v1' + suffix);
    const producerId = producer.idFromName('ml-dsa-producer-v1' + suffix);
    const admissionStub = admission.get(admissionId);
    const producerStub = producer.get(producerId);
    admissions.set(group, {
      id: admissionId.toString(),
      fetch: admissionStub.fetch.bind(admissionStub),
    });
    producers.set(group, {
      id: producerId.toString(),
      fetch: producerStub.fetch.bind(producerStub),
    });
  }
  return { workers, admissions, producers };
}
async function clientLine(client) {
  const line = await client.lines.next();
  assert.equal(line.done, false, 'Native custody verifier ended early');
  return JSON.parse(line.value);
}
async function register(wallet, epoch, continuity) {
  const clientDirectory = join(directory, wallet.wallet + '-' + epoch);
  await mkdir(clientDirectory);
  for (const name of ['a-kek', 'b-kek', 'publics.json'])
    await cp(join(keys, name), join(clientDirectory, name));
  const process = spawn(native, ['worker-registration-client', clientDirectory], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  children.push(process);
  const client = {
    process,
    lines: createInterface({ input: process.stdout })[Symbol.asyncIterator](),
  };
  assert.equal((await clientLine(client)).ready, true);
  process.stdin.write(
    JSON.stringify({
      wallet,
      key_id: 'near',
      epoch,
      continuity,
      operation: Array.from(randomBytes(32)),
      holder_public_keys: publics,
    }) + '\n',
  );
  const input = await clientLine(client);
  const prepared = await request(
    'router',
    '/router-ab/ml-dsa/registration/prepare',
    { wallet },
    gateway,
  );
  assert.equal(prepared.ready, true);
  assert.equal(prepared.job.service_group, (await placement(wallet)).group);
  const completed = await request('router', '/router-ab/ml-dsa/register', input.request, gateway);
  assert.equal(completed.operation.state, 'complete');
  const result = completed.operation.result;
  assert.deepEqual(result.a.public_key, input.expected_public_key);
  assert.deepEqual(result.a.public_key, result.b.public_key);
  process.stdin.write(JSON.stringify(result) + '\n');
  const verified = await clientLine(client);
  assert.equal(verified.canonical_key_verified, true);
  assert.equal(verified.manifest_verified, true);
  const record = {
    key: result.a.activation.key,
    publicKey: result.a.public_key,
    manifestDigest: result.a.activation.manifest_digest,
  };
  observations.registrations.push({
    wallet,
    epoch,
    group: prepared.job.service_group,
    publicKeyHex: Buffer.from(record.publicKey).toString('hex'),
    canonicalKeyVerified: true,
  });
  return record;
}
function digest(value) {
  return Array.from(createHash('sha256').update(Buffer.from(value)).digest());
}
function signingRequest(key, message) {
  const bytes = Array.from(Buffer.from(message));
  return {
    key,
    operation: Array.from(randomBytes(32)),
    message_digest: digest(bytes),
    context_digest: digest([]),
  };
}
async function sign(record, text) {
  const input = {
    request: signingRequest(record.key, text),
    message: Array.from(Buffer.from(text)),
    context: [],
  };
  const deadline = Date.now() + 120000;
  let result = await request('router', '/router-ab/ml-dsa/sign', input, gateway);
  while (result.status === 'unavailable') {
    assert.ok(Date.now() < deadline, 'Signing retry deadline expired');
    await delay(Math.max(10, result.retry_at_ms - Date.now()));
    result = await request('router', '/router-ab/ml-dsa/sign', input, gateway);
  }
  assert.equal(result.operation.state, 'succeeded');
  const signature = result.operation.signature;
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
      Buffer.from(record.publicKey),
    ]),
    format: 'der',
    type: 'spki',
  });
  assert.equal(verify(null, Buffer.from(input.message), publicKey, Buffer.from(signature)), true);
  assert.equal(
    verify(
      null,
      Buffer.concat([Buffer.from(input.message), Buffer.from([1])]),
      publicKey,
      Buffer.from(signature),
    ),
    false,
  );
  observations.signatures.push({
    publicKeyHex: Buffer.from(record.publicKey).toString('hex'),
    messageHex: Buffer.from(input.message).toString('hex'),
    signatureHex: Buffer.from(signature).toString('hex'),
  });
  return { input, signature };
}
async function stock(key) {
  const command = { command: 'live_inventory', key, target: 16 };
  return Promise.all([
    request('a', '/router-ab/ml-dsa/role', command),
    request('b', '/router-ab/ml-dsa/role', command),
  ]);
}
async function fullReserve(key) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const stocks = await stock(key);
    for (const inventory of stocks)
      assert.ok(inventory.ready.length + inventory.reserved.length <= 16);
    const a = stocks[0].ready.map(hex).sort();
    const b = stocks[1].ready.map(hex).sort();
    if (
      a.length === 16 &&
      JSON.stringify(a) === JSON.stringify(b) &&
      stocks.every(noReservations)
    ) {
      const group = (await placement(key.wallet)).group;
      const pending = await direct(group, '/check', { command: 'pending_refills', key });
      if (pending.length === 0) return stocks;
    }
    await delay(100);
  }
  throw new Error('Group did not restore its full reserve');
}
function noReservations(inventory) {
  return inventory.reserved.length === 0;
}
function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}
function matchesProducer(producer, event) {
  return event.producer === producer;
}
function groupOnePreparation(digest, event) {
  return (
    event.event === 'ml_dsa_producer_job_v1' &&
    event.stage === 'running' &&
    event.key === hex(digest)
  );
}
async function retirePairGroup(key) {
  const paired = await stock(key);
  assert.equal(paired[0].ready.length, 16);
  const batches = paired[0].ready.slice(0, 2);
  for (const role of ['a', 'b']) {
    await request(role, '/router-ab/ml-dsa/role', { command: 'retire_unpaired', key, batches });
  }
  await request('a', '/router-ab/ml-dsa/role', { command: 'wake_refill', key });
}
function parallelRefillEvidence(events, first, second) {
  const keys = [hex(first.public_key_digest), hex(second.public_key_digest)];
  const jobs = events.filter(isParallelJob.bind(null, keys));
  const actors = new Set(jobs.map(producerIdentity));
  assert.equal(actors.size, 2, 'Concurrent refills must use distinct producer objects');
  const lifetimes = [];
  for (const job of jobs) {
    const stages = events.filter(matchesPreparationJob.bind(null, job.batch));
    const start = stages.find(cryptoStarted);
    const end = stages.find(cryptoCompleted);
    assert.ok(start && end && start.at_ms <= end.at_ms);
    lifetimes.push({
      job: job.batch,
      key: job.key,
      producer: job.producer,
      startedAtMs: start.at_ms,
      completedAtMs: end.at_ms,
    });
  }
  assert.equal(new Set(lifetimes.map(jobKey)).size, 2);
  return {
    lifetimes,
    scope:
      'Independent real refill jobs. Overlapping lifetimes do not prove simultaneous CPU execution.',
  };
}
function isParallelJob(keys, event) {
  return (
    event.event === 'ml_dsa_producer_job_v1' &&
    event.stage === 'running' &&
    keys.includes(event.key)
  );
}
function producerIdentity(event) {
  return event.producer;
}
function jobKey(event) {
  return event.key;
}
function matchesPreparationJob(job, event) {
  return event.event === 'ml_dsa_preparation_stage_v1' && event.job === job && event.role === 'a';
}
function hasPreparationResource(event) {
  return (
    event.event === 'ml_dsa_preparation_stage_v1' &&
    Number.isSafeInteger(event.wasm_linear_memory_bytes)
  );
}
function activeCrypto(event) {
  return event.active_crypto ?? 0;
}
function wasmBytes(event) {
  return event.wasm_linear_memory_bytes;
}
function cryptoStarted(event) {
  return event.stage === 'crypto_started';
}
function cryptoCompleted(event) {
  return event.stage === 'crypto_completed';
}
async function sourceHashes() {
  const result = {};
  for (const file of [
    'crates/router-ab-cloudflare/src/ml_dsa/workers/routing.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/service_group.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/workers/preparation.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/workers/preparation/producer.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/registration.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/policy.rs',
    'tests/e2e/ml-dsa-service-groups.e2e.mjs',
  ]) {
    result[file] = createHash('sha256')
      .update(await readFile(join(root, file)))
      .digest('hex');
  }
  for (const role of ['router', 'deriver-a', 'deriver-b'])
    result[role + '.wasm'] = createHash('sha256')
      .update(await readFile(join(buildRoot, role, 'index_bg.wasm')))
      .digest('hex');
  return result;
}
