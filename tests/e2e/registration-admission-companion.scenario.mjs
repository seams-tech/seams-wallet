import assert from 'node:assert/strict';

// Registration respond commits its ceremony update in the batch of its Yao admission.
export async function verifyRegistrationAdmissionCompanion({ api, database, scope }) {
  const fixture = await api.buildNearRegistrationAuthorityFixture('admission-companion');
  const lifecycleId = fixture.admission.scope.lifecycle_id;
  const admissions = api.createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
    database,
    scope,
  });
  const ceremonies = new api.D1RegistrationCeremonyRecordStore({
    database,
    scope,
    keyPrefix: 'admission-companion',
  });
  const ceremony = { scope: 'ceremony', id: lifecycleId, expiresAtMs: Date.now() + 600_000 };
  await ceremonies.insertOrRead({ ...ceremony, value: { authority: 'awaiting_proof' } });

  async function stored() {
    const record = await ceremonies.get(ceremony.scope, ceremony.id);
    const admission = await admissions.loadRegistration(lifecycleId);
    return {
      ceremonyVersion: record.version,
      authority: record.value.authority,
      admittedAuthorities: admission.state.authorization.authorities.length,
    };
  }

  function ceremonyUpdate(expectedVersion, authority) {
    return {
      statements: ceremonies.prepareExpectedVersionUpdate({
        ...ceremony,
        expectedVersion,
        next: { authority },
      }),
    };
  }

  const admitted = await admissions.loadRegistration(lifecycleId);
  admitted.state.authorization.authorities.push(...fixture.state.authorities);
  assert.equal(
    (await admissions.commitRegistration(admitted, ceremonyUpdate(1, 'verified'))).kind,
    'stored',
  );
  const committed = { ceremonyVersion: 2, authority: 'verified', admittedAuthorities: 1 };
  assert.deepEqual(await stored(), committed);

  // A ceremony that moved fails its guard, and the admission write rolls back with it.
  const afterCeremonyMoved = await admissions.loadRegistration(lifecycleId);
  afterCeremonyMoved.state.authorization.authorities.splice(0);
  await assert.rejects(
    admissions.commitRegistration(afterCeremonyMoved, ceremonyUpdate(1, 'stale')),
    /registration_ceremony_cas_guard/u,
  );
  assert.deepEqual(await stored(), committed);

  // An admission that moved reports its version, and the ceremony update rolls back with it.
  assert.equal(
    (await admissions.commitRegistration(admitted, ceremonyUpdate(2, 'late'))).kind,
    'version_mismatch',
  );
  assert.deepEqual(await stored(), committed);

  return {
    ceremonyCommitsWithAdmission: true,
    movedCeremonyRollsAdmissionBack: true,
    movedAdmissionRollsCeremonyBack: true,
  };
}
