import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Test-only fault routing. Production entrypoints never import these wrappers.
export const preparationRaceRouterScript = `
import Entry, { RouterAbMlDsaAdmissionDurableObject as Admission } from './shim.mjs';
export * from './shim.mjs';
const path = '/__ml-dsa-preparation-race';
const key = 'benchmark/preparation-race';
function gateway(request, env) { return request.headers.get('x-router-ab-internal-service-auth') === env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET; }
function internal(request, env) { return request.headers.get('x-router-ab-internal-service-auth') === env.INTERNAL_AUTH; }
function sameJob(left, right) { return Array.isArray(left.id) && left.id.length === 32 && JSON.stringify(left.id) === JSON.stringify(right.id); }
function nativeRequest(command, credential, target) {
  return new Request('https://admission.internal/' + target, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': credential },
    body: JSON.stringify(command) });
}
export class RouterAbMlDsaAdmissionDurableObject extends Admission {
  constructor(state, env) {
    super(state, env); this.fixtureState = state; this.fixtureEnv = env;
    this.instance = crypto.randomUUID();
  }
  async fetch(request) {
    const isFixture = new URL(request.url).pathname === path;
    if (isFixture) {
      if (!gateway(request, this.fixtureEnv) && !internal(request, this.fixtureEnv)) return new Response('Forbidden', { status: 403 });
      const action = await request.json();
      if (action.action === 'observe') {
        if (!internal(request, this.fixtureEnv)) return new Response('Forbidden', { status: 403 });
        const current = await this.fixtureState.storage.get(key);
        if (!current || current.kind === 'idle') return Response.json({ mode: 'none' });
        if (current.kind !== 'armed') throw new Error('Preparation fixture is already active');
        await this.fixtureState.storage.put(key, { kind: 'holding', mode: current.mode, job: action.job });
        return Response.json({ mode: current.mode });
      }
      if (action.action === 'read' && internal(request, this.fixtureEnv))
        return Response.json({ instance: this.instance, state: await this.fixtureState.storage.get(key) ?? { kind: 'idle' } });
      if (!gateway(request, this.fixtureEnv)) return new Response('Forbidden', { status: 403 });
      if (action.action === 'arm') {
        if (!['unclaimed', 'claimed', 'none'].includes(action.mode)) return new Response('Invalid mode', { status: 400 });
        const current = await this.fixtureState.storage.get(key);
        if (current?.kind === 'holding' || current?.kind === 'claimed') return new Response('Fixture is active', { status: 409 });
        const next = action.mode === 'none' ? { kind: 'idle' } : { kind: 'armed', mode: action.mode };
        await this.fixtureState.storage.put(key, next);
        return Response.json(true);
      }
      if (action.action === 'read')
        return Response.json({ instance: this.instance, state: await this.fixtureState.storage.get(key) ?? { kind: 'idle' } });
      if (action.action === 'reset') {
        await this.fixtureState.storage.sync();
        this.fixtureState.abort('ML-DSA benchmark admission restart');
      }
      const current = await this.fixtureState.storage.get(key);
      if (!current || !['retired', 'preserved_claim'].includes(current.kind)) throw new Error('Fixture is not terminal');
      if (action.action === 'late_ready') {
        for (const role of ['a', 'b']) {
          try {
            await super.fetch(nativeRequest({ command: 'ready_registration', job: current.job, role }, this.fixtureEnv.INTERNAL_AUTH, 'check'));
          } catch (error) {
            if (String(error).includes('Registration preparation is stale')) continue;
            throw error;
          }
          throw new Error('Late readiness was accepted');
        }
        return Response.json(true);
      }
      if (action.action === 'participant_retirement') {
        for (const target of ['check', 'control']) {
          const denied = await super.fetch(nativeRequest({ command: 'retire_registration', job: current.job }, this.fixtureEnv.INTERNAL_AUTH, target));
          if (denied.status !== 403) throw new Error('Participant retirement was accepted');
        }
        return Response.json(true);
      }
      return new Response('Unknown fixture action', { status: 400 });
    }
    let command = null;
    if (request.method === 'POST' && new URL(request.url).pathname === '/control' && gateway(request, this.fixtureEnv)) command = await request.clone().json();
    const response = await super.fetch(request);
    if (response.status !== 200 || command === null) return response;
    const current = await this.fixtureState.storage.get(key);
    if (!current || current.kind === 'idle' || current.kind === 'armed') return response;
    if (command.command === 'claim_registration') {
      const decision = await response.clone().json();
      if (decision.status === 'admitted' && sameJob(decision.claim.job, current.job) && current.kind === 'holding' && current.mode === 'claimed') {
        await this.fixtureState.storage.put(key, { kind: 'claimed', job: current.job, operation: decision.claim.request.operation });
      }
    }
    if (command.command === 'retire_registration' && sameJob(command.job, current.job)) {
      const outcome = await response.clone().json();
      if ((outcome === 'retired' || outcome === 'already_retired') && current.kind === 'holding')
        await this.fixtureState.storage.put(key, { kind: 'retired', job: current.job });
      else if (outcome === 'claimed' && current.kind === 'claimed')
        await this.fixtureState.storage.put(key, { kind: 'preserved_claim', job: current.job, operation: current.operation });
      else if ((outcome === 'already_retired' && current.kind === 'retired') ||
               (outcome === 'claimed' && current.kind === 'preserved_claim')) return response;
      else throw new Error('Unexpected retirement ordering');
    }
    return response;
  }
}
export default class extends Entry {
  async fetch(request) {
    if (new URL(request.url).pathname !== path) return super.fetch(request);
    if (!gateway(request, this.env)) return new Response('Forbidden', { status: 403 });
    const namespace = this.env.ML_DSA_ADMISSION_DO;
    return namespace.get(namespace.idFromName('ml-dsa-admission-v1')).fetch(request);
  }
}
`;

export const preparationRaceFrontScript = `
import Entry from './shim.mjs';
export * from './shim.mjs';
export default class extends Entry {
  async fetch(request) {
    if (new URL(request.url).pathname !== '/__ml-dsa-preparation-race') return super.fetch(request);
    if (request.headers.get('x-router-ab-internal-service-auth') !== this.env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET)
      return new Response('Forbidden', { status: 403 });
    return this.env.ML_DSA_ROUTER.fetch(request);
  }
}
`;

export const preparationRaceRoleScript = `
import Entry from './shim.mjs';
export * from './shim.mjs';
function settle(resolve) { setTimeout(resolve, 100); }
async function control(env, action) {
  const namespace = env.ML_DSA_ADMISSION_DO;
  const response = await namespace.get(namespace.idFromName('ml-dsa-admission-v1')).fetch('https://admission.internal/__ml-dsa-preparation-race', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': env.INTERNAL_AUTH },
    body: JSON.stringify(action) });
  if (response.status !== 200) throw new Error('Preparation fixture control failed');
  return response.json();
}
export default class extends Entry {
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/router-ab/ml-dsa/registration/role' ||
        request.headers.get('x-router-ab-internal-service-auth') !== this.env.INTERNAL_AUTH) return super.fetch(request);
    const command = await request.clone().json();
    const response = await super.fetch(request);
    if (command.command !== 'prepare' || response.status !== 200) return response;
    if (await response.clone().json() !== true) throw new Error('Preparation did not finish successfully');
    const fault = await control(this.env, { action: 'observe', job: command.job });
    if (fault.mode === 'none') return response;
    if (fault.mode === 'claimed') {
      const deadline = Date.now() + 30000;
      while (true) {
        const record = await control(this.env, { action: 'read' });
        if (record.state.kind === 'claimed' && JSON.stringify(record.state.job.id) === JSON.stringify(command.job.id)) break;
        if (Date.now() >= deadline) throw new Error('Timed out waiting for exact claim');
        await new Promise(settle);
      }
    } else if (fault.mode !== 'unclaimed') throw new Error('Invalid preparation fault');
    return new Response('Injected lost successful preparation reply', { status: 503 });
  }
}
`;

export async function runPreparationRace({ mode, request, wallet, credential, raw, post }) {
  const path = '/__ml-dsa-preparation-race';
  const denied = await raw(path, { action: 'read' }, 'wrong-benchmark-credential');
  assert.equal(denied.status, 403);
  await denied.text();
  assert.equal(await post(path, { action: 'arm', mode }), true);
  const preparation = { state: { kind: 'pending' } };
  const pending = raw('/router-ab/ml-dsa/registration/prepare', { wallet }, credential)
    .then(readReply).catch(transportFailure).then(recordReply.bind(null, preparation));
  let registered = null;
  if (mode === 'claimed') {
    const deadline = Date.now() + 360000;
    while (true) {
      const observed = await post(path, { action: 'read' });
      if (observed.state.kind === 'holding') break;
      assert.equal(preparation.state.kind, 'pending', 'Preparation ended before the claim race');
      assert.ok(Date.now() < deadline, 'The preparation fixture did not become ready');
      await new Promise(pollDelay);
    }
    registered = post('/router-ab/ml-dsa/register', request).then(registrationSucceeded, registrationFailed);
  }
  await pending;
  assert.equal(preparation.state.kind, 'settled');
  assert.equal(preparation.state.reply.kind, 'reply');
  assert.ok(preparation.state.reply.status >= 500, 'Expected the lost successful reply');
  let resultSha256 = null;
  if (registered !== null) {
    const result = await registered;
    if (result.kind === 'failed') throw result.error;
    assert.equal(result.value.status, 'existing');
    assert.equal(result.value.operation.state, 'complete');
    resultSha256 = responseDigest(result.value);
  }
  const before = await post(path, { action: 'read' });
  assert.equal(before.state.kind, mode === 'claimed' ? 'preserved_claim' : 'retired');
  if (mode === 'claimed') assert.deepEqual(before.state.operation, request.operation);
  const reset = await raw(path, { action: 'reset' }, credential).then(readReply, transportFailure);
  if (reset.kind === 'reply') assert.ok(reset.status >= 500);
  const after = await post(path, { action: 'read' });
  assert.notEqual(after.instance, before.instance, 'Admission instance did not restart');
  assert.deepEqual(after.state, before.state, 'The retirement decision did not survive restart');
  assert.equal(await post(path, { action: 'late_ready' }), true);
  assert.equal(await post(path, { action: 'participant_retirement' }), true);
  assert.equal(await post(path, { action: 'arm', mode: 'none' }), true);
  if (mode === 'claimed') {
    const replay = await post('/router-ab/ml-dsa/register', request);
    assert.equal(responseDigest(replay), resultSha256);
    return { ready: { ready: true, job: after.state.job }, evidence: {
      ordering: mode, decision: after.state, restart: true, lateReadyRejected: true,
      participantRetirementDenied: true, resultSha256, completedReplayAfterRestart: true,
    } };
  }
  const ready = await post('/router-ab/ml-dsa/registration/prepare', { wallet });
  assert.notDeepEqual(ready.job.id, after.state.job.id);
  const allocatedAtMs = ready.job.prepare_until - 300000;
  assert.ok(allocatedAtMs < after.state.job.prepare_until, 'Replacement was allocated after lease expiry');
  return { ready, evidence: { ordering: mode, decision: after.state, restart: true,
    lateReadyRejected: true, participantRetirementDenied: true,
    replacementJob: ready.job, replacementAllocatedAtMs: allocatedAtMs } };
}
function pollDelay(resolve) { setTimeout(resolve, 1000); }
async function readReply(response) { await response.text(); return { kind: 'reply', status: response.status }; }
function transportFailure() { return { kind: 'transport_failure' }; }
function recordReply(holder, reply) { holder.state = { kind: 'settled', reply }; }
function registrationSucceeded(value) { return { kind: 'complete', value }; }
function registrationFailed(error) { return { kind: 'failed', error }; }
function responseDigest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
