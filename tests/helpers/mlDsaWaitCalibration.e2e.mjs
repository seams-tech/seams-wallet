// Local-only delay controls around the actual Worker and transaction adapters.
export const waitCalibrationScript = `
import entry, { RouterAbMlDsaRegistrationDurableObject as Registration } from './deriver-b/worker/shim.mjs';
export * from './deriver-b/worker/shim.mjs';
let storageInjected = false;
let peerInjected = false;
const delayMs = 400;
const failStorage = __FAIL_STORAGE__;
const calibrate = __CALIBRATE__;
const commitmentFault = __COMMITMENT_FAULT__;
function settle(resolve) { setTimeout(resolve, delayMs); }
function hex(bytes) { return Array.from(bytes, hexByte).join(''); }
function hexByte(value) { return value.toString(16).padStart(2, '0'); }
async function delay(kind, job, operation) {
  const started_at_ms = Date.now();
  await new Promise(settle);
  console.log(JSON.stringify({ event: 'ml_dsa_wait_calibration_v1', kind, job, operation,
    delay_ms: delayMs, started_at_ms, finished_at_ms: Date.now() }));
}
async function delayedGet(original, key, ...options) {
  if (calibrate && !storageInjected && Array.isArray(key) && key[0]?.startsWith('registration-tables/')) {
    storageInjected = true;
    await delay('load_tables', key[0].split('/')[1], null);
    if (failStorage) throw new Error('Injected registration table read failure');
  }
  return original(key, ...options);
}
async function observedPut(metadata, flags, original, key, value, ...options) {
  const result = await original(key, value, ...options);
  if (key === 'registration-signing/0/record' && value.state === 'committing') flags.burned = true;
  if (metadata.armed && commitmentFault === 'publication' &&
      key === 'registration-signing/4/record' && value.state === 'committed' &&
      metadata.commitment.state === 'input_consumed') {
    metadata.commitment = { state: 'publication_failed', rollback: null };
    throw new Error('Injected commitment publication failure');
  }
  return result;
}
function transactionProperty(metadata, flags, target, key) {
  const value = Reflect.get(target, key, target);
  if (typeof value !== 'function') return value;
  const bound = value.bind(target);
  if (key === 'get') return delayedGet.bind(null, bound);
  if (key === 'put') return observedPut.bind(null, metadata, flags, bound);
  return bound;
}
function runTransaction(metadata, flags, callback, transaction) {
  return callback(new Proxy(transaction, { get: transactionProperty.bind(null, metadata, flags) }));
}
function holdPublication(metadata, resolve) {
  metadata.commitment = { state: 'publication_held', release: resolve };
}
async function delayedTransaction(metadata, original, callback) {
  if (metadata.armed && commitmentFault === 'retirement' && metadata.commitment.state === 'input_consumed') {
    await new Promise(holdPublication.bind(null, metadata));
  }
  const flags = { burned: false };
  let result;
  try {
    result = await original(runTransaction.bind(null, metadata, flags, callback));
  } catch (error) {
    if (metadata.commitment.state === 'publication_failed') {
      const rollback = await commitmentState(metadata.storage, metadata);
      metadata.commitment = { state: 'publication_failed', rollback };
    }
    throw error;
  }
  if (flags.burned && metadata.armed) metadata.commitment = { state: 'input_consumed' };
  return result;
}
function storageProperty(metadata, target, key) {
  const value = Reflect.get(target, key, target);
  if (typeof value !== 'function') return value;
  const bound = value.bind(target);
  return key === 'transaction' ? delayedTransaction.bind(null, metadata, bound) : bound;
}
function stateProperty(storage, target, key) {
  if (key === 'storage') return storage;
  const value = Reflect.get(target, key, target);
  return typeof value === 'function' ? value.bind(target) : value;
}
async function commitmentState(storage, metadata) {
  const job = await storage.get('job');
  if (!job) throw new Error('Commitment probe has no registration job');
  const stocks = [];
  let duplicateDeliveryRecords = 0;
  for (let ordinal = 0; ordinal < job.signing_batches; ordinal += 1) {
    const record = await storage.get('registration-signing/' + ordinal + '/record');
    if (await storage.get('registration-signing/' + ordinal + '/delivery/record') !== undefined) duplicateDeliveryRecords += 1;
    const state = record === undefined ? 'missing' : record.state;
    if (!['generic', 'committing', 'committed', 'missing'].includes(state)) throw new Error('Invalid stock state');
    stocks.push({ ordinal, state, inputChunkPresent: await storage.get('registration-signing/' + ordinal + '/0') !== undefined });
  }
  const preparation = await storage.get('registration-preparation/' + hex(job.id));
  return {
    stocks,
    storageAudit: { duplicateDeliveryRecords },
    publicationHeld: metadata.commitment.state === 'publication_held',
    preparationRetired: preparation?.state === 'retired',
    publicationFailed: metadata.commitment.state === 'publication_failed',
    publicationRollback: metadata.commitment.state === 'publication_failed' ? metadata.commitment.rollback : null,
    pairResultPublished: await storage.get('pair-result') !== undefined,
    ownResultPublished: await storage.get('own-result') !== undefined,
    materialPublished: await storage.get('material') !== undefined,
  };
}
function authenticated(request, env) {
  return request.headers.get('x-router-ab-internal-service-auth') === env.INTERNAL_AUTH;
}
export class RouterAbMlDsaRegistrationDurableObject extends Registration {
  constructor(state, env) {
    const metadata = { armed: env.COMMITMENT_FAILURE_ARMED === true, commitment: { state: 'idle' }, storage: state.storage };
    const storage = new Proxy(state.storage, { get: storageProperty.bind(null, metadata) });
    super(new Proxy(state, { get: stateProperty.bind(null, storage) }), env);
    this.probeStorage = state.storage;
    this.probeMetadata = metadata;
    this.probeEnv = env;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/test/commitment-')) return super.fetch(request);
    if (!authenticated(request, this.probeEnv)) return new Response('Forbidden', { status: 403 });
    if (path === '/test/commitment-retire') {
      const pending = this.probeMetadata.commitment;
      if (pending.state !== 'publication_held') return new Response('No held output', { status: 409 });
      await super.alarm();
      this.probeMetadata.commitment = { state: 'released' };
      pending.release();
    }
    return Response.json(await commitmentState(this.probeStorage, this.probeMetadata));
  }
}
async function delayPeer(request) {
  if (calibrate && !peerInjected && request.method === 'GET' && new URL(request.url).pathname === '/router-ab/ml-dsa/registration/role') {
    const encoded = request.headers.get('x-ml-dsa-input');
    const command = JSON.parse(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')));
    if (command.command === 'execute_peer') {
      peerInjected = true;
      await delay('peer_connect', hex(command.claim.job.id), hex(command.claim.request.operation));
    }
  }
}
export default class extends entry {
  async fetch(request) {
    if (new URL(request.url).pathname.startsWith('/test/commitment-')) {
      if (!authenticated(request, this.env)) return new Response('Forbidden', { status: 403 });
      const job = await request.clone().json();
      const namespace = this.env.ML_DSA_REGISTRATION_DO;
      return namespace.get(namespace.idFromName(hex(job.id))).fetch(request);
    }
    await delayPeer(request);
    return super.fetch(request);
  }
}
`;
