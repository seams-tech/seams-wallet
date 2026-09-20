import { expect, test } from '@playwright/test';
import {
  routerAbEcdsaDerivationContextBindingB64uV1,
  type RouterAbEcdsaDerivationNormalSigningScopeV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { RouterAbMpcMaterialActivationRefWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  clearAllRouterAbEcdsaDerivationClientPresignatures,
  getRouterAbEcdsaDerivationClientPresignaturePoolDepth,
  scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill,
  signRouterAbEcdsaDerivationDigestWithPool,
  signRouterAbEcdsaDerivationDigestWithPoolHit,
  waitForRouterAbEcdsaDerivationClientPresignaturePoolReady,
  type RouterAbEcdsaDerivationClientSigningMaterialSource,
} from '@/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool';
import {
  parseEcdsaClientVerifyingShareB64u,
  parseEcdsaKeyHandle,
  parseEcdsaThresholdKeyId,
} from '@/core/signingEngine/session/keyMaterialBrands';
import type { WorkerOperationContext } from '@/core/signingEngine/workerManager/executeWorkerOperation';

const CLIENT_PUBLIC_KEY_B64U = 'Anm-Zn753LusVaBilc6HCwcCm_zbLc4o2VnygVsW-BeY';
const SERVER_PUBLIC_KEY_B64U = 'AsYEf5RB7X1tMEVAbpXAfNhcd45LjO88p6usCblccJ7l';
const THRESHOLD_PUBLIC_KEY_B64U = 'AvkwigGSWMMQSTRPhfidUim1MchFg2-ZsIYB8RO84Db5';
const PRESIGNATURE_BIG_R_B64U = 'A_KHc8LZdSiLx9HSBcN0hlGwdfvGYQ5Yzd7t348ZQFqo';

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

async function unexpectedMaterialOperation(): Promise<never> {
  throw new Error('The rejected pool-fill init must not create or consume material');
}

async function emptyAvailablePresignatures(): Promise<[]> {
  return [];
}

function emptyPresignatureMaterialSource(): RouterAbEcdsaDerivationClientSigningMaterialSource {
  return {
    kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
    initClientPresignSession: unexpectedMaterialOperation,
    stepClientPresignSession: unexpectedMaterialOperation,
    abortClientPresignSession: unexpectedMaterialOperation,
    admitClientPresignature: unexpectedMaterialOperation,
    destroyClientPresignature: unexpectedMaterialOperation,
    reserveClientPresignature: unexpectedMaterialOperation,
    commitClientPresignature: unexpectedMaterialOperation,
    listAvailableClientPresignatures: emptyAvailablePresignatures,
    computeSignatureShareFromPresignatureHandle: unexpectedMaterialOperation,
  };
}

async function rejectPoolFillAndRecordTraffic(
  tags: string[],
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  expect(String(input)).toContain('/presignature-pool/fill/init');
  const body: unknown = JSON.parse(String(init?.body));
  if (
    typeof body !== 'object' ||
    body === null ||
    !('requestTag' in body) ||
    typeof body.requestTag !== 'string'
  ) {
    throw new Error('Pool fill must identify its traffic class');
  }
  tags.push(body.requestTag);
  return Response.json({ ok: false, code: 'test_stop', message: 'Stop after admission' });
}

test('a signing cache miss receives foreground pool-fill priority', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const originalFetch = globalThis.fetch;
  const tags: string[] = [];
  globalThis.fetch = rejectPoolFillAndRecordTraffic.bind(undefined, tags);
  try {
    const result = await signRouterAbEcdsaDerivationDigestWithPool({
      relayerUrl: 'https://router.example',
      scope: await buildScope(),
      operationId: 'operation-foreground-miss',
      operationDigests: {
        lane_digest_b64u: 'CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo',
        intent_digest_b64u: 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws',
        display_digest_b64u: 'DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw',
      },
      materialActivation,
      credential: { kind: 'wallet_session_opaque', walletSessionToken: 'wallet-session-token' },
      keyHandle: parseEcdsaKeyHandle('key-handle-1'),
      signingDigest32: new Uint8Array(32).fill(11),
      clientSigningMaterial: emptyPresignatureMaterialSource(),
      expiresAtMs: Date.now() + 30_000,
      workerCtx: buildWorkerContext(),
      authorization,
    });
    expect(result).toMatchObject({ ok: false, code: 'test_stop' });
    expect(tags).toEqual(['foreground_presign_pool_refill']);
  } finally {
    globalThis.fetch = originalFetch;
    clearAllRouterAbEcdsaDerivationClientPresignatures();
  }
});

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

class WaitingSignerRefill {
  readonly kind = 'router_ab_ecdsa_derivation_client_signing_material_source_v1';
  readonly initStarted = createDeferred();
  readonly releaseInit = createDeferred();
  readonly signerHydrating = createDeferred();
  readonly requests: unknown[] = [];
  private listCount = 0;

  async initClientPresignSession() {
    this.initStarted.resolve();
    await this.releaseInit.promise;
    return {
      stage: 'presign' as const,
      outgoingMessages: [],
      presignatureHandle: 'promoted-material',
      presignatureBigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
    };
  }

  async listAvailableClientPresignatures(): Promise<[]> {
    this.listCount += 1;
    if (this.listCount === 2) this.signerHydrating.resolve();
    return [];
  }

  async admitClientPresignature() {
    return { kind: 'resident' as const };
  }

  async reserveClientPresignature(): Promise<never> {
    throw new Error('signer received promoted presignature');
  }

  async abortClientPresignSession(): Promise<void> {}
  async destroyClientPresignature(): Promise<void> {}
  readonly stepClientPresignSession = unexpectedMaterialOperation;
  readonly commitClientPresignature = unexpectedMaterialOperation;
  readonly computeSignatureShareFromPresignatureHandle = unexpectedMaterialOperation;

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    this.requests.push(JSON.parse(String(init?.body)));
    const url = String(input);
    if (url.endsWith('/presignature-pool/fill/init')) {
      return Response.json({
        ok: true,
        presignSessionId: 'promoted-session',
        ceremonyExpiresAtMs: Date.now() + 20_000,
        materialExpiresAtMs: Date.now() + 20_000,
        stage: 'triples',
        outgoingMessagesB64u: [],
      });
    }
    if (url.endsWith('/presignature-pool/fill/step')) {
      return Response.json({
        ok: true,
        stage: 'done',
        event: 'presign_done',
        outgoingMessagesB64u: [],
        presignatureId: 'promoted-presignature',
        bigRB64u: PRESIGNATURE_BIG_R_B64U,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }
}

test('a signer waiting on background generation promotes its remaining rounds without restarting', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const originalFetch = globalThis.fetch;
  const source = new WaitingSignerRefill();
  globalThis.fetch = source.fetch.bind(source);
  const scope = await buildScope();
  const workerCtx = buildWorkerContext();
  const credential = { kind: 'wallet_session_opaque' as const, walletSessionToken: 'test-token' };
  try {
    const scheduled = scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill({
      relayerUrl: 'https://router.example',
      keyHandle: parseEcdsaKeyHandle('key-handle-1'),
      ecdsaThresholdKeyId: parseEcdsaThresholdKeyId('ecdsa-key-1'),
      clientVerifyingShareB64u: parseEcdsaClientVerifyingShareB64u(CLIENT_PUBLIC_KEY_B64U),
      clientSigningMaterial: source,
      thresholdEcdsaPublicKeyB64u: THRESHOLD_PUBLIC_KEY_B64U,
      relayerVerifyingShareB64u: SERVER_PUBLIC_KEY_B64U,
      credential,
      materialActivation,
      routerAbEcdsaDerivationPoolFill: {
        kind: 'router_ab_ecdsa_derivation_signing_worker_pool',
        scope,
        ceremonyExpiresAtMs: Date.now() + 30_000,
        materialExpiresAtMs: Date.now() + 60_000,
      },
      workerCtx,
      authorization,
      targetDepth: 1,
    });
    expect(scheduled.scheduled).toBe(true);
    await source.initStarted.promise;
    const signing = signRouterAbEcdsaDerivationDigestWithPoolHit({
      relayerUrl: 'https://router.example',
      scope,
      operationId: 'operation-promoted-refill',
      operationDigests: {
        lane_digest_b64u: 'CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo',
        intent_digest_b64u: 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws',
        display_digest_b64u: 'DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw',
      },
      materialActivation,
      credential,
      signingDigest32: new Uint8Array(32).fill(11),
      clientSigningMaterial: source,
      expiresAtMs: Date.now() + 30_000,
      workerCtx,
      authorization,
    });
    await source.signerHydrating.promise;
    await new Promise<void>(setImmediate);
    source.releaseInit.resolve();
    await expect(signing).resolves.toMatchObject({
      ok: false,
      message: 'signer received promoted presignature',
    });
    expect(source.requests).toHaveLength(2);
    expect(source.requests[0]).toMatchObject({
      requestTag: 'background_presign_pool_refill',
      authorization,
    });
    expect(source.requests[1]).toMatchObject({
      requestTag: 'foreground_presign_pool_refill',
      authorization,
      presignSessionId: 'promoted-session',
    });
  } finally {
    source.releaseInit.resolve();
    globalThis.fetch = originalFetch;
    clearAllRouterAbEcdsaDerivationClientPresignatures();
  }
});

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
  const destroyedHandles: string[] = [];

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
    admitClientPresignature: async () => ({ kind: 'resident' }),
    destroyClientPresignature: async ({ materialHandle }) => {
      destroyedHandles.push(materialHandle);
    },
    reserveClientPresignature: async () => {
      selectedWorkerPresignature = true;
      throw new Error('worker presignature selected');
    },
    commitClientPresignature: async () => {},
    listAvailableClientPresignatures: async () => {
      listCount += 1;
      if (listCount === 1) return [];
      const nowMs = Date.now();
      return [
        {
          presignatureId: 'expired-presignature',
          materialHandle: 'expired-material',
          bigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
          createdAtMs: nowMs - 5_000,
          expiresAtMs: nowMs + 1_000,
        },
        {
          presignatureId: 'worker-presignature-1',
          materialHandle: 'worker-material-1',
          bigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
          createdAtMs: nowMs,
          expiresAtMs: nowMs + 30_000,
        },
        ...[2, 3, 4, 5, 6].map((index) => ({
          presignatureId: `worker-presignature-${index}`,
          materialHandle: `worker-material-${index}`,
          bigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
          createdAtMs: nowMs + index,
          expiresAtMs: nowMs + 30_000,
        })),
      ];
    },
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
        ceremonyExpiresAtMs: Date.now() + 20_000,
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
      ceremonyExpiresAtMs: Date.now() + 30_000,
      materialExpiresAtMs: Date.now() + 24 * 60 * 60_000,
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
    expect(destroyedHandles).toEqual(
      expect.arrayContaining(['expired-material', 'worker-material-6', 'worker-material-1']),
    );
    expect(
      getRouterAbEcdsaDerivationClientPresignaturePoolDepth({
        relayerUrl: 'https://router.example',
        scope,
        materialActivation,
      }),
    ).toBe(4);
  } finally {
    releaseRefill.resolve();
    globalThis.fetch = originalFetch;
    clearAllRouterAbEcdsaDerivationClientPresignatures();
  }
});

test('an entry popped before reservation is returned to the local pool', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const scope = await buildScope();
  let listCount = 0;
  let reserveCount = 0;
  let destroyCount = 0;
  const clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource = {
    kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
    initClientPresignSession: async () => {
      throw new Error('test must not refill');
    },
    stepClientPresignSession: async () => {
      throw new Error('test must not step a refill');
    },
    abortClientPresignSession: async () => {},
    admitClientPresignature: async () => ({ kind: 'resident' }),
    destroyClientPresignature: async () => {
      destroyCount += 1;
    },
    reserveClientPresignature: async () => {
      reserveCount += 1;
      throw new Error('reservation reached');
    },
    commitClientPresignature: async () => {},
    listAvailableClientPresignatures: async () => {
      listCount += 1;
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
    computeSignatureShareFromPresignatureHandle: async () => new Uint8Array(32),
  };
  const commonInput = {
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
      kind: 'wallet_session_opaque' as const,
      walletSessionToken: 'wallet-session-token',
    },
    signingDigest32: new Uint8Array(32).fill(11),
    clientSigningMaterial,
    workerCtx: buildWorkerContext(),
    authorization,
  };

  try {
    const beforeReservation = await signRouterAbEcdsaDerivationDigestWithPoolHit({
      ...commonInput,
      expiresAtMs: Date.now() - 1,
    });
    expect(beforeReservation).toMatchObject({ ok: false, code: 'pool_entry_expired' });
    expect(reserveCount).toBe(0);
    expect(destroyCount).toBe(0);

    const retried = await signRouterAbEcdsaDerivationDigestWithPoolHit({
      ...commonInput,
      expiresAtMs: Date.now() + 30_000,
    });
    expect(retried).toMatchObject({
      ok: false,
      code: 'router_ab_sign_failed',
      message: 'reservation reached',
    });
    expect(listCount).toBe(1);
    expect(reserveCount).toBe(1);
    expect(destroyCount).toBe(1);
  } finally {
    clearAllRouterAbEcdsaDerivationClientPresignatures();
  }
});

test('a corrupt durable entry is skipped for the next cached entry', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const scope = await buildScope();
  let reserveCount = 0;
  let destroyCount = 0;
  const clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource = {
    kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
    initClientPresignSession: async () => {
      throw new Error('test must not refill');
    },
    stepClientPresignSession: async () => {
      throw new Error('test must not step a refill');
    },
    abortClientPresignSession: async () => {},
    admitClientPresignature: async () => ({ kind: 'resident' }),
    destroyClientPresignature: async () => {
      destroyCount += 1;
    },
    reserveClientPresignature: async () => {
      reserveCount += 1;
      if (reserveCount === 1) {
        return { kind: 'unavailable', reason: 'corrupt' };
      }
      throw new Error('second cached entry selected');
    },
    commitClientPresignature: async () => {},
    listAvailableClientPresignatures: async () => [
      {
        presignatureId: 'worker-presignature-1',
        materialHandle: 'worker-material-1',
        bigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 30_000,
      },
      {
        presignatureId: 'worker-presignature-2',
        materialHandle: 'worker-material-2',
        bigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
        createdAtMs: Date.now() + 1,
        expiresAtMs: Date.now() + 30_000,
      },
    ],
    computeSignatureShareFromPresignatureHandle: async () => new Uint8Array(32),
  };

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
      workerCtx: buildWorkerContext(),
      authorization,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'router_ab_sign_failed',
      message: 'second cached entry selected',
    });
    expect(reserveCount).toBe(2);
    expect(destroyCount).toBe(2);
  } finally {
    clearAllRouterAbEcdsaDerivationClientPresignatures();
  }
});

test('a reservation claimed by another request is never destroyed by the loser', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const scope = await buildScope();
  let reserveCount = 0;
  const destroyedHandles: string[] = [];
  const clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource = {
    kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
    initClientPresignSession: async () => {
      throw new Error('test must not refill');
    },
    stepClientPresignSession: async () => {
      throw new Error('test must not step a refill');
    },
    abortClientPresignSession: async () => {},
    admitClientPresignature: async () => ({ kind: 'resident' }),
    destroyClientPresignature: async ({ materialHandle }) => {
      destroyedHandles.push(materialHandle);
    },
    reserveClientPresignature: async () => {
      reserveCount += 1;
      return { kind: 'unavailable', reason: 'claimed_elsewhere' };
    },
    commitClientPresignature: async () => {},
    listAvailableClientPresignatures: async () => [
      {
        presignatureId: 'worker-presignature-1',
        materialHandle: 'worker-material-1',
        bigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 30_000,
      },
    ],
    computeSignatureShareFromPresignatureHandle: async () => new Uint8Array(32),
  };

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
      workerCtx: buildWorkerContext(),
      authorization,
    });

    expect(result).toMatchObject({ ok: false, code: 'pool_entry_unavailable' });
    expect(reserveCount).toBe(5);
    expect(destroyedHandles).toEqual([]);
  } finally {
    clearAllRouterAbEcdsaDerivationClientPresignatures();
  }
});

async function rejectUnexpectedRefillRequest(state: { requests: number }): Promise<Response> {
  state.requests += 1;
  throw new Error('Background refill competed with foreground signing');
}

test('concurrent signing shares hydration and takes priority over background refill', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const originalFetch = globalThis.fetch;
  const refillRequests = { requests: 0 };
  globalThis.fetch = rejectUnexpectedRefillRequest.bind(undefined, refillRequests);
  const scope = await buildScope();
  const listStarted = createDeferred();
  const releaseList = createDeferred();
  const releaseReservation = createDeferred();
  let listCount = 0;
  let reserveCount = 0;
  const clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource = {
    kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
    initClientPresignSession: async () => {
      throw new Error('test must not refill');
    },
    stepClientPresignSession: async () => {
      throw new Error('test must not step a refill');
    },
    abortClientPresignSession: async () => {},
    admitClientPresignature: async () => ({ kind: 'resident' }),
    destroyClientPresignature: async () => {},
    reserveClientPresignature: async () => {
      reserveCount += 1;
      await releaseReservation.promise;
      throw new Error('single hydrated entry selected');
    },
    commitClientPresignature: async () => {},
    listAvailableClientPresignatures: async () => {
      listCount += 1;
      listStarted.resolve();
      await releaseList.promise;
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
    computeSignatureShareFromPresignatureHandle: async () => new Uint8Array(32),
  };
  const commonInput = {
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
      kind: 'wallet_session_opaque' as const,
      walletSessionToken: 'wallet-session-token',
    },
    signingDigest32: new Uint8Array(32).fill(11),
    clientSigningMaterial,
    expiresAtMs: Date.now() + 30_000,
    workerCtx: buildWorkerContext(),
    authorization,
  };

  try {
    const refill = scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill({
      relayerUrl: commonInput.relayerUrl,
      keyHandle: parseEcdsaKeyHandle('key-handle-1'),
      ecdsaThresholdKeyId: parseEcdsaThresholdKeyId(scope.ecdsa_threshold_key_id),
      clientVerifyingShareB64u: parseEcdsaClientVerifyingShareB64u(CLIENT_PUBLIC_KEY_B64U),
      clientSigningMaterial,
      thresholdEcdsaPublicKeyB64u: THRESHOLD_PUBLIC_KEY_B64U,
      credential: commonInput.credential,
      materialActivation,
      routerAbEcdsaDerivationPoolFill: {
        kind: 'router_ab_ecdsa_derivation_signing_worker_pool',
        scope,
        ceremonyExpiresAtMs: commonInput.expiresAtMs,
        materialExpiresAtMs: Date.now() + 24 * 60 * 60_000,
      },
      workerCtx: commonInput.workerCtx,
      authorization,
      targetDepth: 3,
    });
    expect(refill.scheduled).toBe(true);
    await listStarted.promise;
    const first = signRouterAbEcdsaDerivationDigestWithPoolHit(commonInput);
    const second = signRouterAbEcdsaDerivationDigestWithPoolHit(commonInput);
    await new Promise<void>(setImmediate);
    releaseList.resolve();
    await new Promise<void>(setImmediate);
    const requestsWhileSigning = refillRequests.requests;
    releaseReservation.resolve();
    const results = await Promise.all([first, second]);

    expect(listCount).toBe(1);
    expect(reserveCount).toBe(1);
    expect(requestsWhileSigning).toBe(0);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: false, code: 'router_ab_sign_failed' }),
        expect.objectContaining({ ok: false, code: 'pool_empty' }),
      ]),
    );
  } finally {
    releaseList.resolve();
    releaseReservation.resolve();
    globalThis.fetch = originalFetch;
    clearAllRouterAbEcdsaDerivationClientPresignatures();
  }
});

test('pool readiness waits for the first scheduled presignature', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const originalFetch = globalThis.fetch;
  const scope = await buildScope();
  const releasePresignature = createDeferred();
  let admittedPresignature = false;

  const clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource = {
    kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
    initClientPresignSession: async () => {
      await releasePresignature.promise;
      return {
        stage: 'presign',
        outgoingMessages: [],
        presignatureHandle: 'worker-material-ready',
        presignatureBigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
      };
    },
    stepClientPresignSession: async () => {
      throw new Error('completed local presignature must not be stepped');
    },
    abortClientPresignSession: async () => {},
    admitClientPresignature: async () => {
      admittedPresignature = true;
      return { kind: 'resident' };
    },
    destroyClientPresignature: async () => {},
    reserveClientPresignature: async () => {
      throw new Error('test does not reserve the presignature');
    },
    commitClientPresignature: async () => {},
    listAvailableClientPresignatures: async () => [],
    computeSignatureShareFromPresignatureHandle: async () => new Uint8Array(32),
  };
  const workerCtx = buildWorkerContext();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/router-ab/ecdsa-derivation/presignature-pool/fill/init')) {
      return new Response(
        JSON.stringify({
          ok: true,
          presignSessionId: 'presign-session-ready',
          ceremonyExpiresAtMs: Date.now() + 20_000,
          materialExpiresAtMs: Date.now() + 20_000,
          stage: 'triples',
          outgoingMessagesB64u: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.endsWith('/router-ab/ecdsa-derivation/presignature-pool/fill/step')) {
      return new Response(
        JSON.stringify({
          ok: true,
          stage: 'done',
          event: 'presign_done',
          outgoingMessagesB64u: [],
          presignatureId: 'worker-presignature-ready',
          bigRB64u: PRESIGNATURE_BIG_R_B64U,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const schedule = scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill({
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
      ceremonyExpiresAtMs: Date.now() + 30_000,
      materialExpiresAtMs: Date.now() + 24 * 60 * 60_000,
    },
    workerCtx,
    authorization,
    targetDepth: 1,
    triggerIfDepthAtOrBelow: 0,
  });
  expect(schedule).toMatchObject({ scheduled: true, reason: 'scheduled' });

  let readyResolved = false;
  const ready = waitForRouterAbEcdsaDerivationClientPresignaturePoolReady({
    relayerUrl: 'https://router.example',
    scope,
    materialActivation,
  }).then((result) => {
    readyResolved = true;
    return result;
  });

  await Promise.resolve();
  expect(readyResolved).toBe(false);
  releasePresignature.resolve();

  try {
    await expect(ready).resolves.toBe(true);
    expect(admittedPresignature).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    clearAllRouterAbEcdsaDerivationClientPresignatures();
  }
});

class MaintainingPresignatureSource extends WaitingSignerRefill {
  initRequests = 0;
  successfulInitializations = 0;
  delayFirstTwoInitializationsMs = 0;

  constructor(readonly firstFailure: string) {
    super();
  }

  async initClientPresignSession() {
    if (this.successfulInitializations <= 2 && this.delayFirstTwoInitializationsMs > 0) {
      await delay(this.delayFirstTwoInitializationsMs);
    }
    return {
      stage: 'presign' as const,
      outgoingMessages: [],
      presignatureHandle: `maintained-material-${this.successfulInitializations}`,
      presignatureBigR33: Uint8Array.from(Buffer.from(PRESIGNATURE_BIG_R_B64U, 'base64url')),
    };
  }

  async listAvailableClientPresignatures(): Promise<[]> {
    return [];
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    if (url.endsWith('/presignature-pool/fill/init')) {
      this.initRequests += 1;
      if (this.initRequests === 1 && this.firstFailure) {
        return Response.json({
          ok: false,
          code: this.firstFailure,
          message: 'test admission failure',
        });
      }
      this.successfulInitializations += 1;
      const body = JSON.parse(String(init?.body));
      return Response.json({
        ok: true,
        presignSessionId: `maintained-session-${this.successfulInitializations}`,
        ceremonyExpiresAtMs: body.poolFill.ceremonyExpiresAtMs,
        materialExpiresAtMs: body.poolFill.materialExpiresAtMs,
        stage: 'triples',
        outgoingMessagesB64u: [],
      });
    }
    if (url.endsWith('/presignature-pool/fill/step')) {
      return Response.json({
        ok: true,
        stage: 'done',
        event: 'presign_done',
        outgoingMessagesB64u: [],
        presignatureId: `maintained-presignature-${this.successfulInitializations}`,
        bigRB64u: PRESIGNATURE_BIG_R_B64U,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }
}

async function maintenanceInput(source: MaintainingPresignatureSource, sessionLifetimeMs: number) {
  return {
    relayerUrl: 'https://router.example',
    keyHandle: parseEcdsaKeyHandle('key-handle-1'),
    ecdsaThresholdKeyId: parseEcdsaThresholdKeyId('ecdsa-key-1'),
    clientVerifyingShareB64u: parseEcdsaClientVerifyingShareB64u(CLIENT_PUBLIC_KEY_B64U),
    clientSigningMaterial: source,
    thresholdEcdsaPublicKeyB64u: THRESHOLD_PUBLIC_KEY_B64U,
    credential: { kind: 'wallet_session_opaque' as const, walletSessionToken: 'test-token' },
    materialActivation,
    routerAbEcdsaDerivationPoolFill: {
      kind: 'router_ab_ecdsa_derivation_signing_worker_pool' as const,
      scope: await buildScope(),
      ceremonyExpiresAtMs: Date.now() + sessionLifetimeMs,
      materialExpiresAtMs: Date.now() + 90 * 24 * 60 * 60_000,
    },
    workerCtx: buildWorkerContext(),
    authorization,
  };
}

function maintainedDepth(input: Awaited<ReturnType<typeof maintenanceInput>>): number {
  return getRouterAbEcdsaDerivationClientPresignaturePoolDepth({
    relayerUrl: input.relayerUrl,
    scope: input.routerAbEcdsaDerivationPoolFill.scope,
    materialActivation: input.materialActivation,
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay.bind(null, milliseconds));
}

function resolveDelay(milliseconds: number, resolve: () => void): void {
  setTimeout(resolve, milliseconds);
}

test('transient refill resumes to five and replenishes a consumed entry without another login', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const originalFetch = globalThis.fetch;
  const source = new MaintainingPresignatureSource('network_error');
  globalThis.fetch = source.fetch.bind(source);
  const input = await maintenanceInput(source, 60_000);
  try {
    expect(scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill(input).scheduled).toBe(true);
    await expect.poll(maintainedDepth.bind(null, input), { timeout: 8_000 }).toBe(5);
    expect(source.initRequests).toBe(6);
    const result = await signRouterAbEcdsaDerivationDigestWithPoolHit({
      relayerUrl: input.relayerUrl,
      scope: input.routerAbEcdsaDerivationPoolFill.scope,
      operationId: 'operation-maintained',
      operationDigests: {
        lane_digest_b64u: 'CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo',
        intent_digest_b64u: 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws',
        display_digest_b64u: 'DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw',
      },
      materialActivation,
      credential: input.credential,
      signingDigest32: new Uint8Array(32).fill(11),
      clientSigningMaterial: source,
      expiresAtMs: Date.now() + 30_000,
      workerCtx: input.workerCtx,
      authorization,
    });
    expect(result).toMatchObject({ ok: false, message: 'signer received promoted presignature' });
    await expect.poll(maintainedDepth.bind(null, input)).toBe(5);
    expect(source.initRequests).toBe(7);
  } finally {
    clearAllRouterAbEcdsaDerivationClientPresignatures();
    globalThis.fetch = originalFetch;
  }
});

test('session expiry cancels a pending transient refill retry', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const originalFetch = globalThis.fetch;
  const source = new MaintainingPresignatureSource('network_error');
  globalThis.fetch = source.fetch.bind(source);
  const input = await maintenanceInput(source, 100);
  try {
    scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill(input);
    await delay(250);
    expect(source.initRequests).toBe(1);
    expect(maintainedDepth(input)).toBe(0);
    expect(scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill(input).scheduled).toBe(
      false,
    );
  } finally {
    clearAllRouterAbEcdsaDerivationClientPresignatures();
    globalThis.fetch = originalFetch;
  }
});

test('a partial pool continues after its refill attempt budget ends', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const originalFetch = globalThis.fetch;
  const source = new MaintainingPresignatureSource('');
  source.delayFirstTwoInitializationsMs = 3_000;
  globalThis.fetch = source.fetch.bind(source);
  const input = await maintenanceInput(source, 60_000);
  try {
    scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill({
      ...input,
      poolPolicy: {
        enabled: true,
        targetDepth: 5,
        lowWatermark: 4,
        maxRefillInFlight: 1,
        refillAttemptTimeoutMs: 5_000,
      },
    });
    await expect.poll(maintainedDepth.bind(null, input), { timeout: 4_500 }).toBe(1);
    await expect.poll(maintainedDepth.bind(null, input), { timeout: 12_000 }).toBe(5);
    expect(source.initRequests).toBe(5);
  } finally {
    clearAllRouterAbEcdsaDerivationClientPresignatures();
    globalThis.fetch = originalFetch;
  }
});

test('authorization rejection stops refill without a retry loop', async () => {
  clearAllRouterAbEcdsaDerivationClientPresignatures();
  const originalFetch = globalThis.fetch;
  const source = new MaintainingPresignatureSource('wallet_session_invalid');
  globalThis.fetch = source.fetch.bind(source);
  const input = await maintenanceInput(source, 60_000);
  try {
    scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill(input);
    await delay(4_500);
    expect(source.initRequests).toBe(1);
    expect(maintainedDepth(input)).toBe(0);
  } finally {
    clearAllRouterAbEcdsaDerivationClientPresignatures();
    globalThis.fetch = originalFetch;
  }
});
