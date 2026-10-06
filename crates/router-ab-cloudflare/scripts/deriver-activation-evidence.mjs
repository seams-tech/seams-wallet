import assert from 'node:assert/strict';

async function post(worker, path, body, credential) {
  return worker.fetch(`https://deriver.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': credential },
    body: JSON.stringify(body),
  });
}

async function accepted(worker, path, body, credential) {
  const response = await post(worker, path, body, credential);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

export async function verifyDeriverActivation(topology, role, receipt, segment, acknowledgement, credential, transport) {
  const workerName = `deriver-${role}-relocation-destination`;
  const destination = await topology.getWorker(workerName);
  const namespaceName = `DERIVER_${role.toUpperCase()}_WALLET_DO`;
  const destinationNamespace = await topology.getDurableObjectNamespace(namespaceName, workerName);
  const destinationObject = destinationNamespace.get(destinationNamespace.idFromName(receipt.source_object));
  const sourceNamespace = await topology.getDurableObjectNamespace(namespaceName, `deriver-${role}`);
  const sourceId = sourceNamespace.idFromName(receipt.source_object);
  const sourceObject = sourceNamespace.get(sourceId);
  const path = `/router-ab/internal/deriver-${role}/wallet/snapshot`;
  const reconcilePath = `/router-ab/internal/deriver-${role}/wallet-pair/reconcile`;
  const mutation = { session_hex: '11'.repeat(32), now_ms: Date.now(), fence: true, peer_settled: true };
  transport.directory.beginActivation();
  assert.equal((await post(transport.source, path, { operation: 'cleanup' }, credential)).status, 409);
  assert.equal((await post(transport.destination, path, { operation: 'activate', receipt }, credential)).status, 503);
  const activated = await accepted(transport.destination, path, { operation: 'activate', receipt }, credential);
  assert.deepEqual(activated, { kind: 'activated', receipt: { source: receipt, destination_object: receipt.source_object } });
  await accepted(destinationObject, reconcilePath, mutation, credential);
  await accepted(destination, `/router-ab/internal/deriver-${role}/wallet/prepare-relocation`, receipt.source, credential);
  await accepted(destinationObject, reconcilePath, { ...mutation, session_hex: '22'.repeat(32) }, credential);
  assert.deepEqual(await accepted(destination, path, { operation: 'import', receipt, segment }, credential), acknowledgement);
  assert.deepEqual(await accepted(destination, path, { operation: 'verify', receipt }, credential), { kind: 'verified', receipt });
  assert.equal((await accepted(destination, path, { operation: 'status', receipt }, credential)).kind, 'activated');
  await assert.rejects(post(sourceObject, reconcilePath, mutation, credential), /frozen/u);
  const cleanup = { operation: 'cleanup', activation: activated.receipt };
  let result = await accepted(transport.source, path, cleanup, credential);
  assert.equal(result.kind, 'cleaning');
  await topology.unsafeEvictDurableObject(`deriver-${role}`, `RouterAbDeriver${role.toUpperCase()}WalletDurableObject`, { id: sourceId.toString() });
  let commands = 1;
  while (result.kind === 'cleaning' && commands < 1000) {
    result = await accepted(transport.source, path, cleanup, credential);
    commands += 1;
  }
  assert.equal(result.kind, 'cleaned');
  assert.deepEqual(await accepted(transport.source, path, cleanup, credential), result);
  await assert.rejects(post(sourceObject, reconcilePath, mutation, credential), /frozen/u);
  await accepted(destinationObject, reconcilePath, { ...mutation, session_hex: '33'.repeat(32) }, credential);
  return { receipt: activated.receipt, cleanupCommands: commands, lostActivationReplyRecovered: true,
    preparationReplayPreservesActivation: true, lateImportPreservesActivation: true,
    cleanupResumesAfterEviction: true, sourceRemainsFenced: true, destinationWritableAfterCleanup: true };
}
