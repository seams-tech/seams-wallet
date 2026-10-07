import assert from 'node:assert/strict';

const policy = { limit: 2, windowMs: 600_000 };

function limiter(api, database, scope) {
  return new api.CloudflareD1EmailOtpRateLimitStore({
    prepare: api.prepareD1TenantStatement.bind(null, database, scope),
    rateLimits: {
      challenge: policy,
      verify: policy,
      grant: policy,
      googleRegistrationAttempt: policy,
    },
  });
}

function walletRequest(walletId) {
  return { kind: 'wallet', scope: 'challenge', action: 'relocation-counter', walletId };
}

export async function seedWalletOtpCounters(api, source, scope, walletId) {
  const store = limiter(api, source, scope);
  const input = walletRequest(walletId);
  assert.equal((await store.consume(input)).ok, true);
  assert.equal((await store.consume(input)).ok, true);
  assert.equal((await store.consume(input)).code, 'rate_limited');
  assert.equal((await store.consume(walletRequest('neighbor-wallet'))).ok, true);
  assert.equal(
    (await store.consume({ kind: 'regional', scope: 'challenge', action: 'regional-only', clientIp: '192.0.2.8' }))
      .ok,
    true,
  );
  assert.equal(
    (await store.consume({ kind: 'wallet', scope: 'challenge', action: 'expired-counter', walletId })).ok,
    true,
  );
  await api
    .prepareD1TenantStatement(
      source,
      scope,
      `UPDATE wallet_email_otp_rate_limits SET updated_at_ms = 1, reset_at_ms = 2
     WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
       AND wallet_id = ?5 AND rate_key LIKE '%action=expired-counter:%'`,
      [walletId],
    )
    .run();
  return await readCounters(api, source, scope, walletId);
}

async function readCounters(api, database, scope, walletId) {
  return (
    await api
      .prepareD1TenantStatement(
        database,
        scope,
        `SELECT rate_key, consumed_count, reset_at_ms, updated_at_ms FROM wallet_email_otp_rate_limits
     WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
       AND wallet_id = ?5 ORDER BY rate_key`,
        [walletId],
      )
      .all()
  ).results;
}

export async function verifyInactiveWalletOtp(api, source, destination, scope, walletId, before) {
  assert.deepEqual(await readCounters(api, destination, scope, walletId), before.filter(unexpired));
  await assert.rejects(
    limiter(api, source, scope).consume(walletRequest(walletId)),
    /wallet_authorization_history_frozen/,
  );
  await assert.rejects(
    limiter(api, destination, scope).consume(walletRequest(walletId)),
    /wallet_authorization_destination_inactive/,
  );
  assert.equal(
    (await limiter(api, source, scope).consume(walletRequest('neighbor-wallet'))).ok,
    true,
  );
  const regionalCount = await destination
    .prepare('SELECT COUNT(*) AS count FROM email_otp_rate_limits')
    .first('count');
  assert.equal(regionalCount, 0, 'Regional spam counters must not transfer with a wallet');
}

function unexpired(row) {
  return row.reset_at_ms > 2;
}

export async function verifyActivatedWalletOtp(api, source, destination, scope, walletId, before) {
  const store = limiter(api, destination, scope);
  assert.equal((await store.consume(walletRequest(walletId))).code, 'rate_limited');
  assert.deepEqual(await readCounters(api, destination, scope, walletId), before.filter(unexpired));
  // Expiry allows a fresh local window after activation.
  await api
    .prepareD1TenantStatement(
      destination,
      scope,
      `UPDATE wallet_email_otp_rate_limits SET updated_at_ms = 1, reset_at_ms = 2
     WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5`,
      [walletId],
    )
    .run();
  assert.equal((await store.consume(walletRequest(walletId))).ok, true);
  await assert.rejects(
    limiter(api, source, scope).consume(walletRequest(walletId)),
    /wallet_authorization_history_frozen/,
  );
}

export async function verifyCleanedWalletOtp(api, source, scope, walletId) {
  assert.deepEqual(await readCounters(api, source, scope, walletId), []);
  assert.equal((await readCounters(api, source, scope, 'neighbor-wallet')).length, 1);
  assert.ok(
    (await source.prepare('SELECT COUNT(*) AS count FROM email_otp_rate_limits').first('count')) >
      0,
  );
  return {
    exhaustedAllowancePreserved: true,
    expiryPreserved: true,
    expiredRowsExcluded: true,
    frozenSourceRejected: true,
    inactiveDestinationRejected: true,
    regionalCountersExcluded: true,
    neighborPreserved: true,
    sourceCleanupComplete: true,
  };
}
