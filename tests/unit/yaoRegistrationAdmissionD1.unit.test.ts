import { expect, test } from '@playwright/test';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '@shared/tenant-root/tenantRootIdentity';
import { ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import { openSignerD1 } from '../fixtures/signer-d1.mjs';
import { buildNearRegistrationAuthorityFixture } from './helpers/nearRegistration.fixtures';
import { isD1DatabaseLike } from '../../packages/mpc-wallet-server/src/storage/d1Sql';
import type { D1DatabaseLike } from '../../packages/mpc-wallet-server/src/storage/tenantRoute';
import { createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1 } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/ed25519Yao/d1Ed25519YaoProductRegistrationPartitionedStateStore';
import { D1WalletCeremonyActivity } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/ed25519Yao/d1WalletCeremonyActivity';
import {
  D1WalletRelocationSessions,
  WalletRelocationSessionSource,
} from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationSessions';
import { tenantRootIdentityDigestB64uV1 } from '../../packages/mpc-wallet-server/src/router/cloudflare/runtime/tenantRootCreationGrant';
import type { RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1 } from '../../packages/mpc-wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore';
import { InMemoryRouterAbEd25519YaoRegistrationService } from '../../packages/mpc-wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistration';
import { RouterAbEd25519YaoHttpRegistrationBackend } from '../../packages/mpc-wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoHttpRegistrationBackend';
import { handleRouterAbEd25519YaoRegistrationRequestScopedCloudflareV1 } from '../../packages/mpc-wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationRequestScopedCloudflare';

const SCOPE = { namespace: 'namespace', orgId: 'organization', projectId: 'project', envId: 'dev' };

type Fixture = Awaited<ReturnType<typeof buildNearRegistrationAuthorityFixture>>;

/** The live backend, whose admission can lose its reply a given number of times. */
class ScriptedYaoBackend extends RouterAbEd25519YaoHttpRegistrationBackend {
  admissions = 0;
  lostReplies = 0;

  override async admit(
    ...args: Parameters<RouterAbEd25519YaoHttpRegistrationBackend['admit']>
  ): ReturnType<RouterAbEd25519YaoHttpRegistrationBackend['admit']> {
    this.admissions += 1;
    if (this.lostReplies > 0) {
      this.lostReplies -= 1;
      throw new Error('Registration admission lost its reply');
    }
    return await super.admit(...args);
  }
}

async function resolveTenantRoot(input: {
  readonly signing_root_id: string;
  readonly root_share_epoch: string;
}) {
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: SCOPE.orgId,
    projectId: SCOPE.projectId,
    envId: SCOPE.envId,
    signingRootId: input.signing_root_id,
    signingRootVersion: input.root_share_epoch,
  });
  if (!identity.ok) throw new Error('Tenant root identity fixture is invalid');
  return {
    identity: identity.value,
    identityDigestB64u: await tenantRootIdentityDigestB64uV1(identity.value),
    custodyLineageB64u: Buffer.alloc(16, 7).toString('base64url'),
  };
}

async function unexpectedRouterRequest(): Promise<Response> {
  throw new Error('A registration admission must not reach the Router');
}

function admissionRequest(fixture: Fixture): Request {
  return new Request(
    `https://gateway.test${ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fixture.credential}`,
      },
      body: JSON.stringify(fixture.admission),
    },
  );
}

/** Holds each store's first ceremony read until every racer has read. */
function racingStore(
  store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  arrive: () => Promise<void>,
): RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1 {
  let first = true;
  return {
    loadCapabilities: () => store.loadCapabilities(),
    commitCapabilities: (snapshot, mutation, companion) =>
      store.commitCapabilities(snapshot, mutation, companion),
    load: (lifecycleId) => store.load(lifecycleId),
    commit: (input) => store.commit(input),
    commitRegistration: (snapshot, companion) => store.commitRegistration(snapshot, companion),
    async loadRegistration(lifecycleId) {
      const loaded = await store.loadRegistration(lifecycleId);
      if (first) {
        first = false;
        await arrive();
      }
      return loaded;
    },
  };
}

function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    await gate;
  };
}

async function harness(label: string) {
  const opened = await openSignerD1();
  const database: unknown = opened.database;
  if (!isD1DatabaseLike(database)) throw new Error('Expected the Miniflare D1 database');
  const fixture = await buildNearRegistrationAuthorityFixture(label);
  const lifecycleId = fixture.admission.scope.lifecycle_id;
  const backend = new ScriptedYaoBackend({
    routerUrl: 'https://router.invalid',
    signingWorkerId: fixture.admission.scope.signing_worker_id,
    internalServiceAuth: 'admission-test-secret',
    deriverAInputPublicKey: new Array(32).fill(1),
    deriverBInputPublicKey: new Array(32).fill(2),
    signingWorkerRecipientPublicKey: new Array(32).fill(3),
    resolveTenantRoot,
    fetch: unexpectedRouterRequest,
  });
  // Each Gateway request opens its own store, as the hosted Gateway does.
  const openStore = () =>
    createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
      database,
      scope: SCOPE,
    });
  const installed = await openStore().load(lifecycleId);
  installed.state.authorization.authorities.push(...fixture.state.authorities);
  const stored = await openStore().commit({
    lifecycleId,
    state: installed.state,
    baseline: installed.baseline,
    companionWrite: null,
  });
  expect(stored.kind).toBe('stored');
  return {
    database,
    fixture,
    lifecycleId,
    backend,
    openStore,
    close: opened.close,
    admit: (store = openStore()) =>
      handleRouterAbEd25519YaoRegistrationRequestScopedCloudflareV1({
        request: admissionRequest(fixture),
        store,
        backend,
      }),
    hasPendingCeremony: () =>
      new D1WalletCeremonyActivity(database, SCOPE).hasPending(fixture.intent.walletId),
  };
}

async function storedRecordJson(database: D1DatabaseLike, lifecycleId: string): Promise<string> {
  const row = await database
    .prepare(
      `SELECT record_json FROM router_ab_yao_versioned_json_records
      WHERE namespace = ?1 AND record_json LIKE ?2`,
    )
    .bind(SCOPE.namespace, `%"lifecycleId":"${lifecycleId}"%`)
    .first<{ record_json: string }>();
  if (!row) throw new Error('The ceremony record is missing');
  return row.record_json;
}

test('an uncertain admission stores no claim, and its exact retry admits', async () => {
  const run = await harness('uncertain-admission');
  try {
    run.backend.lostReplies = 1;
    const uncertain = await run.admit();
    expect(uncertain.status).toBe(503);
    expect(await uncertain.json()).toMatchObject({ code: 'admission_uncertain' });

    const afterUncertain = await run.openStore().loadRegistration(run.lifecycleId);
    expect(afterUncertain.state.registration.states.size).toBe(0);
    expect(afterUncertain.state.registration.lifecycleSessions.size).toBe(0);
    expect(await storedRecordJson(run.database, run.lifecycleId)).not.toContain('admission_claim');
    expect(await run.hasPendingCeremony()).toBe(false);

    const retried = await run.admit();
    expect(retried.status).toBe(200);
    const receipt = await retried.json();
    expect(receipt.binding.lifecycle.lifecycle_id).toBe(run.lifecycleId);
    const admitted = await run.openStore().loadRegistration(run.lifecycleId);
    expect(admitted.state.registration.states.size).toBe(1);
    expect(admitted.state.registration.lifecycleSessions.size).toBe(1);
    expect(await run.hasPendingCeremony()).toBe(false);
    expect(run.backend.admissions).toBe(2);
  } finally {
    await run.close();
  }
});

test('concurrent exact admissions store one session, and another admission is refused', async () => {
  const run = await harness('concurrent-admission');
  try {
    const arrive = barrier(2);
    const [first, second] = await Promise.all([
      run.admit(racingStore(run.openStore(), arrive)),
      run.admit(racingStore(run.openStore(), arrive)),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const firstReceipt = await first.json();
    const secondReceipt = await second.json();
    // Both requests minted a session. Only the stored one left the Gateway.
    expect(run.backend.admissions).toBe(2);
    expect(secondReceipt.binding.session_id).toEqual(firstReceipt.binding.session_id);
    const admitted = await run.openStore().loadRegistration(run.lifecycleId);
    expect(admitted.state.registration.states.size).toBe(1);

    const repeated = await run.admit();
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).binding.session_id).toEqual(firstReceipt.binding.session_id);
    expect(run.backend.admissions).toBe(2);

    const other = new InMemoryRouterAbEd25519YaoRegistrationService(
      run.backend,
      admitted.state.registration,
    ).prepareAdmit({ ...run.fixture.admission, participant_ids: [1, 3] });
    expect(other).toMatchObject({
      kind: 'failed',
      failure: { status: 409, code: 'admission_failed' },
    });
  } finally {
    await run.close();
  }
});

test('an uncertain admission leaves relocation retire unblocked', async () => {
  const run = await harness('uncertain-relocation');
  try {
    run.backend.lostReplies = 1;
    expect((await run.admit()).status).toBe(503);
    const source = WalletRelocationSessionSource.parse({
      walletId: run.fixture.intent.walletId,
      moveId: `wmove_${'u'.repeat(43)}`,
      requestDigestHex: '5'.repeat(64),
      sourceGeneration: 1,
    });
    const retiredAtMs = await new D1WalletRelocationSessions(run.database, SCOPE).retire(
      source,
      Date.now(),
    );
    expect(Number.isSafeInteger(retiredAtMs)).toBe(true);
    const fences = await run.database
      .prepare('SELECT COUNT(*) AS count FROM wallet_relocation_session_fences WHERE wallet_id = ?')
      .bind(run.fixture.intent.walletId)
      .first<number>('count');
    expect(fences).toBe(1);
  } finally {
    await run.close();
  }
});

test('a claim that an earlier Gateway stored no longer blocks its lifecycle', async () => {
  const run = await harness('stored-claim');
  try {
    // The record and its activity row as an earlier Gateway left them after an uncertain admission.
    const record = JSON.parse(await storedRecordJson(run.database, run.lifecycleId));
    record.state.state.registration.admissionClaims = {
      __seamsType: 'map_v1',
      entries: [
        [
          run.lifecycleId,
          {
            kind: 'router_ab_ed25519_yao_registration_admission_claim_v1',
            lifecycleId: run.lifecycleId,
            admissionFingerprint: JSON.stringify(run.fixture.admission),
          },
        ],
      ],
    };
    await run.database.batch([
      run.database
        .prepare(
          `UPDATE router_ab_yao_versioned_json_records SET record_json = ?1
          WHERE namespace = ?2 AND record_json LIKE ?3`,
        )
        .bind(JSON.stringify(record), SCOPE.namespace, `%"lifecycleId":"${run.lifecycleId}"%`),
      run.database
        .prepare('UPDATE wallet_ceremony_activity SET settled = 0 WHERE wallet_id = ?')
        .bind(run.fixture.intent.walletId),
    ]);
    expect(await run.hasPendingCeremony()).toBe(true);

    const admitted = await run.admit();
    expect(admitted.status).toBe(200);
    expect(await storedRecordJson(run.database, run.lifecycleId)).not.toContain('admissionClaims');
    expect(await run.hasPendingCeremony()).toBe(false);
  } finally {
    await run.close();
  }
});

test('the in-memory service releases the claim of an uncertain admission', async () => {
  const fixture = await buildNearRegistrationAuthorityFixture('in-memory-uncertain');
  const backend = new ScriptedYaoBackend({
    routerUrl: 'https://router.invalid',
    signingWorkerId: fixture.admission.scope.signing_worker_id,
    internalServiceAuth: 'admission-test-secret',
    deriverAInputPublicKey: new Array(32).fill(1),
    deriverBInputPublicKey: new Array(32).fill(2),
    signingWorkerRecipientPublicKey: new Array(32).fill(3),
    resolveTenantRoot,
    fetch: unexpectedRouterRequest,
  });
  backend.lostReplies = 1;
  const service = new InMemoryRouterAbEd25519YaoRegistrationService(backend);
  expect(await service.admit(fixture.admission)).toMatchObject({
    ok: false,
    code: 'admission_uncertain',
  });
  const admitted = await service.admit(fixture.admission);
  expect(admitted.ok).toBe(true);
  const repeated = await service.admit(fixture.admission);
  expect(repeated).toEqual(admitted);
  expect(backend.admissions).toBe(2);
});
