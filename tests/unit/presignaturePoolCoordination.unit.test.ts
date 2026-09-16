import { expect, test } from '@playwright/test';
import {
  routerAbEcdsaDerivationContextBindingB64uV1,
  type RouterAbEcdsaDerivationNormalSigningScopeV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { RouterAbMpcMaterialActivationRefWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  clearAllRouterAbEcdsaDerivationClientPresignatures,
  scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill,
  signRouterAbEcdsaDerivationDigestWithPoolHit,
  type RouterAbEcdsaDerivationClientSigningMaterialSource,
} from '@/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool';
import {
  parseEcdsaClientVerifyingShareB64u,
  parseEcdsaKeyHandle,
  parseEcdsaThresholdKeyId,
} from '@/core/signingEngine/session/keyMaterialBrands';
import type { WorkerOperationContext } from '@/core/signingEngine/workerManager/executeWorkerOperation';

const CLIENT_PUBLIC_KEY_B64U =
  'Anm-Zn753LusVaBilc6HCwcCm_zbLc4o2VnygVsW-BeY';
const SERVER_PUBLIC_KEY_B64U =
  'AsYEf5RB7X1tMEVAbpXAfNhcd45LjO88p6usCblccJ7l';
const THRESHOLD_PUBLIC_KEY_B64U =
  'AvkwigGSWMMQSTRPhfidUim1MchFg2-ZsIYB8RO84Db5';
const PRESIGNATURE_BIG_R_B64U =
  'A_KHc8LZdSiLx9HSBcN0hlGwdfvGYQ5Yzd7t348ZQFqo';

const authorization = {
  kind: 'reusable_wallet_session' as const,
  wallet_session_id: 'wallet-session-1',
};

const materialActivation: RouterAbMpcMaterialActivationRefWire = {
  kind: 'mpc_material_activation_ref',
  activation_id: 'activation-1',
  capability: 'capability-1',
  material_owner: 'wallet-1',
  key_binding: 'key-binding-1',
  lifecycle_binding: 'lifecycle-binding-1',
  signing_worker: 'signing-worker-1',
};

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

function createDeferred(): Deferred {
  let resolvePromise = (): void => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function buildScope(): Promise<RouterAbEcdsaDerivationNormalSigningScopeV1> {
  const context = {
    application_binding_digest_b64u: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
  } as const;
  return {
    wallet_id: 'wallet-1',
    ecdsa_threshold_key_id: 'ecdsa-key-1',
    signing_root_id: 'root-1',
    signing_root_version: 'root-v1',
    context,
    public_identity: {
      context_binding_b64u: await routerAbEcdsaDerivationContextBindingB64uV1(context),
      derivation_client_share_public_key33_b64u: CLIENT_PUBLIC_KEY_B64U,
      server_public_key33_b64u: SERVER_PUBLIC_KEY_B64U,
      threshold_public_key33_b64u: THRESHOLD_PUBLIC_KEY_B64U,
      ethereum_address20_b64u: 'BQUFBQUFBQUFBQUFBQUFBQUFBQU',
      client_share_retry_counter: 0,
      server_share_retry_counter: 1,
    },
    material_activation: materialActivation,
    signing_worker: {
      server_id: 'signing-worker-1',
      key_epoch: 'worker-epoch-1',
      recipient_encryption_key:
        'x25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    activation_epoch: 'activation-1',
  };
}

function buildWorkerContext(): WorkerOperationContext {
  return {
    requestWorkerOperation: async (args) => {
      if (args.kind !== 'evmCrypto' || args.request.type !== 'validateSecp256k1PublicKey33') {
        throw new Error(`Unexpected worker request: ${args.kind}/${args.request.type}`);
      }
      return args.request.payload.publicKey33;
    },
  } as WorkerOperationContext;
}

test('signing uses an available worker presignature without waiting for a refill', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const originalFetch = globalThis.fetch;
  const scope = await buildScope();
  const refillStarted = createDeferred();
  const releaseRefill = createDeferred();
  let listCount = 0;
  let selectedWorkerPresignature = false;

  const clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource = {
    kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
    initClientPresignSession: async () => {
      refillStarted.resolve();
      await releaseRefill.promise;
      throw new Error('test refill released');
    },
    stepClientPresignSession: async () => {
      throw new Error('test must not step the blocked refill');
    },
    abortClientPresignSession: async () => {},
    admitClientPresignature: async () => {},
    destroyClientPresignature: async () => {},
    reserveClientPresignature: async () => {
      selectedWorkerPresignature = true;
      throw new Error('worker presignature selected');
    },
    commitClientPresignature: async () => {},
    listAvailableClientPresignatures: async () => {
      listCount += 1;
      if (listCount === 1) return [];
      return [
        {
          presignatureId: 'worker-presignature-1',
          materialHandle: 'worker-material-1',
          bigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + 30_000,
        },
      ];
    },
    retireClientPresignaturePool: async () => 0,
    computeSignatureShareFromPresignatureHandle: async () => new Uint8Array(32),
  };
  const workerCtx = buildWorkerContext();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.endsWith('/router-ab/ecdsa-derivation/presignature-pool/fill/init')) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return new Response(
      JSON.stringify({
        ok: true,
        presignSessionId: 'presign-session-1',
        materialExpiresAtMs: Date.now() + 20_000,
        stage: 'triples',
        outgoingMessagesB64u: [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const refillInput = {
    relayerUrl: 'https://router.example',
    keyHandle: parseEcdsaKeyHandle('key-handle-1'),
    ecdsaThresholdKeyId: parseEcdsaThresholdKeyId('ecdsa-key-1'),
    clientVerifyingShareB64u: parseEcdsaClientVerifyingShareB64u(CLIENT_PUBLIC_KEY_B64U),
    clientSigningMaterial,
    thresholdEcdsaPublicKeyB64u: THRESHOLD_PUBLIC_KEY_B64U,
    relayerVerifyingShareB64u: SERVER_PUBLIC_KEY_B64U,
    credential: {
      kind: 'wallet_session_opaque',
      walletSessionToken: 'wallet-session-token',
    },
    materialActivation,
    routerAbEcdsaDerivationPoolFill: {
      kind: 'router_ab_ecdsa_derivation_signing_worker_pool',
      scope,
      expiresAtMs: Date.now() + 30_000,
    },
    workerCtx,
    authorization,
    targetDepth: 1,
    triggerIfDepthAtOrBelow: 0,
  };
  const schedule = scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill(refillInput);
  const duplicateSchedule =
    scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill(refillInput);

  expect(schedule).toMatchObject({ scheduled: true, reason: 'scheduled' });
  expect(duplicateSchedule).toMatchObject({
    scheduled: false,
    reason: 'in_flight_for_pool_key',
  });
  await refillStarted.promise;

  try {
    const result = await signRouterAbEcdsaDerivationDigestWithPoolHit({
      relayerUrl: 'https://router.example',
      scope,
      operationId: 'operation-1',
      operationDigests: {
        lane_digest_b64u: 'CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo',
        intent_digest_b64u: 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws',
        display_digest_b64u: 'DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw',
      },
      materialActivation,
      credential: {
        kind: 'wallet_session_opaque',
        walletSessionToken: 'wallet-session-token',
      },
      signingDigest32: new Uint8Array(32).fill(11),
      clientSigningMaterial,
      expiresAtMs: Date.now() + 30_000,
      workerCtx,
      authorization,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'router_ab_sign_failed',
      message: 'worker presignature selected',
    });
    expect(selectedWorkerPresignature).toBe(true);
    expect(listCount).toBe(2);
  } finally {
    releaseRefill.resolve();
    globalThis.fetch = originalFetch;
    clearAllRouterAbEcdsaDerivationClientPresignatures();
  }
});
