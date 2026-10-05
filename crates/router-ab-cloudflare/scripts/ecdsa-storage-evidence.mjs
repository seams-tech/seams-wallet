import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const verifiedOperations = new Set();
const evidence = [];

async function readStorage(database) {
  const claims = await database.prepare('SELECT COUNT(*) AS count FROM signing_worker_effect_claims').first();
  const pool = await database.prepare('SELECT record_key, record_json, version FROM signing_worker_ecdsa_pool ORDER BY record_key').all();
  const terminals = await database.prepare('SELECT COUNT(*) AS count FROM signing_worker_terminal_responses').first();
  return { claims: claims.count, pool: pool.results, terminals: terminals.count };
}

async function readResponse(response) {
  return { status: response.status, body: await response.text() };
}

function sumVersions(total, row) {
  return total + row.version;
}

export async function dispatchEcdsaSigningWithStorageFaults(request, worker, miniflare) {
  if (!process.argv.includes('--ecdsa-presign-handoff') || process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled') {
    return worker.fetch(request);
  }
  const admitted = await request.clone().json();
  const operationId = admitted.request.operation_id;
  if (verifiedOperations.has(operationId)) return worker.fetch(request);
  verifiedOperations.add(operationId);
  const database = await miniflare.getD1Database('SIGNING_WORKER_PRIVATE_DB', 'fixture-signing-worker');
  const before = await readStorage(database);
  const activation = admitted.request.scope.material_activation;
  const activeKey = `active-signing-worker/${activation.material_owner}/${activation.activation_id}/${activation.signing_worker}`;
  const active = await database.prepare('SELECT active_key FROM signing_worker_activations WHERE active_key = ?1').bind(activeKey).first();
  assert.ok(active, 'The signing activation must exist');
  await database.prepare('INSERT INTO signing_worker_activation_revocation_fences (active_key) VALUES (?1)').bind(activeKey).run();
  try {
    const retired = await worker.fetch(request.clone());
    assert.equal(retired.ok, false, 'A retired activation must refuse fresh signing');
    assert.match(await retired.text(), /SigningWorker activation is retired/);
    assert.deepEqual(await readStorage(database), before, 'Retirement must fail before a claim or consumption');
  } finally {
    await database.prepare('DELETE FROM signing_worker_activation_revocation_fences WHERE active_key = ?1').bind(activeKey).run();
  }
  await database.exec("CREATE TRIGGER fail_ecdsa_consume BEFORE UPDATE ON signing_worker_ecdsa_pool BEGIN SELECT RAISE(ABORT, 'simulated consumption write failure'); END");
  try {
    const failed = await worker.fetch(request.clone());
    assert.equal(failed.ok, false, 'Consumption failure must refuse a signature');
    assert.match(await failed.text(), /simulated consumption write failure/);
    assert.deepEqual(await readStorage(database), before, 'Failed consumption must roll back its claim and retain the reservation');
  } finally {
    await database.exec('DROP TRIGGER fail_ecdsa_consume');
  }
  const attempts = await Promise.all([
    worker.fetch(request.clone()), worker.fetch(request.clone()), worker.fetch(request.clone()),
  ]);
  const outcomes = await Promise.all(attempts.map(readResponse));
  let signed;
  for (const outcome of outcomes) {
    if (outcome.status === 200) {
      const response = JSON.parse(outcome.body);
      if (signed) assert.deepEqual(response, signed, 'Concurrent success must return the first durable signature');
      signed = response;
    } else {
      assert.equal(outcome.status, 409, outcome.body);
      assert.match(outcome.body, /already in progress/);
    }
  }
  assert.ok(signed, 'One concurrent finalize must complete');
  const after = await readStorage(database);
  assert.equal(after.claims, before.claims + 1, 'One effect claim must commit');
  assert.equal(after.terminals, before.terminals + 1, 'One terminal must commit');
  assert.equal(after.pool.length, before.pool.length);
  assert.equal(after.pool.reduce(sumVersions, 0), before.pool.reduce(sumVersions, 0) + 1, 'The reservation must be consumed once');
  const replay = await worker.fetch(request.clone());
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.clone().json(), signed, 'A lost reply must replay the durable signature');
  assert.deepEqual(await readStorage(database), after, 'Replay must leave storage unchanged');
  await database.prepare('INSERT INTO signing_worker_activation_revocation_fences (active_key) VALUES (?1)').bind(activeKey).run();
  try {
    const retiredReplay = await worker.fetch(request.clone());
    assert.equal(retiredReplay.status, 200);
    assert.deepEqual(await retiredReplay.json(), signed, 'Retirement must preserve an exact committed replay');
  } finally {
    await database.prepare('DELETE FROM signing_worker_activation_revocation_fences WHERE active_key = ?1').bind(activeKey).run();
  }
  evidence.push({
    retirementBeforeConsumption: true,
    committedReplayAfterRetirement: true,
    rollbackAfterConsumptionFailure: true,
    concurrentRequests: outcomes.length,
    oneClaimOneConsumptionOneTerminal: true,
    exactReplayWithoutWrites: true,
    signatureSha256: createHash('sha256').update(signed.signature65_b64u).digest('hex'),
  });
  const directory = new URL('../../../.artifacts/mpc-custody-20261005/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('ecdsa-storage-evidence.json', directory), `${JSON.stringify({
    reproduce: 'ROUTER_AB_WORKER_BUILD_PROFILE=dev node crates/router-ab-cloudflare/scripts/test-private-d1.mjs --ecdsa-presign-handoff',
    operations: evidence,
  }, null, 2)}\n`);
  return replay;
}
