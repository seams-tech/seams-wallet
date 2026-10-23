// Local-only delay controls around the actual Worker and transaction adapters.
export const waitCalibrationScript = `
import entry, { RouterAbMlDsaRegistrationDurableObject as Registration } from './deriver-b/worker/shim.mjs';
export * from './deriver-b/worker/shim.mjs';
let storageInjected = false;
let peerInjected = false;
const delayMs = 400;
const failStorage = __FAIL_STORAGE__;
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
  if (!storageInjected && Array.isArray(key) && key[0]?.startsWith('registration-tables/')) {
    storageInjected = true;
    await delay('load_tables', key[0].split('/')[1], null);
    if (failStorage) throw new Error('Injected registration table read failure');
  }
  return original(key, ...options);
}
function transactionProperty(target, key) {
  const value = Reflect.get(target, key, target);
  if (typeof value !== 'function') return value;
  const bound = value.bind(target);
  return key === 'get' ? delayedGet.bind(null, bound) : bound;
}
function runTransaction(callback, transaction) {
  return callback(new Proxy(transaction, { get: transactionProperty }));
}
function delayedTransaction(original, callback) {
  return original(runTransaction.bind(null, callback));
}
function storageProperty(target, key) {
  const value = Reflect.get(target, key, target);
  if (typeof value !== 'function') return value;
  const bound = value.bind(target);
  return key === 'transaction' ? delayedTransaction.bind(null, bound) : bound;
}
function stateProperty(storage, target, key) {
  if (key === 'storage') return storage;
  const value = Reflect.get(target, key, target);
  return typeof value === 'function' ? value.bind(target) : value;
}
export class RouterAbMlDsaRegistrationDurableObject extends Registration {
  constructor(state, env) {
    const storage = new Proxy(state.storage, { get: storageProperty });
    super(new Proxy(state, { get: stateProperty.bind(null, storage) }), env);
  }
}
async function delayPeer(request) {
  if (!peerInjected && request.method === 'GET' && new URL(request.url).pathname === '/router-ab/ml-dsa/registration/role') {
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
    await delayPeer(request);
    return super.fetch(request);
  }
}
`;
