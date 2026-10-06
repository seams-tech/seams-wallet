import { sourceEnvelope } from './runtime-relocation-evidence.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const roles = {
  a: { label: 'Deriver A', binding: 'DERIVER_A_WALLET_DO', className: 'RouterAbDeriverAWalletDurableObject' },
  b: { label: 'Deriver B', binding: 'DERIVER_B_WALLET_DO', className: 'RouterAbDeriverBWalletDurableObject' },
};

async function post(worker, route, body, credential) {
  return worker.fetch(`https://deriver.internal${route}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': credential,
    },
    body: JSON.stringify(body),
  });
}

async function loadRuntime() {
  const entry = new URL('../../../packages/wallet-server/src/router/cloudflare/runtime/walletRelocationOps.ts', import.meta.url);
  const bundled = await build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
}

async function reserveDestination(topology, role, owner, credential, runtime) {
  const workerName = `deriver-${role}-relocation-destination`;
  const path = `/router-ab/internal/deriver-${role}/wallet/prepare-relocation`;
  const source = await topology.getWorker(`deriver-${role}`);
  const destination = await topology.getWorker(workerName);
  const sourceEnvironment = {
    DERIVER_A: new DeriverBinding(await topology.getWorker('deriver-a')),
    DERIVER_B: new DeriverBinding(await topology.getWorker('deriver-b')),
    ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: credential,
  };
  const contextPath = `/internal/wallet-runtime/v1/relocation/deriver-${role}-context`;
  const contextResponse = await runtime.handleWalletRelocationRequest(
    new Request(`https://wallet-runtime.internal${contextPath}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }), sourceEnvironment,
  );
  assert.equal(contextResponse.status, 200, await contextResponse.clone().text());
  const context = await contextResponse.json();
  assert.equal(context.kind, 'deriver_cipher_context');
  assert.match(context.digest_hex, /^[a-f0-9]{64}$/u);
  const directContextPath = `/router-ab/internal/deriver-${role}/wallet/relocation-context`;
  assert.deepEqual(await (await post(source, directContextPath, {}, credential)).json(), context);
  const command = {
    owner,
    move_id: `wmove_${'d'.repeat(43)}`,
    request_digest_hex: 'ad'.repeat(32),
    cipher_context_digest_hex: context.digest_hex,
    source_generation: 1,
    destination_generation: 2,
  };
  assert.notEqual((await post(destination, path, command, 'wrong-credential')).status, 200);
  assert.equal((await post(source, path, command, credential)).status, 409);
  const otherRole = role === 'a' ? 'b' : 'a';
  const otherSource = await topology.getWorker(`deriver-${otherRole}`);
  const otherRoleContext = await (await post(otherSource,
    `/router-ab/internal/deriver-${otherRole}/wallet/relocation-context`, {}, credential)).json();
  assert.notEqual(otherRoleContext.digest_hex, context.digest_hex);
  const wrongContext = { ...command, cipher_context_digest_hex: otherRoleContext.digest_hex };
  assert.equal((await post(destination, path, wrongContext, credential)).status, 409);
  if (role === 'a') {
    const wrongKey = await topology.getWorker('deriver-a-relocation-wrong-key');
    const wrongKeyResponse = await post(wrongKey, directContextPath, {}, credential);
    assert.equal(wrongKeyResponse.status, 500);
    const wrongEnvironment = await topology.getWorker('deriver-a-relocation-wrong-environment');
    const otherContext = await (await post(wrongEnvironment, directContextPath, {}, credential)).json();
    assert.notEqual(otherContext.digest_hex, context.digest_hex);
    assert.equal((await post(wrongEnvironment, path, command, credential)).status, 409);
  }
  const runtimeEnvironment = {
    DERIVER_A: new DeriverBinding(await topology.getWorker('deriver-a-relocation-destination')),
    DERIVER_B: new DeriverBinding(await topology.getWorker('deriver-b-relocation-destination')),
    ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: credential,
  };
  const runtimePath = `/internal/wallet-runtime/v1/relocation/deriver-${role}-prepare`;
  const publicRequest = new Request(`https://public.example${runtimePath}`, { method: 'POST' });
  assert.equal(await runtime.handleWalletRelocationRequest(publicRequest, runtimeEnvironment), null);
  const response = await runtime.handleWalletRelocationRequest(
    new Request(`https://wallet-runtime.internal${runtimePath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    }),
    runtimeEnvironment,
  );
  assert.equal(response.status, 200, await response.clone().text());
  const receipt = await response.json();
  const digest = createHash('sha256')
    .update(`seams/deriver-${role}/wallet-do/v1`)
    .update(JSON.stringify(owner))
    .digest('hex');
  const objectName = `deriver-${role}-wallet-${digest}`;
  assert.deepEqual(receipt, { kind: 'prepared', request: command, destination_object: objectName });
  const namespace = await topology.getDurableObjectNamespace(roles[role].binding, workerName);
  const id = namespace.idFromName(objectName);
  await topology.unsafeEvictDurableObject(workerName, roles[role].className, { id: id.toString() });
  assert.deepEqual(await (await post(destination, path, command, credential)).json(), receipt);
  const changed = { ...command, request_digest_hex: 'bc'.repeat(32) };
  assert.equal((await post(destination, path, changed, credential)).status, 409);
  return { object: namespace.get(id), destination, path, command, receipt };
}

export async function verifyDeriverPreparation(topology, owner, rootIdentity, preparation, credential) {
  const runtime = await loadRuntime();
  const a = await reserveDestination(topology, 'a', owner, credential, runtime);
  const { request, receipt: readiness } = preparation;
  const ordinary = preparedCommand(owner, rootIdentity, preparation);
  await assert.rejects(
    post(a.object, '/router-ab/internal/deriver-a/wallet-pair', ordinary, credential),
    /Deriver A destination is reserved/u,
  );
  const read = { operation: 'read', owner, pair_binding: request.pair_binding };
  const empty = await post(a.object, '/router-ab/internal/deriver-a/wallet-pair', read, credential);
  assert.deepEqual(await empty.json(), { kind: 'missing' });
  const b = await reserveDestination(topology, 'b', owner, credential, runtime);
  const scope = { root_identity: rootIdentity, pair_binding: request.pair_binding };
  const session = request.pair_binding.ceremony.binding.session_id;
  const pairDigest = request.pair_binding.pair_digest.bytes;
  await assert.rejects(
    post(b.object, '/router-ab/internal/deriver-b/wallet-pair', {
      scope,
      command: { command: 'fail_pair', session, pair_digest: pairDigest },
    }, credential),
    /Deriver B destination is reserved/u,
  );
  await assert.rejects(
    post(b.object, '/router-ab/internal/deriver-b/wallet-pair/reconcile', {
      session_hex: Buffer.from(session).toString('hex'),
      now_ms: Date.now(),
      fence: true,
    }, credential),
    /Deriver B destination is reserved/u,
  );
  const bEmpty = await post(b.object, '/router-ab/internal/deriver-b/wallet-pair', {
    scope,
    command: { command: 'read_pair_status', session, pair_digest: pairDigest },
  }, credential);
  assert.equal(bEmpty.status, 200, await bEmpty.clone().text());
  assert.deepEqual(await bEmpty.json(), { result: 'pair_missing', session, pair_digest: pairDigest });
  for (const reserved of [a, b]) {
    assert.deepEqual(
      await (await post(reserved.destination, reserved.path, reserved.command, credential)).json(),
      reserved.receipt,
    );
  }
  return {
    deriverA: a.receipt,
    deriverB: b.receipt,
    privateRuntimePreparation: true,
    cipherContextsCheckedBeforeReservation: true,
    mismatchedPrivateKeyRejected: true,
    changedEncryptionEnvironmentRejected: true,
    nonemptySourcesRejected: true,
    wrongCredentialsRejected: true,
    exactReplayAfterEviction: true,
    changedDigestsRejected: true,
    ordinaryPairWritesRejected: true,
    reconciliationWriteRejected: true,
    destinationsRemainEmpty: true,
  };
}

class DeriverBinding {
  constructor(worker) {
    this.worker = worker;
    this.fenceCalls = 0;
  }

  async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/fence-relocation')) this.fenceCalls += 1;
    return this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.arrayBuffer(),
    });
  }
}

export async function verifyDeriverSourceFences(topology, owner, rootIdentity, preparation, credential) {
  const runtime = await loadRuntime();
  const liveWorkerName = 'deriver-a-relocation-wrong-environment';
  const liveWorker = await topology.getWorker(liveWorkerName);
  const liveNamespace = await topology.getDurableObjectNamespace(roles.a.binding, liveWorkerName);
  const digest = createHash('sha256').update('seams/deriver-a/wallet-do/v1').update(JSON.stringify(owner)).digest('hex');
  const liveObject = liveNamespace.get(liveNamespace.idFromName(`deriver-a-wallet-${digest}`));
  const pairPath = '/router-ab/internal/deriver-a/wallet-pair';
  const prepare = await post(liveObject, pairPath, preparedCommand(owner, rootIdentity, preparation), credential);
  assert.equal(prepare.status, 200, await prepare.clone().text());
  const read = { operation: 'read', owner, pair_binding: preparation.request.pair_binding };
  assert.equal((await (await post(liveObject, pairPath, read, credential)).json()).record.status, 'prepared');
  const context = await (await post(liveWorker, '/router-ab/internal/deriver-a/wallet/relocation-context', {}, credential)).json();
  const liveCommand = { owner, move_id: `wmove_${'p'.repeat(43)}`, request_digest_hex: 'de'.repeat(32),
    cipher_context_digest_hex: context.digest_hex, source_generation: 1, destination_generation: 2 };
  const livePath = '/router-ab/internal/deriver-a/wallet/fence-relocation';
  assert.deepEqual(await (await post(liveWorker, livePath, liveCommand, credential)).json(), { kind: 'pending', pending_pairs: 1 });
  const expired = await post(liveObject, pairPath, { operation: 'expire', owner,
    pair_binding: preparation.request.pair_binding, now_ms: preparation.receipt.expires_at_ms + 1 }, credential);
  assert.equal(expired.status, 200, await expired.clone().text());
  assert.equal((await (await post(liveObject, pairPath, read, credential)).json()).record.status, 'expired');
  assert.equal((await (await post(liveWorker, livePath, liveCommand, credential)).json()).kind, 'settled_fence');
  const receipts = [];
  for (const role of ['a', 'b']) {
    const workerName = `deriver-${role}`;
    const source = await topology.getWorker(workerName);
    const contextResponse = await post(source, `/router-ab/internal/deriver-${role}/wallet/relocation-context`, {}, credential);
    const context = await contextResponse.json();
    const command = {
      owner, move_id: `wmove_${'f'.repeat(43)}`, request_digest_hex: 'ab'.repeat(32),
      cipher_context_digest_hex: context.digest_hex, source_generation: 1, destination_generation: 2,
    };
    const path = `/router-ab/internal/deriver-${role}/wallet/fence-relocation`;
    const envelope = sourceEnvelope({
      scope: { org_id: owner.org_id, project_id: owner.project_id,
        project_environment_id: owner.env_id, wallet_id: owner.wallet_id },
      request: { move_id: command.move_id, invalidated_at_ms: Date.now() },
    });
    const directory = new DeriverFenceDirectory(envelope, role, command);
    const binding = new DeriverBinding(source);
    const env = {
      WALLET_CONSOLE: directory, DERIVER_A: binding, DERIVER_B: binding,
      CF_VERSION_METADATA: { id: '11111111-1111-4111-8111-111111111111' },
      SEAMS_D1_HOME_ACCOUNT_ID: 'a'.repeat(32),
      SEAMS_D1_HOME_DATABASE_ID: '22222222-2222-4222-8222-222222222222',
      ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: credential,
    };
    const runtimeUrl = `https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/deriver-${role}-fence`;
    directory.mode = 'denied';
    assert.equal((await runtime.handleWalletRelocationRequest(runtimeRequest(runtimeUrl, envelope), env)).status, 409);
    directory.mode = 'corrupt';
    assert.equal((await runtime.handleWalletRelocationRequest(runtimeRequest(runtimeUrl, envelope), env)).status, 503);
    assert.equal(binding.fenceCalls, 0);
    directory.mode = 'accepted';
    assert.equal((await runtime.handleWalletRelocationRequest(runtimeRequest(runtimeUrl, command), env)).status, 400);
    const response = await runtime.handleWalletRelocationRequest(runtimeRequest(runtimeUrl, envelope), env);

    assert.equal(response.status, 200, await response.clone().text());
    const receipt = await response.json();
    assert.equal(receipt.kind, 'settled_fence');
    assert.deepEqual(receipt.request, command);
    const namespace = await topology.getDurableObjectNamespace(roles[role].binding, workerName);
    const id = namespace.idFromName(receipt.source_object);
    await topology.unsafeEvictDurableObject(workerName, roles[role].className, { id: id.toString() });
    assert.deepEqual(await (await runtime.handleWalletRelocationRequest(runtimeRequest(runtimeUrl, envelope), env)).json(), receipt);
    assert.equal((await post(source, path, { ...command, request_digest_hex: 'cd'.repeat(32) }, credential)).status, 409);
    const object = namespace.get(id);
    const pair = preparation.request.pair_binding;
    const mutation = role === 'a'
      ? { operation: 'expire', owner, pair_binding: pair, now_ms: preparation.receipt.expires_at_ms + 1 }
      : { scope: { root_identity: rootIdentity, pair_binding: pair }, command: {
        command: 'fail_pair', session: pair.ceremony.binding.session_id, pair_digest: pair.pair_digest.bytes,
      } };
    await assert.rejects(post(object, `/router-ab/internal/deriver-${role}/wallet-pair`, mutation, credential),
      new RegExp(`${roles[role].label} source is frozen`, 'u'));
    receipts.push(receipt);
  }
  return { scope: 'Terminal pair stores only; tenant-root obligations and snapshot transfer are not covered',
    receipts, livePairsDeferFence: true, settlementRemainsOpenUntilFence: true,
    runtimeRequiresDirectoryAuthorization: true, deniedOrCorruptCommandsDoNotReachFence: true,
    exactReplayAfterEviction: true, conflictingMoveRejected: true, ordinaryMutationRejected: true };
}

function preparedCommand(owner, rootIdentity, preparation) {
  const { request, receipt: readiness } = preparation;
  return {
    operation: 'prepare',
    owner,
    root_identity: rootIdentity,
    record: {
      status: 'prepared',
      pair_binding: request.pair_binding,
      root_metadata_digest: readiness.root_metadata_digest.bytes,
      expires_at_ms: readiness.expires_at_ms,
      receipt: readiness,
      payload: { tenant_root: request.tenant_root, work: request.work, input: request.input },
    },
    now_ms: readiness.prepared_at_ms,
  };
}

function runtimeRequest(url, body) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

class DeriverFenceDirectory {
  constructor(envelope, role, command) {
    this.envelope = envelope;
    this.role = role;
    this.command = command;
    this.mode = 'accepted';
  }

  async fetch(request) {
    assert.equal(request.url, 'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-deriver-source');
    assert.equal(request.headers.get('x-seams-writer-role'), 'walletRuntime');
    assert.equal(request.headers.get('x-seams-writer-version'), '11111111-1111-4111-8111-111111111111');
    assert.equal(request.headers.get('x-seams-writer-account'), 'a'.repeat(32));
    assert.equal(request.headers.get('x-seams-writer-database'), '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(await request.json(), { wallet: this.envelope.wallet, attempt: this.envelope.attempt,
      role: this.role === 'a' ? 'deriverA' : 'deriverB', cipherContextDigest: this.command.cipher_context_digest_hex });
    if (this.mode === 'denied') return Response.json({ ok: false }, { status: 403 });
    const command = structuredClone(this.command);
    if (this.mode === 'corrupt') command.owner.wallet_id = 'another-wallet';
    return Response.json({ ok: true, command });
  }
}
