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
const proxySource = `
const evidence = { connections: 0, aMessages: 0, bMessages: 0, disconnected: false };
class InterruptedExchange {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this.closed = false;
  }
  fromA(event) {
    if (this.closed) return;
    evidence.aMessages += 1;
    this.b.send(event.data);
  }
  fromB(event) {
    if (this.closed) return;
    evidence.bMessages += 1;
    if (evidence.bMessages === 2) {
      evidence.disconnected = true;
      this.close();
      return;
    }
    this.a.send(event.data);
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
    const response = await env.REAL_B.fetch(request);
    if (!path.endsWith('/ed25519-yao/duplex')) return response;
    evidence.connections += 1;
    if (evidence.disconnected) return response;
    const b = response.webSocket;
    if (!b) throw new Error('Expected B WebSocket');
    const pair = new WebSocketPair();
    const a = pair[1];
    a.binaryType = 'arraybuffer';
    b.binaryType = 'arraybuffer';
    a.accept();
    b.accept();
    const exchange = new InterruptedExchange(a, b);
    a.addEventListener('message', exchange.fromA.bind(exchange));
    b.addEventListener('message', exchange.fromB.bind(exchange));
    a.addEventListener('close', exchange.close.bind(exchange));
    b.addEventListener('close', exchange.close.bind(exchange));
    return new Response(null, { status: 101, headers: response.headers, webSocket: pair[0] });
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

async function requireBurned(worker, role, scope, credential) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await post(worker, `/router-ab/${role}/ed25519-yao/read-pair-status`, scope, credential);
    assert.equal(result.status, 200);
    if (result.body.status === 'burned') return result.body;
    await setTimeout(50);
  }
  assert.fail(`${role} did not persist the burned pair after disconnect`);
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
  await requireBurned(aBinding, 'deriver-a', scope, roleCredential);
  await requireBurned(bBinding, 'deriver-b', scope, roleCredential);
  const proxy = await topology.getWorker('disconnect-proxy');
  const interrupted = await (await proxy.fetch('https://custody.test/evidence')).json();
  assert.equal(interrupted.disconnected, true);
  assert.ok(interrupted.aMessages >= 1);
  assert.equal(interrupted.bMessages, 2);
  const retried = await post(aBinding, '/router-ab/deriver-a/ed25519-yao/execute-pair', execution, roleCredential);
  assert.ok(retried.status >= 400, 'A burned pair cannot return successful custody');
  const afterRetry = await (await proxy.fetch('https://custody.test/evidence')).json();
  assert.equal(afterRetry.connections, interrupted.connections, 'A burned pair must not restart the protocol');
  await requireBurned(aBinding, 'deriver-a', scope, roleCredential);
  await requireBurned(bBinding, 'deriver-b', scope, roleCredential);
  const fresh = buildEd25519ExecuteRequest(fixture, 'second_tenant_activation', roots.secondTenantRoot);
  const recovered = await post(routerBinding, executePath, fresh, gatewayCredential);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.status, 'succeeded');
  const artifact = {
    kind: 'yao_peer_disconnect_e2e_v1',
    interrupted,
    bothRolesPersistedBurned: true,
    exactRetryDidNotRestartProtocol: true,
    independentWalletCompletedAfterDisconnect: true,
    reproduce: 'ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/yao-peer-disconnect-evidence.mjs',
  };
  const output = resolve(root, '.artifacts/yao-peer-disconnect/evidence.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(artifact, null, 2) + '\n');
  console.log(JSON.stringify(artifact));
} finally {
  await topology.dispose();
}
