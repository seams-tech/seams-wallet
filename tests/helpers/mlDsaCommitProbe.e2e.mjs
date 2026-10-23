// Test-only explicit durability barriers around the real registration transactions.
export function commitProbeScript(role) {
  if (role !== 'a' && role !== 'b') throw new Error('Invalid commit probe role');
  return template.replaceAll('__ROLE__', role);
}
const template = `
import Entry, { RouterAbMlDsaRegistrationDurableObject as Registration } from './deriver-__ROLE__/worker/shim.mjs';
export * from './deriver-__ROLE__/worker/shim.mjs';
const calibrationPath = '/__ml-dsa-commit-calibration';
function settle(resolve) { setTimeout(resolve, 400); }
async function measuredTransaction(storage, metadata, callback) {
  const event = { event: 'ml_dsa_commit_probe_v1', role: '__ROLE__',
    object: metadata.object, instance: metadata.instance, sequence: metadata.next++,
    transaction_started_ms: Date.now(), transaction_returned_ms: null,
    sync_finished_ms: null, state: 'transaction_error', calibration: null };
  try {
    const value = await storage.transaction(callback);
    event.transaction_returned_ms = Date.now();
    event.state = 'sync_error';
    if (metadata.calibrate) {
      metadata.calibrate = false;
      const started_ms = Date.now();
      await new Promise(settle);
      event.calibration = { requested_ms: 400, started_ms, finished_ms: Date.now() };
    }
    await storage.sync();
    event.sync_finished_ms = Date.now();
    event.state = 'complete';
    return value;
  } finally {
    metadata.last = event;
    console.log(JSON.stringify(event));
  }
}
function storageProperty(metadata, target, key) {
  if (key === 'transaction') return measuredTransaction.bind(null, target, metadata);
  const value = Reflect.get(target, key, target);
  return typeof value === 'function' ? value.bind(target) : value;
}
function stateProperty(storage, target, key) {
  if (key === 'storage') return storage;
  const value = Reflect.get(target, key, target);
  return typeof value === 'function' ? value.bind(target) : value;
}
async function calibrationWrite(transaction) { await transaction.put('commit-probe-calibration', true); }
function authenticated(request, env) {
  return request.headers.get('x-router-ab-internal-service-auth') === env.INTERNAL_AUTH;
}
export class RouterAbMlDsaRegistrationDurableObject extends Registration {
  constructor(state, env) {
    const metadata = { object: state.id.toString(), instance: crypto.randomUUID().replaceAll('-', ''),
      next: 0, calibrate: false, last: null };
    const storage = new Proxy(state.storage, { get: storageProperty.bind(null, metadata) });
    super(new Proxy(state, { get: stateProperty.bind(null, storage) }), env);
    this.probeStorage = storage;
    this.probeMetadata = metadata;
    this.probeEnv = env;
  }
  async fetch(request) {
    if (new URL(request.url).pathname !== calibrationPath) return super.fetch(request);
    if (!authenticated(request, this.probeEnv)) return new Response('Forbidden', { status: 403 });
    this.probeMetadata.calibrate = true;
    await this.probeStorage.transaction(calibrationWrite);
    return Response.json(this.probeMetadata.last);
  }
}
export default class extends Entry {
  async fetch(request) {
    if (new URL(request.url).pathname !== calibrationPath) return super.fetch(request);
    if (!authenticated(request, this.env)) return new Response('Forbidden', { status: 403 });
    const namespace = this.env.ML_DSA_REGISTRATION_DO;
    return namespace.get(namespace.idFromName('commit-probe-calibration')).fetch(request);
  }
}
`;

export const readinessDelayScript = `
import { RouterAbMlDsaAdmissionDurableObject as Admission } from './router/worker/shim.mjs';
export * from './router/worker/shim.mjs';
export { default } from './router/worker/shim.mjs';
function settle(resolve) { setTimeout(resolve, 400); }
function hexByte(value) { return value.toString(16).padStart(2, '0'); }
export class RouterAbMlDsaAdmissionDurableObject extends Admission {
  constructor(state, env) { super(state, env); this.fixtureEnv = env; this.delayed = false; }
  async fetch(request) {
    if (!this.delayed && new URL(request.url).pathname === '/check' &&
        request.headers.get('x-router-ab-internal-service-auth') === this.fixtureEnv.INTERNAL_AUTH) {
      const command = await request.clone().json();
      if (command.command === 'ready_registration' && command.role === 'b') {
        this.delayed = true;
        const started_ms = Date.now();
        await new Promise(settle);
        console.log(JSON.stringify({ event: 'ml_dsa_peer_completion_calibration_v1',
          job: Array.from(command.job.id, hexByte).join(''), requested_ms: 400,
          started_ms, finished_ms: Date.now() }));
      }
    }
    return super.fetch(request);
  }
}
`;

export function commitProbeProxyScript(role) {
  if (role !== 'front' && role !== 'router') throw new Error('Invalid probe proxy role');
  return proxyTemplate.replaceAll('__PROXY_ROLE__', role);
}
const proxyTemplate = `
import Entry from './shim.mjs';
export * from './shim.mjs';
export default class extends Entry {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== '/__ml-dsa-commit-calibration/a' && path !== '/__ml-dsa-commit-calibration/b')
      return super.fetch(request);
    if (request.headers.get('x-router-ab-internal-service-auth') !== this.env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET)
      return new Response('Forbidden', { status: 403 });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if ('__PROXY_ROLE__' === 'front') return this.env.ML_DSA_ROUTER.fetch(request);
    const headers = new Headers({ 'x-router-ab-internal-service-auth': this.env.INTERNAL_AUTH });
    const identity = request.headers.get('x-ml-dsa-request-id');
    if (identity !== null && /^[0-9a-f]{32}$/.test(identity)) headers.set('x-ml-dsa-request-id', identity);
    const forwarded = new Request('https://probe.internal/__ml-dsa-commit-calibration', { headers });
    if (path.endsWith('/a')) return this.env.DERIVER_A.fetch(forwarded);
    return this.env.DERIVER_B.fetch(forwarded);
  }
}
`;
