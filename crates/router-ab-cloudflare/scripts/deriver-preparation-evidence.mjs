import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const path = '/router-ab/internal/deriver-a/wallet/prepare-relocation';
const workerName = 'deriver-a-relocation-destination';
const binding = 'DERIVER_A_WALLET_DO';

async function post(worker, route, body, credential) {
  return worker.fetch(`https://deriver-a.internal${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': credential },
    body: JSON.stringify(body),
  });
}

export async function verifyDeriverPreparation(topology, owner, rootIdentity, preparation, credential) {
  const source = await topology.getWorker('deriver-a');
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
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../../../packages/wallet-server/src/router/cloudflare/runtime/walletRelocationOps.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral',
  });
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
  const runtimeEnvironment = {
    DERIVER_A: new DeriverBinding(destination),
    ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: credential,
  };
  const runtimePath = '/internal/wallet-runtime/v1/relocation/deriver-a-prepare';
  assert.equal(await runtime.handleWalletRelocationRequest(new Request(`https://public.example${runtimePath}`, { method: 'POST' }), runtimeEnvironment), null);
  const response = await runtime.handleWalletRelocationRequest(new Request(`https://wallet-runtime.internal${runtimePath}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command),
  }), runtimeEnvironment);
  assert.equal(response.status, 200, await response.clone().text());
  const receipt = await response.json();
  const objectName = `deriver-a-wallet-${createHash('sha256').update('seams/deriver-a/wallet-do/v1').update(JSON.stringify(owner)).digest('hex')}`;
  assert.deepEqual(receipt, { kind: 'prepared', request: command, destination_object: objectName });
  const namespace = await topology.getDurableObjectNamespace(binding, workerName);
  const id = namespace.idFromName(objectName);
  await topology.unsafeEvictDurableObject(workerName, 'RouterAbDeriverAWalletDurableObject', { id: id.toString() });
  assert.deepEqual(await (await post(destination, path, command, credential)).json(), receipt);
  assert.equal((await post(destination, path, { ...command, request_digest_hex: 'bc'.repeat(32) }, credential)).status, 409);
  const { request, receipt: readiness } = preparation;
  const ordinary = {
    operation: 'prepare', owner, root_identity: rootIdentity,
    record: {
      status: 'prepared', pair_binding: request.pair_binding,
      root_metadata_digest: readiness.root_metadata_digest.bytes,
      expires_at_ms: readiness.expires_at_ms, receipt: readiness,
      payload: { tenant_root: request.tenant_root, work: request.work, input: request.input },
    },
    now_ms: readiness.prepared_at_ms,
  };
  await assert.rejects(
    post(namespace.get(id), '/router-ab/internal/deriver-a/wallet-pair', ordinary, credential),
    /Deriver A destination is reserved/u,
  );
  const read = { operation: 'read', owner, pair_binding: request.pair_binding };
  const empty = await post(namespace.get(id), '/router-ab/internal/deriver-a/wallet-pair', read, credential);
  assert.deepEqual(await empty.json(), { kind: 'missing' });
  assert.deepEqual(await (await post(destination, path, command, credential)).json(), receipt);
  return {
    receipt,
    privateRuntimePreparation: true,
    nonemptySourceRejected: true,
    wrongCredentialRejected: true,
    exactReplayAfterEviction: true,
    changedDigestRejected: true,
    ordinaryPairPreparationRejected: true,
    destinationRemainsEmpty: true,
  };
}

class DeriverBinding {
  constructor(worker) {
    this.worker = worker;
  }

  async fetch(request) {
    return this.worker.fetch(request.url, {
      method: request.method, headers: Object.fromEntries(request.headers),
      body: await request.arrayBuffer(),
    });
  }
}
