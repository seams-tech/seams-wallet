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
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';
import { Log, LogLevel, Miniflare } from 'miniflare';
import { proxySource } from './yao-peer-disconnect-proxy.mjs';
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
  'preparation-evicted-before-socket': { outcome: 'released', preparation: 'evict', connection: 'after-preparation', b: 'missing' },
  'queued-input-relocation': { outcome: 'completed', preparation: 'check-relocation', connection: 'after-preparation' },
  'cancelled-b-before-claim': { outcome: 'burned', preparation: 'cancel-b', connection: 'after-preparation', b: 'prepared' },
  'lost-input-source-fenced': { outcome: 'burned', preparation: 'evict-and-fence', connection: 'after-preparation', b: 'missing' },
  'expired-input-retry': { outcome: 'released', preparation: 'after-execution', expireBeforeRetry: true, b: 'prepared' },
  'preparation-reply-lost': { outcome: 'completed', preparation: 'lose-reply' },
  'preparation-reply-held': { outcome: 'completed', preparation: 'hold-reply' },
  'duplicate-socket': { outcome: 'completed', connection: 'duplicate' },
  'duplicate-router': { outcome: 'completed', duplicateRouter: true, connection: 'after-preparation' },
  'held-protocol-reply': { outcome: 'completed', connection: 'hold-second-reply' },
  'duplicate-execution': { outcome: 'completed', execution: 'duplicate' },
  'preparation-never-arrives': { outcome: 'released', preparation: 'never', b: 'missing' },
  'preparation-fails': { outcome: 'released', preparation: 'd1-error', b: 'missing', leaseMs: 6_000 },
  'late-preparation-after-refusal': { outcome: 'released', preparation: 'after-execution', b: 'prepared' },
  'changed-generation': { outcome: 'burned', connection: 'changed-generation', b: 'burned' },
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
  'deriver_b.begin_pair', 'deriver_b.role_execution',
]);

class SpanLog extends Log {
  spans = [];
  pairWrites = [];

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
      if (event.event === 'pair_record_write') this.pairWrites.push(event);
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
  releasePreparationReply: signal(),
};

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
      const input = await request.clone().json();
      const credential = request.headers.get(authHeader);
      const response = await worker.fetch(request);
      const body = await response.text();
      this.delivered = { forwarded: true, status: response.status, body: body.slice(0, 300) };
      if (plan.preparation === 'evict' || plan.preparation === 'evict-and-fence') {
        const ids = await topology.listDurableObjectIds('RouterAbDeriverBWalletDurableObject', 'deriver-b');
        assert.equal(ids.length, 1, 'Only the prepared wallet exists');
        await topology.unsafeEvictDurableObject('deriver-b', 'RouterAbDeriverBWalletDurableObject', { id: ids[0] });
        this.delivered.evictedAfterReply = true;
      }
      if (plan.preparation === 'check-relocation' || plan.preparation === 'evict-and-fence') {
        const fence = await fencePreparedWallet(worker, input, credential);
        const expected = plan.preparation === 'check-relocation' ? 'pending' : 'settled_fence';
        assert.equal(fence.body.kind, expected, fence.text);
        if (expected === 'pending') assert.equal(fence.body.pending_pairs, 1);
        this.delivered.sourceFence = fence.body.kind;
        if (expected === 'settled_fence') {
          this.delivered.reconciled = await reconcilePreparedWallet(topology, input, false);
          assert.equal(this.delivered.reconciled, 'fenced');
        }
      }
      if (plan.preparation === 'cancel-b') {
        this.delivered.reconciled = await reconcilePreparedWallet(topology, input, true);
        assert.equal(this.delivered.reconciled, 'fenced');
      }
      if (plan.preparation === 'hold-reply') await firstRun.releasePreparationReply.promise;
      if (plan.preparation === 'lose-reply') {
        return new Response('E2E lost preparation reply', { status: 503 });
      }
      return new Response(body, { status: response.status, headers: response.headers });
    } finally {
      firstRun.preparationAnswered.resolve();
    }
  }
}

async function reconcilePreparedWallet(topology, input, cancelAdmission) {
  const session = Buffer.from(input.pair_binding.ceremony.binding.session_id).toString('hex');
  if (cancelAdmission) {
    const database = await topology.getD1Database('DERIVER_ROLE_PRIVATE_DB', 'deriver-b');
    const result = await database.prepare(`UPDATE ${admissionTable} SET status = 'cancelled'
      WHERE attempt_key_hex = ? AND status = 'admitted'`).bind(session).run();
    assert.equal(result.meta.changes, 1);
  }
  const namespace = await topology.getDurableObjectNamespace('DERIVER_B_WALLET_DO', 'deriver-b');
  const object = namespace.get(namespace.idFromString(input.tenant_root.wallet_route.addresses.deriver_b));
  const response = await object.fetch('https://custody.test/router-ab/internal/deriver-b/wallet-pair/reconcile', {
    method: 'POST',
    body: JSON.stringify({ session_hex: session, fence: true, peer_settled: false, now_ms: Date.now() }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function fencePreparedWallet(worker, input, credential) {
  const route = input.tenant_root.wallet_route;
  const context = await post(worker, '/router-ab/internal/deriver-b/wallet/relocation-context',
    { kind: 'cipher' }, credential, route.addresses);
  assert.equal(context.status, 200, context.text);
  const identity = input.tenant_root.identity;
  return post(worker, '/router-ab/internal/deriver-b/wallet/fence-relocation', {
    owner: { org_id: identity.orgId, project_id: identity.projectId, env_id: identity.envId,
      wallet_id: input.pair_binding.ceremony.binding.lifecycle.account_id },
    move_id: `wmove_${'p'.repeat(43)}`,
    request_digest_hex: 'de'.repeat(32),
    cipher_context_digest_hex: context.body.digest_hex,
    source_generation: input.tenant_root.ownership_generation,
    destination_generation: input.tenant_root.ownership_generation + 1,
  }, credential, route.addresses);
}

async function post(worker, path, body, credential, addresses) {
  const startedAt = Date.now();
  const response = await worker.fetch(`https://custody.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [authHeader]: credential,
      'x-seams-wallet-home-region': 'US',
      'x-seams-wallet-object-addresses': JSON.stringify(addresses),
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

async function allocateWalletAddresses(topology) {
  const addresses = {};
  for (const [role, binding, worker] of [
    ['router', 'ROUTER_WALLET_DO', 'router'],
    ['deriver_a', 'DERIVER_A_WALLET_DO', 'deriver-a'],
    ['deriver_b', 'DERIVER_B_WALLET_DO', 'deriver-b'],
    ['signing_worker', 'SIGNING_WORKER_WALLET_DO', 'fixture-signing-worker'],
  ]) {
    const namespace = await topology.getDurableObjectNamespace(binding, worker);
    addresses[role] = namespace.newUniqueId().toString();
  }
  return addresses;
}

async function pairState(worker, role, scope, credential) {
  const result = await post(worker, `/router-ab/${role}/ed25519-yao/read-pair-status`, scope, credential, scope.wallet_route.addresses);
  assert.equal(result.status, 200, result.text);
  return result.body.status;
}

async function requirePairState(worker, role, scope, credential, expectedState) {
  let state;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    state = await pairState(worker, role, scope, credential, scope.wallet_route.addresses);
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
const observedB = deriverBWorker(fixture);
const observedPath = resolve(root, `.artifacts/yao-peer-disconnect/${scenario}-b-observed.mjs`);
await mkdir(dirname(observedPath), { recursive: true });
const observedImport = relative(dirname(observedPath), observedB.scriptPath);
await writeFile(observedPath, `
import { RouterAbDeriverBWalletDurableObject as WalletObject } from ${JSON.stringify(observedImport)};
export * from ${JSON.stringify(observedImport)};
export { default } from ${JSON.stringify(observedImport)};
export class RouterAbDeriverBWalletDurableObject extends WalletObject {
  constructor(state, env) {
    const sql = state.storage.sql;
    const execute = sql.exec.bind(sql);
    sql.exec = (query, ...bindings) => {
      const result = execute(query, ...bindings);
      if (/^(INSERT INTO|UPDATE) yao_pair_sessions\\b/.test(query)) {
        console.log(JSON.stringify({ event: 'pair_record_write', session: bindings[0], lifecycle: bindings[2], rowsWritten: result.rowsWritten }));
      }
      return result;
    };
    super(state, env);
  }
}
`);
observedB.scriptPath = observedPath;
const topology = new Miniflare({
  log,
  handleRuntimeStdio: log.connect.bind(log),
  workers: [
    router,
    a,
    observedB,
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
        PROXY_OBJECT: { className: 'YaoConnectionProxy', useSQLite: true },
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
  const addresses = await allocateWalletAddresses(topology);
  const pending = [];
  for (let index = 0; index < (plan.duplicateRouter ? 2 : 1); index += 1) {
    pending.push(post(routerBinding, executePath, envelope, gatewayCredential, addresses));
  }
  let heldRoleStates = null;
  if (plan.connection === 'hold-second-reply') {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await proxyEvidence(proxy)).heldSecondReply) break;
      await setTimeout(100);
    }
    const held = await proxyEvidence(proxy);
    assert.equal(held.heldSecondReply, true);
    assert.equal(held.bMessages, 2);
    assert.ok(held.aMessages >= 1);
    assert.equal(held.aClosed, false);
    assert.equal(held.bClosed, false);
    const request = execution.request;
    const scope = {
      wallet_route: request.tenant_root.wallet_route,
      ownership_generation: request.tenant_root.ownership_generation,
      root_identity: request.tenant_root.identity,
      pair_binding: request.pair_binding,
    };
    heldRoleStates = {
      deriverA: await requirePairState(aBinding, 'deriver-a', scope, roleCredential, 'running'),
      deriverB: await requirePairState(bBinding, 'deriver-b', scope, roleCredential, 'running'),
    };
    const released = await proxy.fetch('https://proxy.test/release', { method: 'POST' });
    assert.equal(released.status, 200);
  }
  let attempts;
  if (plan.preparation === 'hold-reply') {
    try {
      attempts = await Promise.race([
        Promise.all(pending),
        setTimeout(5_000, undefined, { ref: false }).then(preparationReplyTimeout),
      ]);
      assert.equal(preparation.delivered.status, 200, 'B prepared before its reply was held');
    } finally {
      firstRun.releasePreparationReply.resolve();
    }
  } else {
    attempts = await Promise.all(pending);
  }
  const first = attempts.find(attempt => attempt.body?.status === 'succeeded') ?? attempts[0];
  if (plan.duplicateRouter) {
    assert.equal(attempts.filter(attempt => attempt.body?.status === 'succeeded').length, 1);
    const duplicate = attempts.find(attempt => attempt !== first);
    assert.equal(duplicate.status, 200, duplicate.text);
    assert.equal(duplicate.body.status, 'recoverable_failure', duplicate.text);
    assert.equal(duplicate.body.code, 'execution_in_progress', duplicate.text);
  }
  if (plan.preparation === 'd1-error') {
    await databases.deriverB.exec(`ALTER TABLE ${heldTable} RENAME TO ${admissionTable}`);
  }
  if (plan.preparation === 'cancel-b' || plan.preparation === 'evict-and-fence') {
    assert.equal(preparation.delivered.reconciled, 'fenced', 'The injected fence must complete before the connection');
  }
  assert.ok(execution.request, 'The Router sent Deriver A its execution');
  const request = execution.request;
  const scope = {
    wallet_route: request.tenant_root.wallet_route,
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
    concurrentRouterStatuses: attempts.map(attempt => attempt.status),
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
    const completedConnections = evidence.connectionAttempts;
    if (scenario === 'preparation-before-socket' || plan.preparation === 'hold-reply') {
      await topology.unsafeEvictDurableObject('router', 'RouterAbRouterWalletDurableObject', { id: addresses.router });
    }
    const replay = await post(routerBinding, executePath, envelope, gatewayCredential, addresses);
    assert.equal(replay.status, 200, replay.text);
    assert.deepEqual(replay.body, first.body, 'Router restart must replay the durable result');
    assert.equal((await proxyEvidence(proxy)).connectionAttempts, completedConnections);
    artifact.completedReplayAfterRouterEviction = scenario === 'preparation-before-socket' || plan.preparation === 'hold-reply';
    artifact.completedWhilePreparationReplyHeld = plan.preparation === 'hold-reply';
    artifact.completedReplayRanNoProtocol = true;
    artifact.duplicateExecution = execution.duplicate;
    artifact.admissions = {
      deriverA: await settledAdmissions(databases.deriverA, sessionHex),
      deriverB: await settledAdmissions(databases.deriverB, sessionHex),
    };
    artifact.connection = evidence;
    artifact.pairRecordWrites = log.pairWrites.filter(event => event.session === sessionHex && event.rowsWritten > 0);
    assert.deepEqual(artifact.pairRecordWrites.map(event => event.lifecycle), ['running', 'completed'],
      'B must combine the encrypted input with its durable running claim');
    if (plan.connection === 'hold-second-reply') {
      assert.equal(evidence.releasedSecondReply, true);
      artifact.heldRoleStates = heldRoleStates;
    }
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
    artifact.pairRecordWrites = log.pairWrites.filter(event => event.session === sessionHex && event.rowsWritten > 0);
    artifact.roleSpans = log.spans;
    if (plan.preparation === 'cancel-b') {
      assert.equal(evidence.connections, 0, 'The cancelled B claim must refuse the upgrade');
      assert.equal(evidence.aMessages + evidence.bMessages, 0, 'The cancelled B claim must send no protocol material');
      assert.equal(artifact.pairRecordWrites.some(write => write.lifecycle === 'running'), false);
    }
    await writeFile(resolve(root, `.artifacts/yao-peer-disconnect/${scenario}-observed.json`),
      JSON.stringify(artifact, null, 2) + '\n');

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
      if (plan.expireBeforeRetry) {
        await setTimeout(60_100);
        await requirePairState(bBinding, 'deriver-b', scope, roleCredential, 'missing');
        artifact.expiredUnusedInputDiscarded = true;
      }
      // The exact retry runs once the Router's claim has lapsed.
      await setTimeout(Math.max(0, leaseMs + 250 - first.elapsedMs));
      let retry;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        retry = await post(routerBinding, executePath, envelope, gatewayCredential, addresses);
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
      const retried = await post(aBinding, '/router-ab/deriver-a/ed25519-yao/execute-pair', request, roleCredential, addresses);
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
  const freshAddresses = await allocateWalletAddresses(topology);
  const independent = await post(routerBinding, executePath, fresh, gatewayCredential, freshAddresses);
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

function preparationReplyTimeout() {
  throw new Error('Router waited for the held preparation reply after A could complete');
}
