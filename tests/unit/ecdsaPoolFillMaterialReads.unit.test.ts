import { expect, test } from '@playwright/test';
import { base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { parseRouterAbEcdsaDerivationNormalSigningScopeV1 } from '@shared/utils/routerAbEcdsaDerivation';
import { buildExactWalletSessionQuotaProjectionV1 } from '../../packages/wallet-server/src/authorization/domain';
import type { RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext } from '../../packages/wallet-server/src/router/framework/authServicePort';
import type { FetchRouterApiContext } from '../../packages/wallet-server/src/router/transport/fetch/fetchRouter.types';
import { authorizeEcdsaPoolFill } from '../../packages/wallet-server/src/router/transport/fetch/routes/thresholdEcdsa';
import { parseRouterAbEcdsaDerivationPoolFillStepRouteRequest } from '../../packages/wallet-server/src/router/domains/ecdsa/thresholdEcdsaRequestValidation';
import { buildMpcMaterialActivationRefFixture } from './helpers/ecdsaMaterialRef.fixtures';
import { buildEmailOtpEcdsaWalletSessionFixture } from './helpers/linkedDeviceManagement.fixtures';

async function buildPresignStepFixture() {
  const walletId = 'wallet:presign-material-reads';
  const fixture = await buildEmailOtpEcdsaWalletSessionFixture({
    label: 'presign-material-reads',
    walletId,
    materialActivation: buildMpcMaterialActivationRefFixture('presign-material-reads', walletId),
    expiresAtMs: Date.now() + 60_000,
  });
  const session = fixture.issuedSession.session;
  const activation = fixture.authority.signerActivations.ecdsa;
  if (!activation) throw new Error('ECDSA fixture requires a signer activation');
  const materialActivation = routerAbMpcMaterialActivationRefToWire(fixture.materialActivation);
  const digest = parseDigestB64u(base64UrlEncode(new Uint8Array(32).fill(1)));
  const scope = parseRouterAbEcdsaDerivationNormalSigningScopeV1({
    wallet_id: walletId,
    ecdsa_threshold_key_id: 'threshold-key:presign-material-reads',
    signing_root_id: 'project:presign-material-reads',
    signing_root_version: 'v1',
    context: { application_binding_digest_b64u: digest },
    public_identity: {
      context_binding_b64u: digest,
      derivation_client_share_public_key33_b64u: activation.signer.thresholdPublicKey33B64u,
      server_public_key33_b64u: activation.signer.thresholdPublicKey33B64u,
      threshold_public_key33_b64u: activation.signer.thresholdPublicKey33B64u,
      ethereum_address20_b64u: base64UrlEncode(new Uint8Array(20).fill(0x11)),
      client_share_retry_counter: 0,
      server_share_retry_counter: 0,
    },
    material_activation: materialActivation,
    signing_worker: {
      server_id: materialActivation.signing_worker,
      key_epoch: 'epoch:presign-material-reads',
      recipient_encryption_key: `x25519:${'05'.repeat(32)}`,
    },
    activation_epoch: 'v1',
  });
  const expiresAtMs = Date.now() + 30_000;
  const parsed = parseRouterAbEcdsaDerivationPoolFillStepRouteRequest({
    presignSessionId: 'presign:material-reads',
    ceremonyExpiresAtMs: expiresAtMs,
    materialExpiresAtMs: expiresAtMs,
    stage: 'presign',
    authorization: { kind: 'operation_step_up' },
    operation: {
      wallet_id: walletId,
      operation_kind: 'evm.sign_transaction',
      operation_id: 'operation:presign-material-reads',
      operation_digests: {
        lane_digest_b64u: digest,
        intent_digest_b64u: digest,
        display_digest_b64u: digest,
      },
      material_activation: materialActivation,
      normal_signing_scope: scope,
      signing_worker_id: materialActivation.signing_worker,
      key_handle: 'key:presign-material-reads',
      relayer_key_id: 'relayer:presign-material-reads',
      participant_ids: [1, 2],
      expires_at_ms: expiresAtMs,
    },
  });
  if (!parsed.ok) throw new Error(parsed.body.message);
  const candidate: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext = {
    status: {
      kind: 'exhausted',
      session,
      quota: buildExactWalletSessionQuotaProjectionV1({
        lifecycle: 'exhausted',
        tenantId: session.tenantId,
        principalId: session.principalId,
        walletSessionId: session.walletSessionId,
        quotaId: session.quotaId,
        remainingUses: 0,
        expiresAtMs: session.expiresAtMs,
      }),
    },
    authority: fixture.authority,
    authMethod: fixture.authMethod,
    retiredAtMs: null,
  };
  return { fixture, session, materialActivation, scope, candidate, request: parsed.request };
}

class PresignStepServices {
  materialReads = 0;
  operationReads = 0;
  materialAvailable = true;
  keyHandle = 'key:presign-material-reads';

  constructor(readonly data: Awaited<ReturnType<typeof buildPresignStepFixture>>) {}

  async readReusableSession(): Promise<never> {
    throw new Error('Wallet Session quota is exhausted');
  }

  async readExhaustedSession() {
    return this.data.candidate;
  }

  async resolveMaterial() {
    this.materialReads += 1;
    if (!this.materialAvailable) {
      return { ok: false as const, code: 'not_found' as const, message: 'Material retired' };
    }
    return {
      ok: true as const,
      materialActivation: this.data.materialActivation,
      keyHandle: this.keyHandle,
      relayerKeyId: 'relayer:presign-material-reads',
      participantIds: [1, 2] as const,
      runtimePolicyScope: {
        orgId: this.data.session.tenantId,
        projectId: 'project:presign-material-reads',
        envId: 'test',
        signingRootVersion: 'v1',
      },
      routerAbEcdsaDerivationNormalSigning: {
        kind: 'router_ab_ecdsa_derivation_normal_signing_v1' as const,
        scope: this.data.scope,
      },
    };
  }

  async readOperation(): Promise<null> {
    this.operationReads += 1;
    return null;
  }

  async admitOperation(): Promise<never> {
    throw new Error('Missing operation must never reach atomic admission');
  }

  context(): FetchRouterApiContext {
    // The route only uses these service methods; domain records come from the shared fixture.
    return {
      request: new Request('https://router.example.test/presign', {
        headers: {
          origin: 'https://wallet.example.test',
          authorization: `Bearer ${this.data.fixture.operationCredential.token}`,
        },
      }),
      service: {
        authorizationSessions: {
          tenantId: this.data.session.tenantId,
          readWalletSessionAuthorizationV2ByOperationCredential:
            this.readReusableSession.bind(this),
          readExhaustedWalletSessionAuthorizationV2CandidateByOperationCredential:
            this.readExhaustedSession.bind(this),
        },
        authorizedOperations: {
          tenantId: this.data.session.tenantId,
          readAuthorizedOperation: this.readOperation.bind(this),
          admitAuthorizedOperation: this.admitOperation.bind(this),
        },
        walletRegistration: { resolveEcdsaMaterialActivation: this.resolveMaterial.bind(this) },
      },
    } as unknown as FetchRouterApiContext;
  }

  authorize() {
    return authorizeEcdsaPoolFill({
      ctx: this.context(),
      request: this.data.request,
      timing: {
        queue: null,
        authenticate: null,
        material: null,
        admit: null,
        proxy: null,
        total: null,
      },
    });
  }
}

test('exhausted presign steps read material once per request and still require exact operation admission', async () => {
  const services = new PresignStepServices(await buildPresignStepFixture());
  const first = await services.authorize();
  expect(first).toMatchObject({
    ok: false,
    error: { status: 409, body: { code: 'authorized_operation_missing' } },
  });
  expect(services.materialReads).toBe(1);
  expect(services.operationReads).toBe(1);

  services.keyHandle = 'key:replacement';
  const replaced = await services.authorize();
  expect(replaced).toMatchObject({
    ok: false,
    error: { status: 403, body: { code: 'scope_mismatch' } },
  });
  expect(services.materialReads).toBe(2);
  expect(services.operationReads).toBe(1);

  services.materialAvailable = false;
  const retired = await services.authorize();
  expect(retired).toMatchObject({
    ok: false,
    error: { status: 403, body: { code: 'scope_mismatch' } },
  });
  expect(services.materialReads).toBe(3);
  expect(services.operationReads).toBe(1);
});
