import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const rolePath = '/router-ab/ml-dsa/role';

export async function bindWorkerClients(runtime, poolName) {
  const workers = new Map();
  for (const name of ['router', 'a', 'b', 'preparer-a', 'preparer-b', 'preparer-a-secondary', 'preparer-b-secondary', 'publication-barrier', 'timer-control']) {
    const worker = await runtime.getWorker(name);
    workers.set(name, { fetch: worker.fetch.bind(worker) });
  }
  const admission = await boundDurableClient(runtime, 'ML_DSA_ADMISSION_DO', 'router', 'ml-dsa-admission-v1');
  const actualAdmission = await boundDurableClient(runtime, 'ML_DSA_REAL_ADMISSION_DO', 'router', 'ml-dsa-admission-v1');
  const publication = await boundDurableClient(runtime, 'BARRIER', 'publication-barrier', poolName);
  const admissionBarrier = await boundDurableClient(runtime, 'ADMISSION_BARRIER', 'publication-barrier', 'ml-dsa-admission-v1');
  const takeA = await boundDurableClient(runtime, 'TAKE_BARRIER_A', 'publication-barrier', poolName);
  const takeB = await boundDurableClient(runtime, 'TAKE_BARRIER', 'publication-barrier', poolName);
  const producers = new Map();
  for (const slot of ['primary', 'secondary']) {
    const script = slot === 'primary' ? 'preparer-a' : 'preparer-a-secondary';
    producers.set(slot, await boundDurableClient(runtime, 'ML_DSA_PRODUCER_DO', script, 'ml-dsa-producer-v1'));
  }
  return { workers, admission, actualAdmission, publication, admissionBarrier, takeA, takeB, producers };
}
async function boundDurableClient(runtime, binding, script, name) {
  const namespace = await runtime.getDurableObjectNamespace(binding, script);
  const stub = namespace.get(namespace.idFromName(name));
  return { fetch: stub.fetch.bind(stub) };
}

function id(value) {
  return Buffer.from(value).toString('hex');
}
function digest(value) {
  return Array.from(createHash('sha256').update(Buffer.from(value)).digest());
}
function batches(job) {
  assert.equal(job.groups, 'two');
  return [job.batch, digest(Buffer.concat([
    Buffer.from('seams/ml-dsa/preparation-second-pair/v1'), Buffer.from(job.batch),
  ]))];
}
function occupied(stocks) {
  const known = new Map();
  for (const stock of stocks) {
    for (const batch of [...stock.ready, ...stock.reserved]) known.set(id(batch), batch);
  }
  return Array.from(known.values());
}
function full(stocks, target) {
  const a = stocks[0].ready.map(id).sort();
  const b = stocks[1].ready.map(id).sort();
  return a.length === target && b.length === target && new Set(a).size === target &&
    JSON.stringify(a) === JSON.stringify(b) && stocks.every(unreserved);
}
function unreserved(stock) {
  return stock.reserved.length === 0;
}

export async function runParallelRefill(context) {
  const { key, policy } = context;
  assert.equal(policy.max_active_preparations, 2);
  const target = policy.refill_target_batches;
  const initial = await context.inventories();
  assert.ok(full(initial, target));
  const settlingDeadline = performance.now() + 10000;
  while ((await context.admissionCheck({ command: 'pending_refills', key })).length > 0) {
    assert.ok(performance.now() < settlingDeadline, 'Initial preparation did not settle');
    await delay(25);
  }
  await context.progress('initial_settled', {});
  const firstEvent = context.preparationEvents.length;
  const gate = context.publicationBarrier;
  try {
  assert.equal((await context.peerBarrier.fetch('https://fault.internal/arm-peer-inventory')).status, 200);
  await context.progress('peer_gate_armed', {});
  const retired = initial[0].ready;
  for (const role of ['a', 'b']) await context.post(role, rolePath, { command: 'retire_unpaired', key, batches: retired });
  await context.post('a', rolePath, { command: 'wake_refill', key });
  await context.progress('depleted_and_woken', {});
  const deadline = performance.now() + 60000;
  let held = false;
  while (performance.now() < deadline) {
    const state = await (await context.peerBarrier.fetch('https://fault.internal/peer-inventory-state')).json();
    if (state.held) { held = true; break; }
    await delay(25);
  }
  assert.equal(held, true, 'Controller did not pause after its initial pending-job snapshot');
  await context.progress('peer_inventory_held', {});
  const claim = await context.admissionCheck({ command: 'claim_refill', key, occupied: [] });
  assert.equal(claim.status, 'acquired');
  await context.progress('late_claim_acquired', {});
  const first = claim.job;
  assert.equal((await gate.fetch('https://fault.internal/arm-before-job', {
    method: 'POST', body: JSON.stringify(first.batch),
  })).status, 200);
  await context.progress('publication_gate_armed', {});
  assert.equal((await context.producerReceipt(first, context.serviceAuth)).status, 202);
  await context.progress('late_job_queued', {});
  let publication;
  while (performance.now() < deadline) {
    const state = await (await gate.fetch('https://fault.internal/state')).json();
    if (state.held && id(state.held.job.batch) === id(first.batch)) {
      publication = state.held;
      break;
    }
    await delay(25);
  }
  assert.equal(publication?.stage, 'before');
  await context.progress('a_publication_held', {});
  const firstIds = batches(first);
  assert.deepEqual(await context.post('b', rolePath, { command: 'inspect', key, batches: firstIds }), ['ready', 'ready']);
  assert.deepEqual(await context.post('a', rolePath, { command: 'inspect', key, batches: firstIds }), ['missing', 'missing']);
  assert.equal((await context.peerBarrier.fetch('https://fault.internal/release-peer-inventory')).status, 200);
  await context.progress('peer_inventory_released', {});
  let simultaneous;
  while (performance.now() < deadline) {
    await context.progress('querying_two_live_jobs', {});
    const pending = await Promise.race([
      context.admissionCheck({ command: 'pending_refills', key }),
      delay(5000, null),
    ]);
    assert.ok(pending, 'Pending-job metadata RPC did not complete');
    await context.progress('pending_jobs_returned', { count: pending.length });
    if (pending.length === 2) { simultaneous = pending; break; }
    await delay(25);
  }
  assert.equal(simultaneous?.length, 2, 'A depleted key did not borrow the idle producer');
  await context.progress('two_live_jobs', {});
  assert.equal(new Set(simultaneous.map(slot)).size, 2);
  assert.ok(simultaneous.some(matchesFirst, id(first.batch)));
  const second = simultaneous.find(differsFromFirst, id(first.batch));
  assert.ok(second);
  const secondId = id(second.batch);
  while (performance.now() < deadline && !context.preparationEvents.some(startedCrypto, secondId)) await delay(25);
  assert.ok(context.preparationEvents.some(startedCrypto, secondId), 'Borrowed producer never entered the real protocol');
  assert.deepEqual(await context.post('b', rolePath, { command: 'inspect', key, batches: firstIds }), ['ready', 'ready'], 'Reconciliation retired a live B half claimed after the first snapshot');
  assert.equal((await gate.fetch('https://fault.internal/release-publication')).status, 200);
  await context.progress('a_publication_released', {});
  let final;
  while (performance.now() < deadline) {
    await context.progress('reading_final_stock', {});
    const stocks = await Promise.race([context.inventories(), delay(5000, null)]);
    assert.ok(stocks, 'Paired inventory RPC did not complete');
    for (const stock of stocks) assert.ok(stock.ready.length + stock.reserved.length <= target);
    const pending = await context.admissionCheck({ command: 'pending_refills', key });
    if (full(stocks, target) && pending.length === 0) { final = stocks; break; }
    await delay(50);
  }
  assert.ok(final, 'Parallel refill did not restore exact paired reserves');
  await context.progress('paired_reserve_restored', {});
  for (const stock of final) {
    const current = new Set(stock.ready.map(id));
    for (const batch of retired) assert.equal(current.has(id(batch)), false, 'Retired material returned');
    for (const batch of firstIds) assert.equal(current.has(id(batch)), true, 'The protected pair was not retained');
  }
  const newJobs = new Set();
  for (const event of context.preparationEvents.slice(firstEvent)) {
    if (event.role === 'a' && event.stage === 'crypto_started') newJobs.add(event.job);
  }
  assert.equal(newJobs.size, target / 2, 'Refill performed extra cryptographic work');
  const blocked = await context.admissionCheck({ command: 'claim_refill', key, occupied: occupied(final) });
  assert.equal(blocked.status, 'busy');
  const message = Array.from(randomBytes(32));
  const request = { key, operation: Array.from(randomBytes(32)), message_digest: digest(message), context_digest: digest([]) };
  const signingStarted = performance.now();
  const result = await context.post('router', '/router-ab/ml-dsa/sign', { request, message, context: [] }, context.gatewayAuth);
  const signingMs = performance.now() - signingStarted;
  assert.equal(result.status, 'existing');
  assert.equal(result.operation.state, 'succeeded');
  context.verifyStandardSignature(context.publicKey, message, [], result.operation.signature);
  const replayStarted = performance.now();
  const replay = await context.post('router', '/router-ab/ml-dsa/sign', { request, message, context: [] }, context.gatewayAuth);
  assert.deepEqual(replay, result);
  return { policy, simultaneous, delayedClaimAfterSnapshot: first, bPublicationPreserved: true,
    allInitialMaterialRetired: true, exactPairedReserveRestored: true, cryptographicJobs: newJobs.size,
    capacityUnchanged: true, noExtraLeaseAtFullStock: true, standardSignatureVerified: true,
    operation: id(request.operation), messageHex: Buffer.from(message).toString('hex'), contextHex: '',
    signatureHex: Buffer.from(result.operation.signature).toString('hex'), idempotentReplay: true,
    signingMs, replayMs: performance.now() - replayStarted };
  } catch (error) {
    await context.progress('failed', { error: String(error) });
    throw error;
  } finally {
    await context.progress('cleanup_peer_gate', {});
    await Promise.race([context.peerBarrier.fetch('https://fault.internal/release-peer-inventory'), delay(2000)]);
    await context.progress('cleanup_publication_gate', {});
    await Promise.race([gate.fetch('https://fault.internal/release-publication'), delay(2000)]);
  }
}
function slot(job) { return job.producer_slot; }
function matchesFirst(job) { return id(job.batch) === String(this); }
function differsFromFirst(job) { return id(job.batch) !== String(this); }
function startedCrypto(event) { return event.role === 'a' && event.stage === 'crypto_started' && event.job === String(this); }
