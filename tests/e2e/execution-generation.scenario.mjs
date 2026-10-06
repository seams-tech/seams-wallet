import assert from 'node:assert/strict';

class ApprovedRegistrationAuthority {
  established = false;
  ordinaryReads = 0;

  async reserve() {
    throw new Error('This scenario starts with an approved registration');
  }

  async admitHome() {
    return {
      ok: true,
      ownershipGeneration: 1,
      purpose: this.established ? 'ordinary' : 'registration',
    };
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
  assert.equal((await authority.admitHome(identity)).ok, true);
  assert.equal((await authority.complete({ ...identity, outcome: 'established' })).ok, true);
}

export async function prepareExecutionGeneration({ api, database, scope, walletId }) {
  const registration = new ApprovedRegistrationAuthority();
  const authority = new api.D1WalletExecutionAuthority(database, scope, registration);
  const identity = { walletId, ceremonyId: 'execution-generation-registration' };
  assert.equal((await authority.admitEstablishedHome({ walletId })).ok, false);
  assert.equal((await authority.admitHome(identity)).ownershipGeneration, 1);
  assert.equal((await authority.admitHome(identity)).ownershipGeneration, 1);
  assert.equal((await authority.admitEstablishedHome({ walletId })).ok, false);
  await assert.rejects(authority.admitHome({ walletId, ceremonyId: 'conflicting-registration' }));
  await database
    .prepare(
      `CREATE TRIGGER injected_execution_completion
    BEFORE UPDATE ON wallet_execution_generations
    WHEN NEW.state = 'active' AND NEW.origin = 'registration'
    BEGIN SELECT RAISE(ABORT, 'injected_execution_completion'); END`,
    )
    .run();
  await assert.rejects(
    authority.complete({ ...identity, outcome: 'established' }),
    /injected_execution_completion/u,
  );
  assert.equal(registration.established, true);
  assert.equal((await authority.admitEstablishedHome({ walletId })).ok, false);
  await database.prepare('DROP TRIGGER injected_execution_completion').run();
  assert.deepEqual(await authority.admitHome(identity), {
    ok: true,
    purpose: 'ordinary',
    ownershipGeneration: 1,
  });
  assert.equal((await authority.complete({ ...identity, outcome: 'established' })).ok, true);
  assert.deepEqual(await api.admitD1EstablishedWalletHome(database, scope, { walletId }), {
    ok: true, purpose: 'ordinary', ownershipGeneration: 1,
  });
  assert.equal(registration.ordinaryReads, 0);
  return { authority, registration, identity };
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
  await assert.rejects(setup.authority.complete({ ...setup.identity, outcome: 'established' }));
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
