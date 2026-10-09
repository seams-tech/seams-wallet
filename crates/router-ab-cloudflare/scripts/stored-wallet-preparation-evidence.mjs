import assert from 'node:assert/strict';

async function call(runtime, env, operation, body) {
  const response = await runtime(
    new Request(
      `https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/${operation}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
  assert.ok(response);
  const text = await response.text();
  assert.equal(response.status, 200, `${operation}: ${text}`);
  return JSON.parse(text);
}

// The same namespaces model a return move. Every generation still gets fresh IDs.
export async function verifyDestinationPreparation({
  runtime,
  env,
  store,
  identity,
  sourceAddresses,
  destinationAddresses,
}) {
  const owner = {
    org_id: identity.orgId,
    project_id: identity.projectId,
    env_id: identity.envId,
    wallet_id: identity.walletId,
  };
  const scope = {
    org_id: identity.orgId,
    project_id: identity.projectId,
    project_environment_id: identity.envId,
    wallet_id: identity.walletId,
  };
  const request = {
    move_id: `wmove_${'m'.repeat(43)}`,
    source_generation: identity.ownershipGeneration,
  };
  const destinationGeneration = identity.ownershipGeneration + 1;
  const router = await call(runtime, env, 'router-transfer', {
    kind: 'prepare',
    chunk_bytes: 4096,
    request: {
      owner,
      ...request,
      request_digest_hex: '12'.repeat(32),
      destination_generation: destinationGeneration,
    },
  });
  assert.equal(router.kind, 'prepared');
  const contexts = {};
  for (const [role, key] of [
    ['deriver-a', 'deriver_a'],
    ['deriver-b', 'deriver_b'],
  ]) {
    const source = await call(runtime, env, `${role}-context`, {
      kind: 'wallet',
      owner,
      ownership_generation: identity.ownershipGeneration,
    });
    const destination = await call(runtime, env, `${role}-context`, {
      kind: 'wallet',
      owner,
      ownership_generation: destinationGeneration,
    });
    assert.equal(source.object_id, sourceAddresses[key]);
    assert.equal(destination.object_id, destinationAddresses[key]);
    assert.notEqual(source.object_id, destination.object_id);
    const command = {
      owner,
      ...request,
      destination_generation: destinationGeneration,
      request_digest_hex: '12'.repeat(32),
      cipher_context_digest_hex: source.digest_hex,
    };
    const prepared = await call(runtime, env, `${role}-prepare`, command);
    assert.equal(prepared.kind, 'prepared');
    assert.deepEqual(await call(runtime, env, `${role}-prepare`, command), prepared);
    contexts[role] = {
      sourceId: source.object_id,
      destinationId: destination.object_id,
      replay: true,
    };
  }
  const prepared = await call(runtime, env, 'ed25519-snapshot', {
    command: 'prepare',
    source: { scope, request },
  });
  assert.equal(prepared.state, 'prepared');
  const ecdsa = await call(runtime, env, 'ecdsa-transfer', {
    kind: 'prepare',
    scope,
    request,
    chunk_bytes: 4096,
  });
  assert.equal(ecdsa.kind, 'prepared');
  const inventory = await call(runtime, env, 'presign-preparation-inventory', {
    scope,
    source_generation: identity.ownershipGeneration,
    cursor: { kind: 'start' },
    limit: 16,
  });
  assert.equal(inventory.sessions.length, 0);
  assert.deepEqual(await store.read(identity), sourceAddresses);
  return {
    routerPrepared: true,
    derivers: contexts,
    bothSigningCurvesPrepared: true,
    sourceAddressesRetained: true,
    pendingPresignInventoryRouted: true,
  };
}
