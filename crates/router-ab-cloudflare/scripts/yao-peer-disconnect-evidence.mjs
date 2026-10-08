import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { Miniflare } from 'miniflare';
import {
  loadFixture,
  configureRouterJwt,
  routerWorker,
  deriverAWorker,
  deriverBWorker,
  signingWorker,
  tenantRootControlPlaneWorker,
  applyMigrations,
  testTenantRootCreationOperatingPath,
  buildEd25519ExecuteRequest,
} from './test-private-d1.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const authHeader = 'x-router-ab-internal-service-auth';
const executePath = '/router-ab/router/ed25519-yao/execute';
const scenario = process.argv[2] ?? 'protocol-disconnect';
assert.ok([
  'protocol-disconnect', 'cancelled-root', 'missing-admission', 'forged-readiness', 'connection-refused', 'invalid-acceptance', 'forged-acceptance',
].includes(scenario), `Unknown scenario: ${scenario}`);
const proxySource = `
const evidence = {
  connectionAttempts: 0, connections: 0, aMessages: 0, bMessages: 0,
  disconnected: false, aClosed: false, bClosed: false, preparationFaultInjected: false,
  preparationRequests: 0
};
async function failPreparedAdmission(env) {
  const sql = env.SCENARIO === 'missing-admission'
    ? "DELETE FROM tenant_root_root_use_admissions WHERE attempt_kind = 'ed25519_yao_pair_session' AND status = 'admitted'"
    : "UPDATE tenant_root_root_use_admissions SET status = 'cancelled' WHERE attempt_kind = 'ed25519_yao_pair_session' AND status = 'admitted'";
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await env.DERIVER_A_DB.prepare(sql).run();
    if (result.meta.changes === 1) return;
    if (result.meta.changes !== 0) throw new Error('Fault must change exactly one A admission');
    await new Promise(waitForFault);
  }
  throw new Error('A did not prepare its root admission');
}
function waitForFault(resolve) {
  setTimeout(resolve, 10);
}
class InterruptedExchange {
  constructor(a, b, scenario) {
    this.a = a;
    this.b = b;
    this.closed = false;
    this.scenario = scenario;
  }
  fromA(event) {
    if (this.closed) return;
    evidence.aMessages += 1;
    this.b.send(event.data);
  }
  fromB(event) {
    if (this.closed) return;
    evidence.bMessages += 1;
    if (this.scenario === 'protocol-disconnect' && evidence.bMessages === 2) {
      evidence.disconnected = true;
      this.close();
      return;
    }
    this.a.send(event.data);
  }
  closedByA() {
    evidence.aClosed = true;
    this.close();
  }
  closedByB() {
    evidence.bClosed = true;
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.a.close(1011, 'E2E peer disconnect');
    this.b.close(1011, 'E2E peer disconnect');
  }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/evidence') return Response.json(evidence);
    if (path.endsWith('/prepare-pair')) evidence.preparationRequests += 1;
    if (path.endsWith('/prepare-pair') && !evidence.preparationFaultInjected) {
      const response = await env.REAL_B.fetch(request);
      if (!response.ok) return response;
      if (env.SCENARIO === 'cancelled-root' || env.SCENARIO === 'missing-admission') {
        await failPreparedAdmission(env);
        evidence.preparationFaultInjected = true;
      }
      if (env.SCENARIO === 'forged-readiness') {
        const receipt = await response.json();
        receipt.signature.bytes[0] ^= 1;
        evidence.preparationFaultInjected = true;
        return Response.json(receipt);
      }
      return response;
    }
    if (!path.endsWith('/ed25519-yao/duplex')) return env.REAL_B.fetch(request);
    evidence.connectionAttempts += 1;
    if (evidence.connectionAttempts > 1) return env.REAL_B.fetch(request);
    if (env.SCENARIO === 'connection-refused') return new Response('E2E refused upgrade', { status: 503 });
    const response = await env.REAL_B.fetch(request);
    const b = response.webSocket;
    if (!b) throw new Error('Expected B WebSocket');
    evidence.connections += 1;
    const pair = new WebSocketPair();
    const a = pair[1];
    a.binaryType = 'arraybuffer';
    b.binaryType = 'arraybuffer';
    a.accept();
    b.accept();
    const exchange = new InterruptedExchange(a, b, env.SCENARIO);
    a.addEventListener('message', exchange.fromA.bind(exchange));
    b.addEventListener('message', exchange.fromB.bind(exchange));
    a.addEventListener('close', exchange.closedByA.bind(exchange));
    b.addEventListener('close', exchange.closedByB.bind(exchange));
    const headers = new Headers(response.headers);
    if (env.SCENARIO === 'invalid-acceptance') headers.delete('x-seams-yao-start-acceptance');
    if (env.SCENARIO === 'forged-acceptance') {
      const acceptance = JSON.parse(headers.get('x-seams-yao-start-acceptance'));
      acceptance.signature.bytes[0] ^= 1;
      headers.set('x-seams-yao-start-acceptance', JSON.stringify(acceptance));
    }
    return new Response(null, { status: 101, headers, webSocket: pair[0] });
  }
};`;

class CaptureExecution {
  request = null;
  async fetch(request, topology) {
    if (new URL(request.url).pathname.endsWith('/execute-pair')) {
      this.request = await request.clone().json();
    }
    const worker = await topology.getWorker('deriver-a');
    return worker.fetch(request);
  }
}

async function post(worker, path, body, credential) {
  const response = await worker.fetch(`https://custody.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [authHeader]: credential,
      'x-seams-wallet-home-region': 'US',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function requirePairState(worker, role, scope, credential, expectedState) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await post(worker, `/router-ab/${role}/ed25519-yao/read-pair-status`, scope, credential);
    assert.equal(result.status, 200);
    if (result.body.status === expectedState) return result.body;
    await setTimeout(50);
  }
  assert.fail(`${role} did not reach ${expectedState} after ${scenario}`);
}

async function closedConnectionEvidence(proxy) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const evidence = await (await proxy.fetch('https://custody.test/evidence')).json();
    if (scenario === 'connection-refused' || scenario === 'forged-readiness' || (evidence.aClosed && evidence.bClosed)) return evidence;
    await setTimeout(20);
  }
  assert.fail('The failed pair left an open peer connection');
}

async function rejectChangedInputs(a, proxy, execution, credential) {
  const before = await (await proxy.fetch('https://custody.test/evidence')).json();
  for (const field of ['input_a', 'input_b']) {
    const changed = structuredClone(execution);
    changed[field].ciphertext[0] ^= 1;
    const rejected = await post(a, '/router-ab/deriver-a/ed25519-yao/execute-pair', changed, credential);
    assert.ok(rejected.status >= 400, `Changed ${field} must be rejected`);
  }
  const after = await (await proxy.fetch('https://custody.test/evidence')).json();
  assert.equal(after.preparationRequests, before.preparationRequests, 'Changed inputs must not prepare B');
  assert.equal(after.connectionAttempts, before.connectionAttempts, 'Changed inputs must not start the protocol');
}

const fixture = loadFixture();
configureRouterJwt(fixture);
const capture = new CaptureExecution();
const router = routerWorker(fixture);
router.serviceBindings.DERIVER_A = capture.fetch.bind(capture);
const a = deriverAWorker(fixture);
a.serviceBindings.DERIVER_B = 'disconnect-proxy';
const topology = new Miniflare({
  workers: [
    router,
    a,
    deriverBWorker(fixture),
    tenantRootControlPlaneWorker(fixture),
    signingWorker('fixture-signing-worker', 'disconnect-signing-worker', fixture),
    {
      name: 'disconnect-proxy',
      modules: true,
      script: proxySource,
      compatibilityDate: '2026-06-12',
      bindings: { SCENARIO: scenario },
      d1Databases: { DERIVER_A_DB: a.d1Databases.DERIVER_ROLE_PRIVATE_DB },
      serviceBindings: { REAL_B: 'deriver-b' },
    },
  ],
});
try {
  await topology.ready;
  const migrations = resolve(root, 'crates/router-ab-cloudflare/migrations');
  const databases = {
    deriverA: await applyMigrations(topology, 'DERIVER_ROLE_PRIVATE_DB', 'deriver-a', resolve(migrations, 'deriver-a')),
    deriverB: await applyMigrations(topology, 'DERIVER_ROLE_PRIVATE_DB', 'deriver-b', resolve(migrations, 'deriver-b')),
  };
  await applyMigrations(topology, 'SIGNING_WORKER_PRIVATE_DB', 'fixture-signing-worker', resolve(migrations, 'signing-worker'));
  const roots = await testTenantRootCreationOperatingPath(topology, fixture, databases);
  const gatewayCredential = fixture.router_env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET;
  const roleCredential = fixture.deriver_a_env.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET;
  const routerBinding = await topology.getWorker('router');
  const envelope = buildEd25519ExecuteRequest(fixture, 'activation', roots.tenantRoot);
  const failed = await post(routerBinding, executePath, envelope, gatewayCredential);
  assert.notEqual(failed.body.status, 'succeeded');
  assert.ok(capture.request);
  const execution = capture.request;
  const scope = {
    wallet_home: execution.tenant_root.wallet_home,
    ownership_generation: execution.tenant_root.ownership_generation,
    root_identity: execution.tenant_root.identity,
    pair_binding: execution.pair_binding,
  };
  const aBinding = await topology.getWorker('deriver-a');
  const bBinding = await topology.getWorker('deriver-b');
  const expectedBState = scenario === 'connection-refused' || scenario === 'forged-readiness' ? 'prepared' : 'burned';
  const expectedAState = scenario === 'forged-readiness' ? 'prepared' : 'burned';
  await requirePairState(aBinding, 'deriver-a', scope, roleCredential, expectedAState);
  await requirePairState(bBinding, 'deriver-b', scope, roleCredential, expectedBState);
  const proxy = await topology.getWorker('disconnect-proxy');
  const interrupted = await closedConnectionEvidence(proxy);
  const readinessRejected = scenario === 'forged-readiness';
  assert.equal(interrupted.connectionAttempts, readinessRejected ? 0 : 1, 'Readiness must pass before execution starts');
  assert.equal(interrupted.connections, scenario === 'connection-refused' || readinessRejected ? 0 : 1);
  if (scenario === 'protocol-disconnect') {
    assert.equal(interrupted.disconnected, true);
    assert.ok(interrupted.aMessages >= 1);
    assert.equal(interrupted.bMessages, 2);
  } else {
    assert.equal(interrupted.aMessages, 0, 'A must validate its root and B acceptance before sending protocol data');
  }
  if (readinessRejected) {
    await rejectChangedInputs(aBinding, proxy, execution, roleCredential);
  }
  const retried = await post(aBinding, '/router-ab/deriver-a/ed25519-yao/execute-pair', execution, roleCredential);
  const afterRetry = await (await proxy.fetch('https://custody.test/evidence')).json();
  if (readinessRejected) {
    assert.equal(retried.status, 200, 'The valid readiness retry must complete the prepared pair');
    assert.equal(afterRetry.connectionAttempts, 1);
    await requirePairState(aBinding, 'deriver-a', scope, roleCredential, 'completed');
    await requirePairState(bBinding, 'deriver-b', scope, roleCredential, 'completed');
    await rejectChangedInputs(aBinding, proxy, execution, roleCredential);
  } else {
    assert.ok(retried.status >= 400, 'A burned pair cannot return successful custody');
    assert.equal(afterRetry.connectionAttempts, interrupted.connectionAttempts, 'A burned pair must not restart the protocol');
    await requirePairState(aBinding, 'deriver-a', scope, roleCredential, 'burned');
    await requirePairState(bBinding, 'deriver-b', scope, roleCredential, expectedBState);
  }
  const fresh = buildEd25519ExecuteRequest(fixture, 'second_tenant_activation', roots.secondTenantRoot);
  const recovered = await post(routerBinding, executePath, fresh, gatewayCredential);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.status, 'succeeded');
  const artifact = {
    kind: 'yao_peer_disconnect_e2e_v1',
    scenario,
    interrupted,
    roleStatesAfterFailure: { deriverA: expectedAState, deriverB: expectedBState },
    retry: readinessRejected
      ? { outcome: 'completed_after_readiness_rejection', protocolConnections: 1, changedInputsRejectedBeforeAndAfterCompletion: true }
      : { outcome: 'burned_pair_refused', additionalProtocolConnections: 0 },
    independentWalletCompletedAfterDisconnect: true,
    reproduce: `ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/yao-peer-disconnect-evidence.mjs ${scenario}`,
  };
  const output = resolve(root, `.artifacts/yao-peer-disconnect/${scenario}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(artifact, null, 2) + '\n');
  console.log(JSON.stringify(artifact));
} finally {
  await topology.dispose();
}
