// One Ed25519 Yao pair through real Workers and wallet objects, with one
// ordering or failure injected between the Router's two concurrent requests
// and on Deriver A's connection to Deriver B.
//
// The Router sends Deriver B its preparation and Deriver A its execution at
// the same time. Each scenario fixes which arrives first, or what is lost, and
// checks the one durable outcome: the pair completes, Deriver A releases its
// reservation and an exact retry completes, or the execution identity is
// spent and stays spent.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';
import { Log, LogLevel, Miniflare } from 'miniflare';
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
const admissionTable = 'tenant_root_root_use_admissions';

// `outcome` is what the first run leaves:
// - `completed`: the pair completes.
// - `released`: Deriver B held no claim, Deriver A released its reservation,
//   and an exact retry after the Router's claim lapses completes.
// - `burned`: the execution identity is spent at Deriver A.
// `preparation` is how Deriver B's preparation request is delivered,
// `connection` what happens to Deriver A's connection, `execution` how
// Deriver A's execution request is delivered, and `b` the state Deriver B is
// left in when the pair does not complete.
const scenarios = {
  'socket-before-preparation': { outcome: 'completed', preparation: 'after-connection' },
  'preparation-before-socket': { outcome: 'completed', connection: 'after-preparation' },
  'preparation-reply-lost': { outcome: 'completed', preparation: 'lose-reply' },
  'duplicate-socket': { outcome: 'completed', connection: 'duplicate' },
  'duplicate-execution': { outcome: 'completed', execution: 'duplicate' },
  'preparation-never-arrives': { outcome: 'released', preparation: 'never', b: 'missing' },
  'preparation-fails': { outcome: 'released', preparation: 'd1-error', b: 'missing', leaseMs: 6_000 },
  'late-preparation-after-refusal': { outcome: 'released', preparation: 'after-execution', b: 'prepared' },
  'changed-generation': { outcome: 'released', connection: 'changed-generation', b: 'prepared' },
  'connection-refused': { outcome: 'burned', connection: 'refused-after-preparation', b: 'prepared' },
  'wrong-scope': { outcome: 'burned', connection: 'wrong-root', b: 'prepared' },
  'lost-upgrade-reply': { outcome: 'burned', connection: 'lose-reply', b: 'burned' },
  'protocol-disconnect': { outcome: 'burned', connection: 'disconnect', b: 'burned' },
  'cancelled-root': { outcome: 'burned', connection: 'cancel-admission', b: 'burned' },
  'missing-admission': { outcome: 'burned', connection: 'delete-admission', b: 'burned' },
  'late-preparation-after-burn': {
    outcome: 'burned', preparation: 'after-execution', connection: 'refused', b: 'burned',
  },
};
const scenario = process.argv[2] ?? 'protocol-disconnect';
const plan = scenarios[scenario];
assert.ok(plan, `Unknown scenario: ${scenario}. Known: ${Object.keys(scenarios).join(', ')}`);
// A released pair is retried once the Router's claim on the registration has
// lapsed, so those runs keep the claim's lease short.
const leaseMs = plan.leaseMs ?? (plan.outcome === 'released' ? 2_000 : null);

const watchedSpans = new Set([
  'deriver_a.target_prepared', 'deriver_a.websocket_connect', 'deriver_b.await_preparation',
]);

class SpanLog extends Log {
  spans = [];

  constructor() {
    super(LogLevel.INFO);
  }

  connect(stdout, stderr) {
    for (const stream of [stdout, stderr]) {
      createInterface({ input: stream }).on('line', this.log.bind(this));
    }
  }

  log(message) {
    const start = message.indexOf('{');
    if (start < 0) return;
    try {
      const event = JSON.parse(message.slice(start));
      if (typeof event.span === 'string' && watchedSpans.has(event.span)) {
        this.spans.push({ span: event.span, outcome: event.outcome, durationMs: event.duration_ms });
      }
    } catch {
      // Unrelated Worker output is not a ceremony span.
    }
  }

  named(span) {
    return this.spans.filter((event) => event.span === span);
  }
}

function signal() {
  let resolveSignal;
  const promise = new Promise((done) => {
    resolveSignal = done;
  });
  return { promise, resolve: resolveSignal };
}

// What the bindings and the proxy tell each other about the first run.
const firstRun = {
  connectionArrived: signal(),
  preparationAnswered: signal(),
  executionAnswered: signal(),
};

const proxySource = `
const evidence = {
  connectionAttempts: 0, connections: 0, refusals: [], aMessages: 0, bMessages: 0,
  disconnected: false, aClosed: false, bClosed: false
};
class Exchange {
  constructor(a, b, behaviour) {
    this.a = a;
    this.b = b;
    this.closed = false;
    this.behaviour = behaviour;
  }
  fromA(event) {
    if (this.closed) return;
    evidence.aMessages += 1;
    this.b.send(event.data);
  }
  fromB(event) {
    if (this.closed) return;
    evidence.bMessages += 1;
    if (this.behaviour === 'disconnect' && evidence.bMessages === 2) {
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
async function cancelPreparedAdmission(env) {
  const rows = await env.ADMISSION_DB.prepare(
    "SELECT attempt_key_hex, pair_object_name FROM ${admissionTable} WHERE attempt_kind = 'ed25519_yao_pair_session' AND status = 'admitted'",
  ).all();
  if (rows.results.length !== 1) throw new Error('Expected one admitted A execution');
  const admission = rows.results[0];
  const sql = env.CONNECTION === 'delete-admission'
    ? "DELETE FROM ${admissionTable} WHERE attempt_key_hex = ?1"
    : "UPDATE ${admissionTable} SET status = 'cancelled' WHERE attempt_key_hex = ?1";
  const changed = await env.ADMISSION_DB.prepare(sql).bind(admission.attempt_key_hex).run();
  if (changed.meta.changes !== 1) throw new Error('Expected exactly one changed admission');
  const object = env.A_WALLET.get(env.A_WALLET.idFromName(admission.pair_object_name));
  const response = await object.fetch('https://custody.test/router-ab/internal/deriver-a/wallet-pair/reconcile', {
    method: 'POST',
    body: JSON.stringify({
      session_hex: admission.attempt_key_hex,
      fence: true,
      peer_settled: false,
      now_ms: Date.now(),
    }),
  });
  const state = await response.json();
  if (response.status !== 200 || state !== 'fenced') throw new Error('A admission was not fenced before B accepted');
  evidence.admissionCancelledAfterPreparation = true;
}
// The connection as Deriver A sent it, for another wallet object: the next
// ownership generation, or another tenant root.
function rescoped(request, behaviour) {
  const headers = new Headers(request.headers);
  const start = JSON.parse(headers.get('x-seams-yao-wallet-pair-scope'));
  if (behaviour === 'changed-generation') start.scope.ownership_generation += 1;
  else start.scope.root_identity.project_id = start.scope.root_identity.project_id + '-other';
  headers.set('x-seams-yao-wallet-pair-scope', JSON.stringify(start));
  return new Request(request, { headers });
}
async function refusal(response) {
  const body = await response.text();
  let reason = null;
  try {
    reason = JSON.parse(body).reason ?? null;
  } catch {
    // An untyped failure names no reason.
  }
  evidence.refusals.push({ status: response.status, reason });
  return new Response(body, { status: response.status, headers: response.headers });
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/evidence') return Response.json(evidence);
    if (!path.endsWith('/ed25519-yao/duplex')) return env.REAL_B.fetch(request);
    evidence.connectionAttempts += 1;
    if (evidence.connectionAttempts > 1) return env.REAL_B.fetch(request);
    const behaviour = env.CONNECTION;
    await env.ORDER.fetch('https://order.test/connection-arrived');
    if (behaviour === 'after-preparation' || behaviour === 'refused-after-preparation') {
      await env.ORDER.fetch('https://order.test/preparation-answered');
    }
    if (behaviour === 'cancel-admission' || behaviour === 'delete-admission') {
      await cancelPreparedAdmission(env);
    }
    if (behaviour === 'refused' || behaviour === 'refused-after-preparation') {
      return refusal(new Response('E2E refused upgrade', { status: 503 }));
    }
    if (behaviour === 'changed-generation' || behaviour === 'wrong-root') {
      return refusal(await env.REAL_B.fetch(rescoped(request, behaviour)));
    }
    const again = behaviour === 'duplicate' ? new Request(request) : null;
    const response = await env.REAL_B.fetch(request);
    const b = response.webSocket;
    if (!b) return refusal(response);
    evidence.connections += 1;
    b.binaryType = 'arraybuffer';
    b.accept();
    if (behaviour === 'lose-reply') {
      // Deriver A never holds a socket: B's is the only one to close.
      b.close(1011, 'E2E lost upgrade reply');
      evidence.aClosed = true;
      evidence.bClosed = true;
      return refusal(new Response('E2E lost upgrade reply', { status: 503 }));
    }
    if (again) {
      const second = await env.REAL_B.fetch(again);
      if (second.webSocket) {
        second.webSocket.accept();
        second.webSocket.close(1011, 'E2E duplicate socket');
        evidence.duplicateSocket = { status: second.status, upgraded: true };
      } else {
        const body = await second.text();
        let typedRefusal = false;
        try {
          typedRefusal = typeof JSON.parse(body).reason === 'string';
        } catch {
          // An untyped failure is not a refusal that releases Deriver A.
        }
        evidence.duplicateSocket = { status: second.status, upgraded: false, typedRefusal };
      }
    }
    const pair = new WebSocketPair();
    const a = pair[1];
    a.binaryType = 'arraybuffer';
    a.accept();
    const exchange = new Exchange(a, b, behaviour);
    a.addEventListener('message', exchange.fromA.bind(exchange));
    b.addEventListener('message', exchange.fromB.bind(exchange));
    a.addEventListener('close', exchange.closedByA.bind(exchange));
    b.addEventListener('close', exchange.closedByB.bind(exchange));
    return new Response(null, { status: 101, headers: response.headers, webSocket: pair[0] });
  }
};`;

// What the proxy asks: it reports Deriver A's connection, and can wait for
// Deriver B's preparation to be answered.
async function order(request) {
  const path = new URL(request.url).pathname;
  if (path === '/connection-arrived') firstRun.connectionArrived.resolve();
  if (path === '/preparation-answered') await firstRun.preparationAnswered.promise;
  return new Response('ok');
}

// The Router's binding to Deriver A. It keeps the first execution request,
// and can send it twice at once.
class ExecutionBinding {
  request = null;
  duplicate = null;

  async fetch(request, topology) {
    const worker = await topology.getWorker('deriver-a');
    if (!new URL(request.url).pathname.endsWith('/execute-pair') || this.request) {
      return worker.fetch(request);
    }
    this.request = await request.clone().json();
    try {
      if (plan.execution !== 'duplicate') return await worker.fetch(request);
      const answers = await Promise.all([worker.fetch(request.clone()), worker.fetch(request)]);
      const bodies = await Promise.all(answers.map((answer) => answer.text()));
      const completed = answers.findIndex((answer) => answer.ok);
      this.duplicate = { statuses: answers.map((answer) => answer.status) };
      assert.equal(answers.filter((answer) => answer.ok).length, 1, 'One of two identical executions wins');
      return new Response(bodies[completed], { status: answers[completed].status, headers: answers[completed].headers });
    } finally {
      firstRun.executionAnswered.resolve();
    }
  }
}

// The Router's binding to Deriver B. It delivers the first preparation as
// the scenario orders it.
class PreparationBinding {
  first = true;
  delivered = null;

  async fetch(request, topology) {
    const worker = await topology.getWorker('deriver-b');
    if (!new URL(request.url).pathname.endsWith('/prepare-pair') || !this.first) {
      return worker.fetch(request);
    }
    this.first = false;
    try {
      if (plan.preparation === 'never') {
        this.delivered = { forwarded: false };
        return new Response('E2E lost preparation request', { status: 503 });
      }
      if (plan.preparation === 'after-connection') {
        await firstRun.connectionArrived.promise;
        // Deriver B's wallet object is already holding the connection.
        await setTimeout(300);
      }
      if (plan.preparation === 'after-execution') await firstRun.executionAnswered.promise;
      const response = await worker.fetch(request);
      const body = await response.text();
      this.delivered = { forwarded: true, status: response.status, body: body.slice(0, 300) };
      if (plan.preparation === 'lose-reply') {
        return new Response('E2E lost preparation reply', { status: 503 });
      }
      return new Response(body, { status: response.status, headers: response.headers });
    } finally {
      firstRun.preparationAnswered.resolve();
    }
  }
}

async function post(worker, path, body, credential) {
  const startedAt = Date.now();
  const response = await worker.fetch(`https://custody.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [authHeader]: credential,
      'x-seams-wallet-home-region': 'US',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A protocol error answers in text.
  }
  return { status: response.status, body: parsed, text, elapsedMs: Date.now() - startedAt };
}

async function pairState(worker, role, scope, credential) {
  const result = await post(worker, `/router-ab/${role}/ed25519-yao/read-pair-status`, scope, credential);
  assert.equal(result.status, 200, result.text);
  return result.body.status;
}

async function requirePairState(worker, role, scope, credential, expectedState) {
  let state;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    state = await pairState(worker, role, scope, credential);
    if (state === expectedState) return state;
    await setTimeout(50);
  }
  assert.fail(`${role} is ${state}, not ${expectedState}, after ${scenario}`);
}

async function proxyEvidence(proxy) {
  return (await proxy.fetch('https://custody.test/evidence')).json();
}

async function closedConnectionEvidence(proxy) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const evidence = await proxyEvidence(proxy);
    if (evidence.connections === 0 || (evidence.aClosed && evidence.bClosed)) return evidence;
    await setTimeout(20);
  }
  assert.fail('The failed pair left an open peer connection');
}

async function admissions(database, sessionHex) {
  const rows = await database
    .prepare(`SELECT status FROM ${admissionTable} WHERE attempt_key_hex = ?1 ORDER BY admitted_at_ms`)
    .bind(sessionHex)
    .all();
  return rows.results.map((row) => row.status);
}

async function settledAdmissions(database, sessionHex) {
  let statuses;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    statuses = await admissions(database, sessionHex);
    if (statuses.length > 0 && statuses.every((status) => status === 'settled')) return statuses;
    await setTimeout(50);
  }
  assert.fail(`A completed pair left admissions ${JSON.stringify(statuses)}`);
}

const fixture = loadFixture();
configureRouterJwt(fixture);
if (leaseMs !== null) fixture.router_env.ROUTER_YAO_REGISTRATION_LEASE_MS = String(leaseMs);
const log = new SpanLog();
const execution = new ExecutionBinding();
const preparation = new PreparationBinding();
const router = routerWorker(fixture);
router.serviceBindings.DERIVER_A = execution.fetch.bind(execution);
router.serviceBindings.DERIVER_B = preparation.fetch.bind(preparation);
const a = deriverAWorker(fixture);
a.serviceBindings.DERIVER_B = 'pair-connection-proxy';
const topology = new Miniflare({
  log,
  handleRuntimeStdio: log.connect.bind(log),
  workers: [
    router,
    a,
    deriverBWorker(fixture),
    tenantRootControlPlaneWorker(fixture),
    signingWorker('fixture-signing-worker', 'disconnect-signing-worker', fixture),
    {
      name: 'pair-connection-proxy',
      modules: true,
      script: proxySource,
      compatibilityDate: '2026-06-12',
      bindings: { CONNECTION: plan.connection ?? 'forward' },
      d1Databases: { ADMISSION_DB: 'deriver-a-private-d1' },
      durableObjects: {
        A_WALLET: { className: 'RouterAbDeriverAWalletDurableObject', scriptName: 'deriver-a', useSQLite: true },
      },
      serviceBindings: { REAL_B: 'deriver-b', ORDER: order },
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
  const aBinding = await topology.getWorker('deriver-a');
  const bBinding = await topology.getWorker('deriver-b');
  const proxy = await topology.getWorker('pair-connection-proxy');
  const envelope = buildEd25519ExecuteRequest(fixture, 'activation', roots.tenantRoot);

  // Deriver B's preparation fails on a real D1 error: its admission table is
  // out of reach for the first run.
  const heldTable = `${admissionTable}_held`;
  if (plan.preparation === 'd1-error') {
    await databases.deriverB.exec(`ALTER TABLE ${admissionTable} RENAME TO ${heldTable}`);
  }
  const first = await post(routerBinding, executePath, envelope, gatewayCredential);
  if (plan.preparation === 'd1-error') {
    await databases.deriverB.exec(`ALTER TABLE ${heldTable} RENAME TO ${admissionTable}`);
  }
  assert.ok(execution.request, 'The Router sent Deriver A its execution');
  const request = execution.request;
  const scope = {
    wallet_home: request.tenant_root.wallet_home,
    ownership_generation: request.tenant_root.ownership_generation,
    root_identity: request.tenant_root.identity,
    pair_binding: request.pair_binding,
  };
  const sessionHex = Buffer.from(request.pair_binding.ceremony.binding.session_id).toString('hex');
  const artifact = {
    kind: 'yao_pair_connection_e2e_v1',
    scenario,
    plan,
    firstRun: {
      httpStatus: first.status,
      status: first.body?.status ?? null,
      code: first.body?.code ?? null,
      elapsedMs: first.elapsedMs,
    },
    preparationDelivery: preparation.delivered,
    reproduce: `ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/yao-peer-disconnect-evidence.mjs ${scenario}`,
  };
  const waited = log.named('deriver_b.await_preparation');

  if (plan.outcome === 'completed') {
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.status, 'succeeded', first.text);
    const evidence = await proxyEvidence(proxy);
    assert.equal(evidence.connectionAttempts, 1, 'One execution opens one connection');
    assert.equal(evidence.connections, 1);
    await requirePairState(aBinding, 'deriver-a', scope, roleCredential, 'completed');
    await requirePairState(bBinding, 'deriver-b', scope, roleCredential, 'completed');
    if (plan.preparation === 'after-connection') {
      assert.deepEqual(waited.map((event) => event.outcome), ['success'], 'B waited for its preparation, then claimed');
    }
    if (plan.connection === 'after-preparation') {
      assert.deepEqual(waited, [], 'B was prepared when the connection arrived');
    }
    if (plan.preparation === 'lose-reply') {
      assert.equal(preparation.delivered.status, 200, 'B prepared, and only its reply was lost');
    }
    if (plan.connection === 'duplicate') {
      assert.equal(evidence.duplicateSocket.upgraded, false, 'A running pair admits no second connection');
      assert.ok(evidence.duplicateSocket.status >= 400);
      assert.equal(evidence.duplicateSocket.typedRefusal, false, 'B does not say it holds no claim once it claimed');
    }
    if (plan.execution === 'duplicate') {
      assert.ok(execution.duplicate, 'Two identical executions reached Deriver A');
    }
    artifact.duplicateExecution = execution.duplicate;
    artifact.admissions = {
      deriverA: await settledAdmissions(databases.deriverA, sessionHex),
      deriverB: await settledAdmissions(databases.deriverB, sessionHex),
    };
    artifact.connection = evidence;
  } else {
    assert.notEqual(first.body?.status, 'succeeded', first.text);
    const evidence = await closedConnectionEvidence(proxy);
    assert.equal(evidence.connectionAttempts, 1, 'One execution opens one connection');
    const expectedA = plan.outcome === 'released' ? 'prepared' : 'burned';
    const aState = await requirePairState(aBinding, 'deriver-a', scope, roleCredential, expectedA);
    const bState = await requirePairState(bBinding, 'deriver-b', scope, roleCredential, plan.b);
    artifact.roleStatesAfterFirstRun = { deriverA: aState, deriverB: bState };
    artifact.admissionsAfterFirstRun = {
      deriverA: await admissions(databases.deriverA, sessionHex),
      deriverB: await admissions(databases.deriverB, sessionHex),
    };
    artifact.connection = evidence;

    if (plan.outcome === 'released') {
      // Deriver B said it holds no claim, before any protocol message.
      assert.equal(first.status, 200, first.text);
      assert.equal(first.body.status, 'recoverable_failure', first.text);
      assert.equal(evidence.connections, 0, 'B admitted no connection');
      assert.equal(evidence.aMessages + evidence.bMessages, 0, 'No protocol message was exchanged');
      assert.equal(evidence.refusals.length, 1);
      assert.equal(evidence.refusals[0].status, 409, 'B refuses with its typed answer');
      assert.ok(['not_prepared', 'expired'].includes(evidence.refusals[0].reason), JSON.stringify(evidence.refusals));
      if (plan.preparation === 'd1-error') {
        assert.ok(preparation.delivered.status >= 400, 'B answered its failed preparation');
        assert.ok(
          first.elapsedMs < leaseMs - 1_000,
          `B refused once its preparation failed, not at the run's end (${first.elapsedMs} ms)`,
        );
        assert.deepEqual(artifact.admissionsAfterFirstRun.deriverB, [], 'A failed preparation admits nothing at B');
      }
      if (plan.preparation === 'never') {
        assert.deepEqual(artifact.admissionsAfterFirstRun.deriverB, [], 'B admitted nothing');
      }
      // The exact retry runs once the Router's claim has lapsed.
      await setTimeout(Math.max(0, leaseMs + 250 - first.elapsedMs));
      let retry;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        retry = await post(routerBinding, executePath, envelope, gatewayCredential);
        if (retry.body?.code !== 'execution_in_progress') break;
        await setTimeout(250);
      }
      assert.equal(retry.status, 200, retry.text);
      assert.equal(retry.body.status, 'succeeded', retry.text);
      await requirePairState(aBinding, 'deriver-a', scope, roleCredential, 'completed');
      await requirePairState(bBinding, 'deriver-b', scope, roleCredential, 'completed');
      const after = await proxyEvidence(proxy);
      assert.equal(after.connectionAttempts, 2, 'The retry opens the one connection of its execution');
      artifact.exactRetry = { status: retry.body.status, elapsedMs: retry.elapsedMs };
      artifact.admissions = {
        deriverA: await settledAdmissions(databases.deriverA, sessionHex),
        deriverB: await settledAdmissions(databases.deriverB, sessionHex),
      };
    } else {
      // The execution identity is spent: nothing runs it again.
      if (plan.connection === 'disconnect') {
        assert.equal(evidence.disconnected, true);
        assert.ok(evidence.aMessages >= 1);
        assert.equal(evidence.bMessages, 2);
      } else {
        assert.equal(evidence.aMessages, 0, 'A sends no protocol message before its own claim');
      }
      if (plan.connection === 'cancel-admission' || plan.connection === 'delete-admission') {
        assert.equal(evidence.admissionCancelledAfterPreparation, true);
      }
      if (plan.preparation === 'after-execution') {
        // B was burned before its preparation arrived, and refused it.
        assert.ok(preparation.delivered.status >= 400, JSON.stringify(preparation.delivered));
        assert.deepEqual(
          artifact.admissionsAfterFirstRun.deriverB,
          [],
          'The refused late preparation admitted nothing',
        );
      }
      const retried = await post(aBinding, '/router-ab/deriver-a/ed25519-yao/execute-pair', request, roleCredential);
      assert.ok(retried.status >= 400, 'A burned pair cannot return successful custody');
      const afterRetry = await proxyEvidence(proxy);
      assert.equal(
        afterRetry.connectionAttempts,
        evidence.connectionAttempts,
        'A burned pair must not restart the protocol',
      );
      await requirePairState(aBinding, 'deriver-a', scope, roleCredential, 'burned');
      await requirePairState(bBinding, 'deriver-b', scope, roleCredential, plan.b);
      artifact.exactRetryDidNotRestartProtocol = true;
    }
  }
  artifact.waitedForPreparation = waited;

  // Another wallet's pair is unaffected.
  const fresh = buildEd25519ExecuteRequest(fixture, 'second_tenant_activation', roots.secondTenantRoot);
  const independent = await post(routerBinding, executePath, fresh, gatewayCredential);
  assert.equal(independent.status, 200, independent.text);
  assert.equal(independent.body.status, 'succeeded', independent.text);
  artifact.independentWalletCompleted = true;

  const output = resolve(root, `.artifacts/yao-peer-disconnect/${scenario}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(artifact, null, 2) + '\n');
  console.log(JSON.stringify(artifact));
} finally {
  await topology.dispose();
}
