import assert from 'node:assert/strict';

async function roleEpochs(database, ceremony) {
  const rows = await database.prepare(
    `SELECT tenant_root_share_epoch AS epoch, lifecycle, revision
     FROM tenant_root_role_shares WHERE custody_lineage_b64u = ?
     ORDER BY tenant_root_share_epoch`,
  ).bind(ceremony.custody_lineage_b64u).all();
  return rows.results;
}

// Exercise the Rust transaction driver through the real refresh route.
// The pending share is written before the replay checkpoint. Suppressing
// that checkpoint simulates a zero-row CAS and must undo the pending share.
export async function verifyRoleTransactionRollback(database, ceremony, refresh) {
  const before = await roleEpochs(database, ceremony);
  assert.equal(before.length, 1);
  assert.equal(before[0].lifecycle, 'active');
  await database.prepare(
    `CREATE TRIGGER harness_skip_refresh_checkpoint
     BEFORE UPDATE ON tenant_root_command_replays
     WHEN NEW.status = 'executed'
     BEGIN SELECT RAISE(IGNORE); END`,
  ).run();
  let failed;
  try {
    failed = await refresh(ceremony, 'harness-transaction-rollback');
    assert.notEqual(failed.status, 200, failed.body);
    assert.match(failed.body, /tenant_root_command_cas_guard/, failed.body);
    assert.deepEqual(
      await roleEpochs(database, ceremony),
      before,
      'a missed checkpoint must roll back the earlier pending-share insert',
    );
    const replay = await database.prepare(
      `SELECT status, executed_at_ms FROM tenant_root_command_replays
       WHERE custody_lineage_b64u = ? AND refresh_state_b64u IS NOT NULL`,
    ).bind(ceremony.custody_lineage_b64u).all();
    assert.equal(replay.results.length, 1, 'refresh must reach its reserved replay');
    assert.equal(replay.results[0].status, 'reserved');
    assert.equal(replay.results[0].executed_at_ms, null);
  } finally {
    await database.prepare('DROP TRIGGER harness_skip_refresh_checkpoint').run();
  }
  const retried = await refresh(ceremony, 'harness-transaction-rollback');
  assert.equal(retried.status, 200, retried.body);
  const epochs = await roleEpochs(database, ceremony);
  assert.equal(epochs.length, 2);
  assert.equal(epochs[0].epoch, 1);
  assert.equal(epochs[0].lifecycle, 'retired');
  assert.equal(epochs[1].epoch, 2);
  assert.equal(epochs[1].lifecycle, 'active');
  const replayed = await refresh(ceremony, 'harness-transaction-rollback');
  assert.equal(replayed.status, 200, replayed.body);
  assert.equal(
    JSON.parse(replayed.body).activation_receipt_digest_b64u,
    JSON.parse(retried.body).activation_receipt_digest_b64u,
  );
  return {
    fault: 'zero_row_replay_checkpoint_after_pending_share_insert',
    failedStatus: failed.status,
    earlierMutationRolledBack: true,
    checkpointRemainedReserved: true,
    retryStatus: retried.status,
    operationReplayStatus: replayed.status,
    activationReceiptUnchangedOnReplay: true,
    epochsAfterRetry: epochs,
  };
}
