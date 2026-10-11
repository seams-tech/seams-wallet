import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

class ApprovedRegistrationAuthority {
  established = false;
  ordinaryReads = 0;

  async reserve() {
    throw new Error('This scenario starts with an approved registration');
  }

  async complete() {
    this.established = true;
    return { ok: true };
  }

  async admitEstablishedHome() {
    this.ordinaryReads += 1;
    throw new Error('Ordinary execution must use local generation storage');
  }
}

/**
 * Publishes an established registration and commits its activation alone.
 * The registration service commits it with the completion of its journal.
 */
export async function establishRegistrationHome(authority, database, completion) {
  const published = await authority.publishEstablished(completion);
  if (!published.ok) return published;
  if (published.activation) await database.batch([...published.activation.statements]);
  return { ok: true };
}

/** Seeds the execution identity that authenticated setup commits with its ceremony. */
export async function seedRegistrationHome({ database, scope, walletId, ceremonyId }) {
  await database
    .prepare(
      `INSERT INTO wallet_execution_generations
    (namespace, org_id, project_id, env_id, wallet_id, generation, origin, origin_id, state)
    VALUES (?, ?, ?, ?, ?, 1, 'registration', ?, 'registering')`,
    )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId, ceremonyId)
    .run();
}

/** Fixtures for activation tests. Session issuance exercises the real transaction separately. */
export async function seedCommittedRegistration({ database, scope, walletId, ceremonyId }) {
  const row = await database
    .prepare(
      `UPDATE wallet_execution_generations SET registration_completion = 'established'
      WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
        AND wallet_id = ? AND origin = 'registration' AND origin_id = ?
        AND state IN ('registering', 'active')
        AND registration_completion IN ('pending', 'established')
      RETURNING state`,
    )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId, ceremonyId)
    .first();
  assert.ok(row, 'Registration session requires its open home');
  return { walletId, ceremonyId, state: row.state };
}

export async function seedExecutionGeneration({ api, database, scope, walletId }) {
  const existing = await database
    .prepare(
      `SELECT 1 FROM wallet_execution_generations
    WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ? AND wallet_id = ?`,
    )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId)
    .first();
  if (existing) return;
  const authority = new api.D1WalletExecutionAuthority(
    database,
    scope,
    new ApprovedRegistrationAuthority(),
  );
  const identity = { walletId, ceremonyId: 'fixture-execution-registration' };
  await seedRegistrationHome({ database, scope, ...identity });
  assert.equal((await authority.admitHome(identity)).ok, true);
  assert.equal(
    (
      await establishRegistrationHome(
        authority,
        database,
        await establishedCompletion(database, scope, identity),
      )
    ).ok,
    true,
  );
}

export async function prepareExecutionGeneration({ api, database, scope, walletId }) {
  const registration = new ApprovedRegistrationAuthority();
  const authority = new api.D1WalletExecutionAuthority(database, scope, registration);
  const identity = { walletId, ceremonyId: 'execution-generation-registration' };
  assert.equal((await authority.admitEstablishedHome({ walletId })).ok, false);
  assert.equal((await authority.admitHome(identity)).ok, false);
  await seedRegistrationHome({ database, scope, ...identity });
  const completion = await establishedCompletion(database, scope, identity);
  assert.equal((await authority.admitHome(identity)).ownershipGeneration, 1);
  assert.equal((await authority.admitHome(identity)).ownershipGeneration, 1);
  assert.equal((await authority.admitEstablishedHome({ walletId })).ok, false);
  const conflict = await authority.admitHome({ walletId, ceremonyId: 'conflicting-registration' });
  assert.equal(conflict.ok, false);
  await database
    .prepare(
      `CREATE TRIGGER injected_execution_completion
    BEFORE UPDATE ON wallet_execution_generations
    WHEN NEW.state = 'active' AND NEW.origin = 'registration'
    BEGIN SELECT RAISE(ABORT, 'injected_execution_completion'); END`,
    )
    .run();
  await assert.rejects(
    establishRegistrationHome(authority, database, completion),
    /injected_execution_completion/u,
  );
  assert.equal(registration.established, true);
  assert.equal((await authority.admitEstablishedHome({ walletId })).ok, false);
  await database.prepare('DROP TRIGGER injected_execution_completion').run();
  assert.deepEqual(await authority.admitHome(identity), {
    ok: true,
    purpose: 'registration',
    ownershipGeneration: 1,
  });
  assert.equal((await authority.admitEstablishedHome({ walletId })).ok, false);
  assert.equal((await establishRegistrationHome(authority, database, completion)).ok, true);
  assert.deepEqual(await api.admitD1EstablishedWalletHome(database, scope, { walletId }), {
    ok: true,
    purpose: 'ordinary',
    ownershipGeneration: 1,
  });
  assert.equal(registration.ordinaryReads, 0);
  return { authority, registration, identity, completion };
}

export async function verifyExecutionDestination({
  api,
  source,
  destination,
  scope,
  setup,
  active,
}) {
  const { walletId } = setup.identity;
  const receiver = new api.D1WalletExecutionAuthority(destination, scope, setup.registration);
  assert.equal((await setup.authority.admitEstablishedHome({ walletId })).ok, false);
  assert.equal((await api.admitD1EstablishedWalletHome(source, scope, { walletId })).ok, false);
  const admitted = await receiver.admitEstablishedHome({ walletId });
  if (active) {
    assert.deepEqual(admitted, { ok: true, purpose: 'ordinary', ownershipGeneration: 2 });
  } else {
    assert.equal(admitted.ok, false);
    await assert.rejects(
      destination
        .prepare("UPDATE wallet_execution_generations SET state = 'active' WHERE wallet_id = ?")
        .bind(walletId)
        .run(),
      /wallet_execution_activation_receipt_required/u,
    );
  }
  await assert.rejects(
    source
      .prepare("UPDATE wallet_execution_generations SET state = 'active' WHERE wallet_id = ?")
      .bind(walletId)
      .run(),
    /wallet_execution_identity_conflicts/u,
  );
  await assert.rejects(
    destination
      .prepare('UPDATE wallet_execution_generations SET generation = 3 WHERE wallet_id = ?')
      .bind(walletId)
      .run(),
    /wallet_execution_identity_conflicts/u,
  );
  const foreign = new api.D1WalletExecutionAuthority(
    destination,
    { ...scope, envId: 'another-environment' },
    setup.registration,
  );
  assert.equal((await foreign.admitEstablishedHome({ walletId })).ok, false);
  assert.equal((await setup.authority.admitHome(setup.identity)).ok, false);
  await assert.rejects(establishedCompletion(source, scope, setup.identity));
  await assert.rejects(establishRegistrationHome(setup.authority, source, setup.completion));
  assert.equal(setup.registration.ordinaryReads, 0);
  return {
    destinationGeneration: 2,
    destinationActive: active,
    retiredSourceCannotReopen: true,
    generationImmutable: true,
    environmentIsolated: true,
    centralOrdinaryReads: setup.registration.ordinaryReads,
  };
}

async function establishedCompletion(database, scope, identity) {
  return {
    registration: await seedCommittedRegistration({ database, scope, ...identity }),
    session: {
      kind: 'credential',
      walletId: identity.walletId,
      digest: createHash('sha256').update(identity.walletId).digest('base64url'),
      expiresAtMs: Date.now() + 60_000,
    },
  };
}
