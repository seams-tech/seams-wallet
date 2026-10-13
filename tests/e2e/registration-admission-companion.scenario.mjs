import assert from 'node:assert/strict';
import { verifyCapabilityPersistence } from './registration-capability-persistence.scenario.mjs';

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
    capabilityPersistence: await verifyCapabilityPersistence({ api, database, scope }),
    ...(await verifyStartedDispatchRoot({ api, database, scope })),
  };
}

// The tenant-root reads of this scenario, each held until the scenario answers it.
class TenantRoots {
  requests = [];
  pending = [];
  constructor(api) {
    this.api = api;
  }
  resolve = (input) => {
    this.requests.push(input);
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  };
  async answer() {
    const input = this.requests.at(-1);
    const identity = this.api.buildTenantRootIdentityFromAuthenticatedDeploymentV1({
      orgId: 'organization',
      projectId: 'project',
      envId: 'dev',
      signingRootId: input.signing_root_id,
      signingRootVersion: input.root_share_epoch,
    });
    assert.equal(identity.ok, true);
    this.pending.shift().resolve({
      identity: identity.value,
      identityDigestB64u: await this.api.tenantRootIdentityDigestB64uV1(identity.value),
      custodyLineageB64u: Buffer.alloc(16, 7).toString('base64url'),
    });
  }
  fail() {
    this.pending.shift().reject(new Error('Injected tenant-root outage'));
  }
}

async function unexpectedRouterRequest() {
  throw new Error('A registration admission must not reach the Router');
}

// Respond starts the tenant-root read before its proof. The admission awaits that read.
async function verifyStartedDispatchRoot({ api, database, scope }) {
  const roots = new TenantRoots(api);
  const store = api.createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
    database,
    scope,
  });
  const runtime = api.createRouterAbEd25519YaoProductRegistrationRequestScopedRuntimeV1({
    signingWorkerId: 'worker',
    store,
    registrationBackend: new api.RouterAbEd25519YaoHttpRegistrationBackend({
      routerUrl: 'https://router.invalid',
      signingWorkerId: 'worker',
      internalServiceAuth: 'admission-test-secret',
      deriverAInputPublicKey: new Array(32).fill(1),
      deriverBInputPublicKey: new Array(32).fill(2),
      signingWorkerRecipientPublicKey: new Array(32).fill(3),
      resolveTenantRoot: roots.resolve,
      fetch: unexpectedRouterRequest,
    }),
  });

  async function verifiedIntent(label) {
    const fixture = await api.buildNearRegistrationAuthorityFixture(label);
    return {
      signingRootId: api.routerAbEd25519YaoRegistrationSigningRootIdV1(fixture.admission),
      lifecycleId: fixture.admission.scope.lifecycle_id,
      intent: {
        kind: 'verified_registration_intent',
        ownershipGeneration: 1,
        registrationIntentGrant: api.registrationIntentGrantFromString(fixture.credential),
        intent: fixture.intent,
        admissionRequest: fixture.admission,
        expiresAtMs: fixture.expiresAtMs,
      },
    };
  }
  // An admission pins the tenant root that its execution dispatches to.
  async function admissions(lifecycleId) {
    return (await store.loadRegistration(lifecycleId)).state.registration.dispatchRoots.size;
  }

  // The read starts with the signing root ID alone, and the admission awaits it.
  const early = await verifiedIntent('started-root');
  const started = runtime.startRegistrationDispatchRoot(early.signingRootId);
  assert.deepEqual(roots.requests, [{ operation: 'registration', ...early.signingRootId }]);
  let settled = false;
  // Setup minted this session. The admission is issued over it.
  const mintedSessionId = Array.from({ length: 32 }, (_, index) => index + 1);
  const admission = runtime
    .bindAndAdmitVerifiedRegistration(early.intent, null, started, mintedSessionId)
    .finally(() => {
      settled = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(settled, false, 'The admission must await the read that was started');
  await roots.answer();
  const admitted = await admission;
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  assert.equal(roots.requests.length, 1, 'The admission must not read the tenant root again');
  assert.equal(await admissions(early.lifecycleId), 1);
  assert.deepEqual(admitted.value.binding.session_id, mintedSessionId);

  // An exact repeat answers from the stored admission and reads nothing.
  const repeated = await runtime.bindAndAdmitVerifiedRegistration(
    early.intent,
    null,
    null,
    mintedSessionId,
  );
  assert.equal(repeated.ok, true, JSON.stringify(repeated));
  assert.equal(repeated.companionWrite, 'not_committed');
  assert.deepEqual(repeated.value, admitted.value);
  assert.equal(roots.requests.length, 1);

  // A read that was started for another signing root ID is refused, and nothing is admitted.
  const other = await verifiedIntent('other-signing-root');
  const foreign = runtime.startRegistrationDispatchRoot({
    ...other.signingRootId,
    signing_root_id: 'another-project:dev',
  });
  await roots.answer();
  const refused = await runtime.bindAndAdmitVerifiedRegistration(
    other.intent,
    null,
    foreign,
    mintedSessionId,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'admission_failed');
  assert.match(refused.message, /another signing root ID/u);
  assert.equal(await admissions(other.lifecycleId), 0);

  // A failed read fails the admission that awaits it. Unobserved, it fails nothing.
  const outage = await verifiedIntent('root-outage');
  const failing = runtime.startRegistrationDispatchRoot(outage.signingRootId);
  roots.fail();
  const unavailable = await runtime.bindAndAdmitVerifiedRegistration(
    outage.intent,
    null,
    failing,
    mintedSessionId,
  );
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, 'admission_failed');
  assert.match(unavailable.message, /Injected tenant-root outage/u);
  assert.equal(await admissions(outage.lifecycleId), 0);
  runtime.startRegistrationDispatchRoot(outage.signingRootId);
  roots.fail();
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    startedReadIsAwaitedOnce: true,
    admissionIsOverTheMintedSession: true,
    repeatReadsNoTenantRoot: true,
    foreignSigningRootIdRefused: true,
    failedReadFailsItsAdmissionOnly: true,
  };
}
