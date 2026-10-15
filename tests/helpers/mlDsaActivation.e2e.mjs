import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/** Exercise interrupted two-role installation without exposing role material to Router. */
export async function installMlDsaActivation(runtime, records, gatewayAuth, serviceAuth) {
  const router = await runtime.getWorker('router');
  const a = await runtime.getWorker('a');
  const b = await runtime.getWorker('b');
  const activation = records[0].activation;
  const request = {
    key: activation.key,
    operation: Array.from(randomBytes(32)),
    message_digest: Array.from(randomBytes(32)),
    context_digest: Array.from(randomBytes(32)),
  };
  const pending = await activate(router, activation, gatewayAuth);
  assert.equal(pending.state, 'installing');
  await requireSigningBlocked(router, request, gatewayAuth);
  await install(a, records[0], serviceAuth);
  assert.equal((await activate(router, activation, gatewayAuth)).state, 'installing');
  await requireSigningBlocked(router, request, gatewayAuth);
  // Exact delivery retry must preserve A's durable installation.
  await install(a, records[0], serviceAuth);
  const wrongRole = await send(b, '/router-ab/ml-dsa/role', {
    command: 'install_material', record: records[0],
  }, serviceAuth);
  assert.notEqual(wrongRole.status, 200);
  assert.equal((await activate(router, activation, gatewayAuth)).state, 'installing');
  await install(b, records[1], serviceAuth);
  const committed = await activate(router, activation, gatewayAuth);
  assert.equal(committed.state, 'active');
  assert.deepEqual(committed.activation, activation);
  assert.deepEqual(await activate(router, activation, gatewayAuth), committed);
  return {
    zeroInstallationsBlocked: true,
    oneInstallationBlocked: true,
    duplicateInstallationAccepted: true,
    wrongRoleRejected: true,
    twoInstallationsActivated: true,
    activationRetryIdempotent: true,
  };
}
async function activate(router, activation, secret) {
  const response = await send(router, '/router-ab/ml-dsa/activate', activation, secret);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function install(role, record, secret) {
  const response = await send(role, '/router-ab/ml-dsa/role', {
    command: 'install_material', record,
  }, secret);
  assert.equal(response.status, 200, await response.clone().text());
}
async function requireSigningBlocked(router, request, secret) {
  const response = await send(router, '/router-ab/ml-dsa/admit', request, secret);
  assert.notEqual(response.status, 200);
}
function send(worker, path, body, secret) {
  return worker.fetch(`https://ml-dsa.internal${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': secret,
    },
    body: JSON.stringify(body),
  });
}
