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
  const command = {
    owner,
    move_id: `wmove_${'d'.repeat(43)}`,
    request_digest_hex: 'ad'.repeat(32),
    source_generation: 1,
    destination_generation: 2,
  };
  assert.notEqual((await post(destination, path, command, 'wrong-credential')).status, 200);
  assert.equal((await post(source, path, command, credential)).status, 409);
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
  const ordinary = {
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
  }

  async fetch(request) {
    return this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.arrayBuffer(),
    });
  }
}
