import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Fail the real D1 admission transaction before execution or after its commit.
class AdmissionFaultDatabase {
  remaining = 0;
  writes = 0;
  lostReply = false;

  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new AdmissionFaultStatement(this.database.prepare(sql), sql);
  }

  async batch(statements) {
    const admission = statements.some(isAdmissionWrite);
    if (admission) this.writes += 1;
    const fail = admission && this.remaining > 0;
    if (fail) this.remaining -= 1;
    if (fail && !this.lostReply) throw new Error('D1_ERROR: Network connection lost.');
    const result = await this.database.batch(statements.map(originalStatement));
    if (fail && this.lostReply) throw new Error('D1_ERROR: Network connection lost.');
    return result;
  }

  exec(sql) {
    return this.database.exec(sql);
  }
}

class AdmissionFaultStatement {
  constructor(original, sql) {
    this.original = original;
    this.sql = sql;
  }

  bind(...values) {
    return new AdmissionFaultStatement(this.original.bind(...values), this.sql);
  }

  first(...column) {
    return this.original.first(...column);
  }

  all() {
    return this.original.all();
  }

  run() {
    return this.original.run();
  }
}

function isAdmissionWrite(statement) {
  return (
    /(?:INSERT|UPDATE)/u.test(statement.sql) &&
    statement.sql.includes('router_ab_yao_versioned_json_records')
  );
}

function originalStatement(statement) {
  return statement.original;
}

function expectedWrites(fault) {
  switch (fault) {
    case 'lost_request':
      return 2;
    case 'lost_reply':
      return 1;
    case 'exhausted':
      return 3;
    default:
      throw new Error(`Unknown admission fault: ${fault}`);
  }
}

async function servePasskeyOrigin(route) {
  await route.fulfill({ contentType: 'text/html', body: '<title>Registration recovery</title>' });
}

async function createPasskey(setup) {
  const options = PublicKeyCredential.parseCreationOptionsFromJSON({
    challenge: setup.registrationIntentDigestB64u,
    rp: { id: 'wallet.example.test', name: 'Registration recovery' },
    user: { id: 'AQID', name: setup.walletId, displayName: setup.walletId },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    attestation: 'none',
  });
  const credential = await navigator.credentials.create({ publicKey: options });
  return credential.toJSON();
}

// Setup's test signer is deliberately local. The real service still checks its
// ceremony, digest, expiry, passkey proof, home, and persisted admission.
async function verifyFixtureJwt(token) {
  return { valid: true, payload: JSON.parse(Buffer.from(token.split('.')[1], 'base64url')) };
}

async function unexpectedProtocolRequest() {
  throw new Error('Admission must not execute the Yao protocol');
}

async function resolveTenantRoot(api, scope, request) {
  const identity = api.buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: scope.orgId,
    projectId: scope.projectId,
    envId: scope.envId,
    signingRootId: request.signing_root_id,
    signingRootVersion: request.root_share_epoch,
  });
  assert.equal(identity.ok, true, JSON.stringify(identity));
  return {
    identity: identity.value,
    identityDigestB64u: await api.tenantRootIdentityDigestB64uV1(identity.value),
    custodyLineageB64u: Buffer.alloc(16, 7).toString('base64url'),
  };
}

export async function verifyRegistrationRespondRecovery({ api, database, options, input }) {
  const scope = {
    namespace: options.namespace,
    orgId: options.orgId,
    projectId: options.projectId,
    envId: options.envId,
  };
  const browser = await chromium.launch();
  const evidence = [];
  try {
    const page = await browser.newPage();
    await page.route('https://wallet.example.test/**', servePasskeyOrigin);
    await page.goto('https://wallet.example.test');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    for (const fault of ['lost_request', 'lost_reply', 'exhausted']) {
      const observed = new AdmissionFaultDatabase(database);
      const store = api.createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
        database: observed,
        scope,
      });
      const registration = api.createCloudflareD1RouterApiAuthService({
        ...options,
        database: observed,
        ed25519YaoProductRegistration:
          api.createRouterAbEd25519YaoProductRegistrationRequestScopedRuntimeV1({
            signingWorkerId: 'worker',
            store,
            registrationBackend: new api.RouterAbEd25519YaoHttpRegistrationBackend({
              routerUrl: 'https://router.invalid',
              signingWorkerId: 'worker',
              internalServiceAuth: 'admission-test-secret',
              deriverAInputPublicKey: new Array(32).fill(1),
              deriverBInputPublicKey: new Array(32).fill(2),
              signingWorkerRecipientPublicKey: new Array(32).fill(3),
              resolveTenantRoot: resolveTenantRoot.bind(null, api, scope),
              fetch: unexpectedProtocolRequest,
            }),
          }),
      }).walletRegistration;
      const setup = await registration.setupWalletRegistration({
        ...input,
        expectedOrigin: 'https://wallet.example.test',
        request: {
          ...input.request,
          registrationOperationId: api.createRegistrationSetupOperationId(),
        },
      });
      assert.equal(setup.status, 200, JSON.stringify(setup.body));
      const authority = {
        kind: 'passkey',
        webauthnRegistration: await page.evaluate(createPasskey, setup.body),
      };
      const request = {
        registrationCeremonyId: setup.body.registrationCeremonyId,
        signedSetup: setup.body.signedSetup,
        planKind: 'near_ed25519',
        authority,
        verifier: { verifyJwt: verifyFixtureJwt },
      };
      observed.remaining = fault === 'exhausted' ? 3 : 1;
      observed.lostReply = fault === 'lost_reply';
      const response = await registration.respondWalletRegistration(request);
      const initialWriteAttempts = observed.writes;
      assert.equal(
        observed.remaining,
        0,
        `The configured admission fault must be exercised: ${JSON.stringify(response)}`,
      );
      assert.equal(observed.writes, expectedWrites(fault));
      if (fault === 'exhausted') {
        assert.deepEqual(response, {
          ok: false,
          code: 'storage_unavailable',
          message: 'Wallet registration storage is unavailable',
        });
      } else {
        assert.equal(response.ok, true, `${fault}: ${JSON.stringify(response)}`);
      }
      const recovered = await registration.respondWalletRegistration(request);
      assert.equal(recovered.ok, true, JSON.stringify(recovered));
      assert.equal(recovered.ed25519.status, 'admitted');
      assert.deepEqual(recovered.ed25519.admissionReceipt, setup.body.ed25519.admissionReceipt);
      const replay = await registration.respondWalletRegistration(request);
      assert.deepEqual(
        replay,
        recovered,
        'Exact replay must retain the admission and minted identity',
      );
      const writesBeforeCancellation = observed.writes;
      const execution = new api.D1WalletExecutionAuthority(
        database,
        scope,
        options.registrationAuthority,
      );
      assert.equal(
        (
          await execution.cancel({
            walletId: setup.body.walletId,
            ceremonyId: setup.body.registrationCeremonyId,
          })
        ).ok,
        true,
      );
      const cancelled = await registration.respondWalletRegistration(request);
      assert.equal(cancelled.ok, false, 'Cancellation must remain terminal after recovery');
      assert.equal(observed.writes, writesBeforeCancellation);
      evidence.push({
        fault,
        initialWriteAttempts,
        initialResult: response.ok ? 'admitted' : response.code,
        totalWriteAttempts: observed.writes,
        registrationCeremonyId: setup.body.registrationCeremonyId,
        boundedRecovery: true,
        exactAdmissionReplay: true,
        cancellationRefused: true,
      });
    }
    return evidence;
  } finally {
    await browser.close();
  }
}
