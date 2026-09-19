import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import { secureRandomId } from '@shared/utils/secureRandomId';
import {
  buildRouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
  buildRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
  parseRouterAbEcdsaDerivationNormalSigningScopeV1,
  routerAbEcdsaRerandomizationClientCommitmentV1,
  routerAbEcdsaDerivationNormalSigningScopeCanonicalBytesV1,
  type RouterAbEcdsaDerivationOperationDigestsV1Wire,
  type RouterAbEcdsaDerivationNormalSigningScopeV1,
  type RouterAbEcdsaOperationStepUpPreparationV1Wire,
} from '@shared/utils/routerAbEcdsaDerivation';
import type {
  RouterAbMpcMaterialActivationRefWire,
  RouterAbNormalSigningAuthorizationWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { canonicalRouterAbMpcMaterialActivationRefBytes } from '@shared/utils/routerAbNormalSigningIdentity';
import type {
  RouterAbEcdsaDerivationPresignaturePoolPolicy,
  RouterAbEcdsaDerivationPresignaturePoolPolicyInput,
} from '@/core/types/seams';
import { DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY } from '@/core/config/defaultConfigs';
import {
  addSecp256k1PublicKeys33Wasm,
  validateSecp256k1PublicKey33Wasm,
  verifySecp256k1RecoverableSignatureAgainstPublicKey33Wasm,
} from '../../chains/evm/evmCryptoWasm';
import type { EcdsaDerivationClientThresholdEcdsaPresignProgress as ThresholdEcdsaPresignProgressWasm } from '../../threshold/crypto/ecdsaDerivationClientWasm';
import type { WorkerOperationContext } from '../../workerManager/executeWorkerOperation';
import {
  ecdsaClientPresignPoolKey,
  FIXED_ECDSA_PRESIGN_PROTOCOL_ID,
  type EcdsaClientPresignPoolIdentity,
} from '../../workerManager/ecdsaPresignPoolIdentity';
import type {
  EcdsaClientPresignAdmissionStorage,
  EcdsaClientPresignReservationResult,
} from '../../workerManager/ecdsaPresignLifecycle';
import {
  ECDSA_CLIENT_PRESIGNATURE_CAPACITY,
  MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS,
} from '../../workerManager/ecdsaPresignLifecycle';
import {
  routerAbEcdsaDerivationPresignaturePoolFillInit,
  routerAbEcdsaDerivationPresignaturePoolFillStep,
  type RouterAbEcdsaDerivationPoolFillAuthorization,
  type RouterAbEcdsaDerivationPresignaturePoolFill,
} from './poolFillRoutes';
import type { RouterAbEcdsaDerivationPoolFillInitKeySelector } from './poolFillRoutes';
import {
  finalizeRouterAbEcdsaDerivationEvmDigestSigningV1,
  prepareRouterAbEcdsaDerivationEvmDigestSigningV1,
  RouterAbSigningRequestError,
  type RouterAbOwnerNormalSigningCredential,
} from '../../../rpcClients/relayer/routerAbNormalSigning';
import {
  formatEcdsaKeyHandleForWire,
  parseEcdsaClientVerifyingShareB64u,
  parseEcdsaThresholdKeyId,
  type EcdsaClientVerifyingShareB64u,
  type EcdsaKeyHandle,
  type EcdsaThresholdKeyId,
} from '../../session/keyMaterialBrands';
import { PresignatureRefillProgressV1 } from './presignatureRefillProgress';
import {
  emitEcdsaSigningTiming,
  emitEcdsaServerTiming,
  emitSigningSessionFlowTrace,
} from '../../session/operationState/trace';

function secureRerandomizationContribution32(): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('WebCrypto getRandomValues is required for ECDSA rerandomization');
  }
  return cryptoApi.getRandomValues(new Uint8Array(32));
}

type RouterAbEcdsaDerivationClientPresignatureRefillInputBase = {
  relayerUrl: string;
  keyHandle: EcdsaKeyHandle;
  ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  clientVerifyingShareB64u: EcdsaClientVerifyingShareB64u;
  clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
  thresholdEcdsaPublicKeyB64u?: string;
  relayerVerifyingShareB64u?: string;
  credential: RouterAbOwnerNormalSigningCredential;
  materialActivation: RouterAbMpcMaterialActivationRefWire;
  routerAbEcdsaDerivationPoolFill: RouterAbEcdsaDerivationPresignaturePoolFill;
  workerCtx: WorkerOperationContext;
};

export type RouterAbEcdsaDerivationClientPresignatureRefillInput =
  RouterAbEcdsaDerivationClientPresignatureRefillInputBase &
    RouterAbEcdsaDerivationPoolFillAuthorization;

type RouterAbEcdsaDerivationSigningAuthorization =
  | {
      readonly authorization: Extract<
        RouterAbNormalSigningAuthorizationWire,
        { readonly kind: 'reusable_wallet_session' }
      >;
      readonly operation?: never;
    }
  | {
      readonly authorization: Extract<
        RouterAbNormalSigningAuthorizationWire,
        { readonly kind: 'operation_step_up' }
      >;
      readonly operation: RouterAbEcdsaOperationStepUpPreparationV1Wire;
    };

function ecdsaPoolFillAuthorization(
  input: RouterAbEcdsaDerivationPoolFillAuthorization | RouterAbEcdsaDerivationSigningAuthorization,
): RouterAbEcdsaDerivationPoolFillAuthorization {
  switch (input.authorization.kind) {
    case 'reusable_wallet_session':
      return { authorization: input.authorization };
    case 'operation_step_up': {
      const operation = input.operation;
      if (!operation) {
        throw new Error('Operation step-up pool fill requires exact operation preparation');
      }
      return {
        authorization: input.authorization,
        operation,
      };
    }
  }
}

function recoverableSignatureErrorMessage(error: unknown): string {
  return String(
    error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message
      : error || 'signature recovery failed',
  );
}

type RouterAbEcdsaDerivationClientPresignatureRefillNotScheduledReason =
  | 'disabled'
  | 'depth_above_trigger'
  | 'depth_at_or_above_target'
  | 'in_flight_for_pool_key'
  | 'global_in_flight_limit'
  | 'invalid_args';

export type RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult =
  | {
      readonly scheduled: true;
      readonly reason: 'scheduled';
      readonly depth: number;
      readonly targetDepth: number;
    }
  | {
      readonly scheduled: false;
      readonly reason: RouterAbEcdsaDerivationClientPresignatureRefillNotScheduledReason;
      readonly depth: number;
      readonly targetDepth: number;
    };

export type RouterAbEcdsaDerivationClientSigningMaterialSource = {
  kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1';
  initClientPresignSession: (input: {
    sessionId: string;
    groupPublicKey33: Uint8Array;
    ceremonyExpiresAtMs: number;
    materialExpiresAtMs: number;
    poolIdentity: EcdsaClientPresignPoolIdentity;
    workerCtx: WorkerOperationContext;
  }) => Promise<ThresholdEcdsaPresignProgressWasm>;
  stepClientPresignSession: (input: {
    sessionId: string;
    stage: 'triples' | 'presign';
    incomingMessages: Uint8Array[];
    workerCtx: WorkerOperationContext;
  }) => Promise<ThresholdEcdsaPresignProgressWasm>;
  abortClientPresignSession: (input: {
    sessionId: string;
    workerCtx: WorkerOperationContext;
  }) => Promise<void>;
  admitClientPresignature: (input: {
    materialHandle: string;
    expectedPresignatureId: string;
    poolIdentity: EcdsaClientPresignPoolIdentity;
    admissionMode: 'durable' | 'resident';
    workerCtx: WorkerOperationContext;
  }) => Promise<EcdsaClientPresignAdmissionStorage>;
  destroyClientPresignature: (input: {
    materialHandle: string;
    poolIdentity: EcdsaClientPresignPoolIdentity;
    workerCtx: WorkerOperationContext;
  }) => Promise<void>;
  reserveClientPresignature: (input: {
    materialHandle: string;
    expectedPresignatureId: string;
    poolIdentity: EcdsaClientPresignPoolIdentity;
    requestBinding: string;
    reservationId: string;
    leaseExpiresAtMs: number;
    workerCtx: WorkerOperationContext;
  }) => Promise<EcdsaClientPresignReservationResult>;
  commitClientPresignature: (input: {
    materialHandle: string;
    poolIdentity: EcdsaClientPresignPoolIdentity;
    requestBinding: string;
    reservationId: string;
    workerCtx: WorkerOperationContext;
  }) => Promise<void>;
  listAvailableClientPresignatures: (input: {
    poolIdentity: EcdsaClientPresignPoolIdentity;
    workerCtx: WorkerOperationContext;
  }) => Promise<
    Array<{
      presignatureId: string;
      materialHandle: string;
      bigR33: Uint8Array;
      createdAtMs: number;
      expiresAtMs: number;
    }>
  >;
  computeSignatureShareFromPresignatureHandle: (input: {
    materialHandle: string;
    poolIdentity: EcdsaClientPresignPoolIdentity;
    requestBinding: string;
    reservationId: string;
    groupPublicKey33: Uint8Array;
    expectedPresignBigR33: Uint8Array;
    digest32: Uint8Array;
    clientRerandomizationContribution32: Uint8Array;
    signingWorkerRerandomizationContribution32: Uint8Array;
    workerCtx: WorkerOperationContext;
  }) => Promise<Uint8Array>;
};

type RouterAbEcdsaDerivationClientPresignatureRef = {
  presignatureId: string;
  bigRB64u: string;
  materialHandle: string;
  createdAtMs: number;
  expiresAtMs: number;
};

type RouterAbEcdsaDerivationCoordinatorError = {
  ok: false;
  code: string;
  message: string;
};

type RouterAbEcdsaDerivationCoordinatorOk = {
  ok: true;
  signature65: Uint8Array;
  signature65B64u: string;
  rB64u: string;
  sB64u: string;
  recId: number;
};

export type RouterAbEcdsaDerivationCoordinatorResult =
  | RouterAbEcdsaDerivationCoordinatorOk
  | RouterAbEcdsaDerivationCoordinatorError;

type RouterAbEcdsaDerivationSigningPreparationState =
  | { readonly kind: 'before_prepare' }
  | { readonly kind: 'prepare_submitted' };

type ClientPresignatureCleanupState =
  | { readonly kind: 'unclaimed' }
  | { readonly kind: 'destroy' }
  | { readonly kind: 'owned_elsewhere' }
  | { readonly kind: 'consumed' };

function zeroizeBytes(bytes?: Uint8Array | null): void {
  if (!(bytes instanceof Uint8Array)) return;
  bytes.fill(0);
}

function assertRouterAbEcdsaDerivationClientSigningMaterialSource(
  source: RouterAbEcdsaDerivationClientSigningMaterialSource,
): void {
  if (source?.kind !== 'router_ab_ecdsa_derivation_client_signing_material_source_v1') {
    throw new Error('Router A/B ECDSA derivation client signing material source is required');
  }
}

const MAX_HANDSHAKE_STEPS = 64;
const ROUTER_AB_ECDSA_DERIVATION_SIGNING_TTL_MS = 60_000;
const ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_EXPIRY_SKEW_MS = 2_000;
const MAX_CLIENT_PRESIGNATURE_CLAIM_RETRIES = ECDSA_CLIENT_PRESIGNATURE_CAPACITY - 1;
const clientPresignaturePool = new Map<string, RouterAbEcdsaDerivationClientPresignatureRef[]>();
const clientPresignaturePoolIdentityByPoolKey = new Map<
  string,
  EcdsaClientPresignPoolIdentity
>();
const clientPresignatureRefillInFlightByPoolKey = new Map<string, PresignatureRefillProgressV1>();
const clientPresignatureHydrationInFlightByPoolKey = new Map<string, Promise<void>>();
const foregroundSignInFlightByPoolKey = new Map<string, number>();
const clientPresignaturePoolGenerationByPoolKey = new Map<string, number>();

type PresignProtocolStage = ThresholdEcdsaPresignProgressWasm['stage'];

function triplesAreComplete(stage: PresignProtocolStage): boolean {
  return stage === 'triples_done' || stage === 'presign' || stage === 'done';
}

function resolvePresignExchangeStage(input: {
  readonly clientStage: PresignProtocolStage;
  readonly serverStage: PresignProtocolStage;
}): 'triples' | 'presign' {
  return triplesAreComplete(input.clientStage) && triplesAreComplete(input.serverStage)
    ? 'presign'
    : 'triples';
}

function normalizeIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizePresignPoolTargetDepth(value: unknown, fallback: number): number {
  return normalizeIntInRange(value, fallback, 1, ECDSA_CLIENT_PRESIGNATURE_CAPACITY);
}

function normalizePresignPoolLowWatermark(
  value: unknown,
  fallback: number,
  targetDepth: number,
): number {
  return normalizeIntInRange(value, fallback, 0, targetDepth);
}

export function resolveRouterAbEcdsaDerivationPresignaturePoolPolicy(
  input?:
    | RouterAbEcdsaDerivationPresignaturePoolPolicyInput
    | RouterAbEcdsaDerivationPresignaturePoolPolicy,
): RouterAbEcdsaDerivationPresignaturePoolPolicy {
  const source = input || DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY;
  const targetDepth = normalizePresignPoolTargetDepth(
    source.targetDepth,
    DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.targetDepth,
  );
  const lowWatermark = normalizePresignPoolLowWatermark(
    source.lowWatermark,
    DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.lowWatermark,
    targetDepth,
  );
  return {
    enabled:
      typeof source.enabled === 'boolean'
        ? source.enabled
        : DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.enabled,
    targetDepth,
    lowWatermark,
    maxRefillInFlight: normalizeIntInRange(
      source.maxRefillInFlight,
      DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.maxRefillInFlight,
      1,
      8,
    ),
    refillAttemptTimeoutMs: normalizeIntInRange(
      source.refillAttemptTimeoutMs,
      DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.refillAttemptTimeoutMs,
      5_000,
      120_000,
    ),
  };
}

function makeClientPresignPoolIdentity(args: {
  relayerUrl: string;
  scope: RouterAbEcdsaDerivationNormalSigningScopeV1;
  materialActivation: RouterAbMpcMaterialActivationRefWire;
}): EcdsaClientPresignPoolIdentity {
  const parsedScope = parseRouterAbEcdsaDerivationNormalSigningScopeV1(args.scope);
  const materialActivation = args.materialActivation;
  const relayerUrl = String(args.relayerUrl || '')
    .trim()
    .replace(/\/+$/g, '');
  return {
    relayerUrl,
    materialActivationB64u: base64UrlEncode(
      canonicalRouterAbMpcMaterialActivationRefBytes(materialActivation),
    ),
    materialActivationId: materialActivation.activation_id,
    capability: materialActivation.capability,
    keyBinding: materialActivation.key_binding,
    walletId: parsedScope.wallet_id,
    signingScopeB64u: base64UrlEncode(
      routerAbEcdsaDerivationNormalSigningScopeCanonicalBytesV1(parsedScope),
    ),
    pairRole: 'client',
    keyEpoch: parsedScope.signing_worker.key_epoch,
    activationEpoch: parsedScope.activation_epoch,
    protocolId: FIXED_ECDSA_PRESIGN_PROTOCOL_ID,
  };
}

function popClientPresignature(poolKey: string): RouterAbEcdsaDerivationClientPresignatureRef | null {
  const list = clientPresignaturePool.get(poolKey);
  if (!list?.length) return null;
  const item = list.shift() ?? null;
  if (!list.length) {
    clientPresignaturePool.delete(poolKey);
  } else {
    clientPresignaturePool.set(poolKey, list);
  }
  return item;
}

async function takeClientPresignature(input: {
  readonly poolKey: string;
  readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  readonly clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
  readonly workerCtx: WorkerOperationContext;
}): Promise<RouterAbEcdsaDerivationClientPresignatureRef | null> {
  await destroyExpiredClientPresignatures(input);
  return popClientPresignature(input.poolKey);
}

type PushClientPresignatureResult = 'stored' | 'duplicate' | 'capacity_full' | 'invalid';

function pushClientPresignature(
  poolKey: string,
  poolIdentity: EcdsaClientPresignPoolIdentity,
  item: RouterAbEcdsaDerivationClientPresignatureRef,
): PushClientPresignatureResult {
  if (!isClientPresignatureUsable(item)) return 'invalid';
  const list = clientPresignaturePool.get(poolKey) || [];
  for (const existing of list) {
    if (existing.materialHandle === item.materialHandle) return 'duplicate';
  }
  const availableCount = list.filter((entry) => isClientPresignatureUsable(entry)).length;
  if (availableCount >= ECDSA_CLIENT_PRESIGNATURE_CAPACITY) return 'capacity_full';
  list.push(item);
  clientPresignaturePool.set(poolKey, list);
  clientPresignaturePoolIdentityByPoolKey.set(poolKey, poolIdentity);
  return 'stored';
}

function removeExpiredClientPresignatures(
  poolKey: string,
  nowMs = Date.now(),
): RouterAbEcdsaDerivationClientPresignatureRef[] {
  const list = clientPresignaturePool.get(poolKey);
  if (!list?.length) return [];
  const live: RouterAbEcdsaDerivationClientPresignatureRef[] = [];
  const expired: RouterAbEcdsaDerivationClientPresignatureRef[] = [];
  for (const entry of list) {
    if (isClientPresignatureUsable(entry, nowMs)) live.push(entry);
    else expired.push(entry);
  }
  if (live.length > 0) clientPresignaturePool.set(poolKey, live);
  else clientPresignaturePool.delete(poolKey);
  return expired;
}

async function destroyClientPresignatureRefs(input: {
  readonly refs: readonly RouterAbEcdsaDerivationClientPresignatureRef[];
  readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  readonly clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
  readonly workerCtx: WorkerOperationContext;
}): Promise<void> {
  for (const ref of input.refs) {
    await input.clientSigningMaterial
      .destroyClientPresignature({
        materialHandle: ref.materialHandle,
        poolIdentity: input.poolIdentity,
        workerCtx: input.workerCtx,
      })
      .catch(() => {});
  }
}

async function destroyExpiredClientPresignatures(input: {
  readonly poolKey: string;
  readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  readonly clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
  readonly workerCtx: WorkerOperationContext;
}): Promise<void> {
  await destroyClientPresignatureRefs({
    refs: removeExpiredClientPresignatures(input.poolKey),
    poolIdentity: input.poolIdentity,
    clientSigningMaterial: input.clientSigningMaterial,
    workerCtx: input.workerCtx,
  });
}

async function hydrateClientPresignaturePool(input: {
  poolKey: string;
  poolIdentity: EcdsaClientPresignPoolIdentity;
  clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
  workerCtx: WorkerOperationContext;
  generation: number;
}): Promise<void> {
  const existing = clientPresignatureHydrationInFlightByPoolKey.get(input.poolKey);
  if (existing) {
    await existing;
    return;
  }
  const hydration = runClientPresignaturePoolHydration(input);
  clientPresignatureHydrationInFlightByPoolKey.set(input.poolKey, hydration);
  try {
    await hydration;
  } finally {
    if (clientPresignatureHydrationInFlightByPoolKey.get(input.poolKey) === hydration) {
      clientPresignatureHydrationInFlightByPoolKey.delete(input.poolKey);
    }
  }
}

async function runClientPresignaturePoolHydration(input: {
  poolKey: string;
  poolIdentity: EcdsaClientPresignPoolIdentity;
  clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
  workerCtx: WorkerOperationContext;
  generation: number;
}): Promise<void> {
  await destroyExpiredClientPresignatures(input);
  let durableRefs: Awaited<
    ReturnType<
      RouterAbEcdsaDerivationClientSigningMaterialSource['listAvailableClientPresignatures']
    >
  >;
  durableRefs = await input.clientSigningMaterial.listAvailableClientPresignatures({
    poolIdentity: input.poolIdentity,
    workerCtx: input.workerCtx,
  });
  if (getClientPresignaturePoolGeneration(input.poolKey) !== input.generation) {
    for (const ref of durableRefs) {
      zeroizeBytes(ref.bigR33);
      await input.clientSigningMaterial
        .destroyClientPresignature({
          materialHandle: ref.materialHandle,
          poolIdentity: input.poolIdentity,
          workerCtx: input.workerCtx,
        })
        .catch(() => {});
    }
    return;
  }
  for (const ref of durableRefs) {
    const result = pushClientPresignature(input.poolKey, input.poolIdentity, {
      presignatureId: ref.presignatureId,
      materialHandle: ref.materialHandle,
      bigRB64u: base64UrlEncode(ref.bigR33),
      createdAtMs: ref.createdAtMs,
      expiresAtMs: ref.expiresAtMs,
    });
    zeroizeBytes(ref.bigR33);
    if (result === 'invalid' || result === 'capacity_full') {
      await input.clientSigningMaterial
        .destroyClientPresignature({
          materialHandle: ref.materialHandle,
          poolIdentity: input.poolIdentity,
          workerCtx: input.workerCtx,
        })
        .catch(() => {});
    }
  }
}

function getClientPresignaturePoolDepth(poolKey: string): number {
  const list = clientPresignaturePool.get(poolKey);
  if (!list) return 0;
  return list.reduce(
    (count, item) => count + (isClientPresignatureUsable(item) ? 1 : 0),
    0,
  );
}

function isClientPresignatureUsable(
  item: RouterAbEcdsaDerivationClientPresignatureRef,
  nowMs = Date.now(),
): boolean {
  const expiresAtMs = Math.floor(Number(item.expiresAtMs));
  return (
    Boolean(item.presignatureId && item.bigRB64u && item.materialHandle) &&
    Number.isSafeInteger(expiresAtMs) &&
    expiresAtMs > nowMs + ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_EXPIRY_SKEW_MS
  );
}

function getClientPresignaturePoolGeneration(poolKey: string): number {
  const generation = clientPresignaturePoolGenerationByPoolKey.get(poolKey);
  if (generation !== undefined) return generation;
  clientPresignaturePoolGenerationByPoolKey.set(poolKey, 0);
  return 0;
}

function bumpClientPresignaturePoolGeneration(poolKey: string): number {
  const nextGeneration = getClientPresignaturePoolGeneration(poolKey) + 1;
  clientPresignaturePoolGenerationByPoolKey.set(poolKey, nextGeneration);
  return nextGeneration;
}

async function invalidateClientPresignaturePool(input: {
  readonly poolKey: string;
  readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  readonly clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
  readonly workerCtx: WorkerOperationContext;
}): Promise<void> {
  const refs = clientPresignaturePool.get(input.poolKey) ?? [];
  clientPresignaturePool.delete(input.poolKey);
  clientPresignaturePoolIdentityByPoolKey.delete(input.poolKey);
  bumpClientPresignaturePoolGeneration(input.poolKey);
  await destroyClientPresignatureRefs({ ...input, refs });
}

function getForegroundSignInFlightCount(poolKey: string): number {
  return foregroundSignInFlightByPoolKey.get(poolKey) || 0;
}

function startForegroundSign(poolKey: string): void {
  const current = getForegroundSignInFlightCount(poolKey);
  foregroundSignInFlightByPoolKey.set(poolKey, current + 1);
}

function finishForegroundSign(poolKey: string): void {
  const current = getForegroundSignInFlightCount(poolKey);
  if (current <= 1) {
    foregroundSignInFlightByPoolKey.delete(poolKey);
    return;
  }
  foregroundSignInFlightByPoolKey.set(poolKey, current - 1);
}

async function waitForAvailablePresignatureFromInFlightRefill(poolKey: string): Promise<void> {
  const progress = clientPresignatureRefillInFlightByPoolKey.get(poolKey);
  if (!progress) return;
  let observed = progress.snapshot();
  while (getClientPresignaturePoolDepth(poolKey) === 0 && observed.kind === 'refilling') {
    observed = await progress.waitForChange(observed);
  }
}

export async function waitForRouterAbEcdsaDerivationClientPresignaturePoolReady(args: {
  relayerUrl: string;
  scope: RouterAbEcdsaDerivationNormalSigningScopeV1;
  materialActivation: RouterAbMpcMaterialActivationRefWire;
}): Promise<boolean> {
  const poolIdentity = makeClientPresignPoolIdentity({
    relayerUrl: args.relayerUrl,
    scope: args.scope,
    materialActivation: args.materialActivation,
  });
  const poolKey = ecdsaClientPresignPoolKey(poolIdentity);
  if (getClientPresignaturePoolDepth(poolKey) > 0) return true;
  await waitForAvailablePresignatureFromInFlightRefill(poolKey);
  return getClientPresignaturePoolDepth(poolKey) > 0;
}

function buildPresignatureRefillNotScheduledResult(
  reason: RouterAbEcdsaDerivationClientPresignatureRefillNotScheduledReason,
  depth: number,
  targetDepth: number,
): RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult {
  return { scheduled: false, reason, depth, targetDepth };
}

export function clearAllRouterAbEcdsaDerivationClientPresignatures(): void {
  const invalidatedPoolKeys = new Set([
    ...clientPresignaturePool.keys(),
    ...clientPresignatureRefillInFlightByPoolKey.keys(),
    ...foregroundSignInFlightByPoolKey.keys(),
    ...clientPresignaturePoolGenerationByPoolKey.keys(),
  ]);
  for (const poolKey of invalidatedPoolKeys) bumpClientPresignaturePoolGeneration(poolKey);
  clientPresignaturePool.clear();
  clientPresignaturePoolIdentityByPoolKey.clear();
  for (const progress of clientPresignatureRefillInFlightByPoolKey.values()) {
    progress.settle();
  }
  clientPresignatureRefillInFlightByPoolKey.clear();
  foregroundSignInFlightByPoolKey.clear();
}

export function clearRouterAbEcdsaDerivationClientPresignaturesForWallet(
  walletIdInput: string,
): void {
  const walletId = String(walletIdInput).trim();
  if (!walletId) throw new Error('ECDSA presignature wallet id is required');
  for (const [poolKey, identity] of [...clientPresignaturePoolIdentityByPoolKey]) {
    if (identity.walletId !== walletId) continue;
    clientPresignaturePool.delete(poolKey);
    clientPresignaturePoolIdentityByPoolKey.delete(poolKey);
    bumpClientPresignaturePoolGeneration(poolKey);
    clientPresignatureRefillInFlightByPoolKey.get(poolKey)?.settle();
    clientPresignatureRefillInFlightByPoolKey.delete(poolKey);
    foregroundSignInFlightByPoolKey.delete(poolKey);
  }
}

export function getRouterAbEcdsaDerivationClientPresignaturePoolDepth(args: {
  relayerUrl: string;
  scope: RouterAbEcdsaDerivationNormalSigningScopeV1;
  materialActivation: RouterAbMpcMaterialActivationRefWire;
}): number {
  const poolIdentity = makeClientPresignPoolIdentity({
    relayerUrl: args.relayerUrl,
    scope: args.scope,
    materialActivation: args.materialActivation,
  });
  return getClientPresignaturePoolDepth(ecdsaClientPresignPoolKey(poolIdentity));
}

export function scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill(
  args: RouterAbEcdsaDerivationClientPresignatureRefillInput & {
    poolPolicy?:
      | RouterAbEcdsaDerivationPresignaturePoolPolicyInput
      | RouterAbEcdsaDerivationPresignaturePoolPolicy;
    targetDepth?: number;
    triggerIfDepthAtOrBelow?: number;
  },
): RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult {
  try {
    const policy = resolveRouterAbEcdsaDerivationPresignaturePoolPolicy(args.poolPolicy);
    const poolIdentity = makeClientPresignPoolIdentity({
      relayerUrl: args.relayerUrl,
      scope: args.routerAbEcdsaDerivationPoolFill.scope,
      materialActivation: args.materialActivation,
    });
    const poolKey = ecdsaClientPresignPoolKey(poolIdentity);
    clientPresignaturePoolIdentityByPoolKey.set(poolKey, poolIdentity);
    const targetDepth = normalizePresignPoolTargetDepth(args.targetDepth, policy.targetDepth);
    const triggerDepth = normalizePresignPoolLowWatermark(
      args.triggerIfDepthAtOrBelow,
      policy.lowWatermark,
      targetDepth,
    );
    const depth = getClientPresignaturePoolDepth(poolKey);
    const scheduledGeneration = getClientPresignaturePoolGeneration(poolKey);

    if (!policy.enabled) {
      return buildPresignatureRefillNotScheduledResult('disabled', depth, targetDepth);
    }
    if (depth > triggerDepth) {
      return buildPresignatureRefillNotScheduledResult(
        'depth_above_trigger',
        depth,
        targetDepth,
      );
    }
    if (depth >= targetDepth) {
      return buildPresignatureRefillNotScheduledResult(
        'depth_at_or_above_target',
        depth,
        targetDepth,
      );
    }
    if (clientPresignatureRefillInFlightByPoolKey.has(poolKey)) {
      return buildPresignatureRefillNotScheduledResult(
        'in_flight_for_pool_key',
        depth,
        targetDepth,
      );
    }
    if (getForegroundSignInFlightCount(poolKey) > 0) {
      return buildPresignatureRefillNotScheduledResult(
        'in_flight_for_pool_key',
        depth,
        targetDepth,
      );
    }
    if (clientPresignatureRefillInFlightByPoolKey.size >= policy.maxRefillInFlight) {
      return buildPresignatureRefillNotScheduledResult(
        'global_in_flight_limit',
        depth,
        targetDepth,
      );
    }

    const refillInput: RouterAbEcdsaDerivationClientPresignatureRefillInput = {
      relayerUrl: args.relayerUrl,
      keyHandle: args.keyHandle,
      ecdsaThresholdKeyId: args.ecdsaThresholdKeyId,
      clientVerifyingShareB64u: args.clientVerifyingShareB64u,
      clientSigningMaterial: args.clientSigningMaterial,
      thresholdEcdsaPublicKeyB64u: args.thresholdEcdsaPublicKeyB64u,
      relayerVerifyingShareB64u: args.relayerVerifyingShareB64u,
      credential: args.credential,
      materialActivation: args.materialActivation,
      routerAbEcdsaDerivationPoolFill: args.routerAbEcdsaDerivationPoolFill,
      workerCtx: args.workerCtx,
      ...ecdsaPoolFillAuthorization(args),
    };
    const progress = new PresignatureRefillProgressV1();
    clientPresignatureRefillInFlightByPoolKey.set(poolKey, progress);
    const deadlineAtMs = Date.now() + policy.refillAttemptTimeoutMs;
    const refillTask = (async (): Promise<void> => {
      try {
        await hydrateClientPresignaturePool({
          poolKey,
          poolIdentity,
          clientSigningMaterial: args.clientSigningMaterial,
          workerCtx: args.workerCtx,
          generation: scheduledGeneration,
        });
      } catch {}
      if (getClientPresignaturePoolDepth(poolKey) > 0) {
        progress.publishAvailable();
        if (getForegroundSignInFlightCount(poolKey) > 0) return;
      }
      while (Date.now() < deadlineAtMs) {
        if (getClientPresignaturePoolGeneration(poolKey) !== scheduledGeneration) return;
        const currentDepth = getClientPresignaturePoolDepth(poolKey);
        if (currentDepth >= targetDepth) return;
        const refill = await refillRouterAbEcdsaDerivationClientPresignaturePool({
          ...refillInput,
          trafficClass: 'background',
        });
        emitSigningSessionFlowTrace('evm-family', {
          event: 'ecdsa_background_refill_result',
          authorization: args.authorization.kind,
          outcome: refill.ok ? 'available' : 'failed',
          code: refill.ok ? null : refill.code,
          depth: getClientPresignaturePoolDepth(poolKey),
          targetDepth,
        });
        if (!refill.ok) return;
        progress.publishAvailable();
        // The signer replenishes the pool after its online exchange completes.
        if (getForegroundSignInFlightCount(poolKey) > 0) return;
      }
    })()
      .catch(() => {})
      .finally(() => {
        const inFlight = clientPresignatureRefillInFlightByPoolKey.get(poolKey);
        progress.settle();
        if (inFlight === progress) {
          clientPresignatureRefillInFlightByPoolKey.delete(poolKey);
        }
      });
    void refillTask;
    return { scheduled: true, reason: 'scheduled', depth, targetDepth };
  } catch {
    return buildPresignatureRefillNotScheduledResult('invalid_args', 0, 0);
  }
}

function toB64uMessages(messages: Uint8Array[]): string[] {
  return messages.map((entry) => base64UrlEncode(entry));
}

function fromB64uMessages(messagesB64u: string[] | undefined): Uint8Array[] {
  if (!Array.isArray(messagesB64u)) return [];
  return messagesB64u
    .map((entry) => String(entry || '').trim())
    .filter((entry) => Boolean(entry))
    .map((entry) => base64UrlDecode(entry));
}

async function resolveGroupPublicKey33(args: {
  clientVerifyingShareB64u: string;
  thresholdEcdsaPublicKeyB64u?: string;
  relayerVerifyingShareB64u?: string;
  workerCtx: WorkerOperationContext;
}): Promise<Uint8Array> {
  const thresholdEcdsaPublicKeyB64u = String(args.thresholdEcdsaPublicKeyB64u || '').trim();
  if (thresholdEcdsaPublicKeyB64u) {
    const bytes = base64UrlDecode(thresholdEcdsaPublicKeyB64u);
    if (bytes.length !== 33) throw new Error('thresholdEcdsaPublicKeyB64u must decode to 33 bytes');
    return await validateSecp256k1PublicKey33Wasm({
      publicKey33: bytes,
      workerCtx: args.workerCtx,
    });
  }

  const clientVerifyingShareB64u = String(args.clientVerifyingShareB64u || '').trim();
  const relayerVerifyingShareB64u = String(args.relayerVerifyingShareB64u || '').trim();
  if (!clientVerifyingShareB64u || !relayerVerifyingShareB64u) {
    throw new Error(
      'Missing thresholdEcdsaPublicKeyB64u (or relayerVerifyingShareB64u fallback) for Router A/B ECDSA derivation signing',
    );
  }

  const clientBytes = base64UrlDecode(clientVerifyingShareB64u);
  const relayerBytes = base64UrlDecode(relayerVerifyingShareB64u);
  if (clientBytes.length !== 33)
    throw new Error('clientVerifyingShareB64u must decode to 33 bytes');
  if (relayerBytes.length !== 33)
    throw new Error('relayerVerifyingShareB64u must decode to 33 bytes');
  const validatedClientPublicKey33 = await validateSecp256k1PublicKey33Wasm({
    publicKey33: clientBytes,
    workerCtx: args.workerCtx,
  });
  const validatedRelayerPublicKey33 = await validateSecp256k1PublicKey33Wasm({
    publicKey33: relayerBytes,
    workerCtx: args.workerCtx,
  });
  return await addSecp256k1PublicKeys33Wasm({
    left33: validatedClientPublicKey33,
    right33: validatedRelayerPublicKey33,
    workerCtx: args.workerCtx,
  });
}

type RouterAbEcdsaPresignHandshakeArgs = {
  relayerUrl: string;
  poolFillInitKeySelector: RouterAbEcdsaDerivationPoolFillInitKeySelector;
  clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
  groupPublicKey33: Uint8Array;
  materialActivation: RouterAbMpcMaterialActivationRefWire;
  credential: RouterAbOwnerNormalSigningCredential;
  requestTag: 'background_presign_pool_refill' | 'foreground_presign_pool_refill';
  routerAbEcdsaDerivationPoolFill: RouterAbEcdsaDerivationPresignaturePoolFill;
  workerCtx: WorkerOperationContext;
} & RouterAbEcdsaDerivationPoolFillAuthorization;

async function runPresignHandshake(
  args: RouterAbEcdsaPresignHandshakeArgs,
): Promise<
  | { ok: true; presignature: RouterAbEcdsaDerivationClientPresignatureRef }
  | RouterAbEcdsaDerivationCoordinatorError
> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runPresignHandshakeAttempt(args);
    if (result.ok || !isRetryablePoolFillStale(result) || attempt === 1) return result;
  }
  return {
    ok: false,
    code: 'stale_session_state',
    message: 'Router A/B ECDSA derivation pool-fill session stayed stale after retry',
  };
}

async function runPresignHandshakeAttempt(
  args: RouterAbEcdsaPresignHandshakeArgs,
): Promise<
  | { ok: true; presignature: RouterAbEcdsaDerivationClientPresignatureRef }
  | RouterAbEcdsaDerivationCoordinatorError
> {
  assertRouterAbEcdsaDerivationClientSigningMaterialSource(args.clientSigningMaterial);
  const handshakeStartedAt = performance.now();
  const init = await routerAbEcdsaDerivationPresignaturePoolFillInit({
    relayerUrl: args.relayerUrl,
    ...args.poolFillInitKeySelector,
    count: 1,
    credential: args.credential,
    requestTag: args.requestTag,
    poolFill: args.routerAbEcdsaDerivationPoolFill,
    ...ecdsaPoolFillAuthorization(args),
  });
  if (!init.ok) {
    return {
      ok: false,
      code: init.code || 'presign_init_failed',
      message: init.message || 'Router A/B ECDSA derivation pool-fill init failed',
    };
  }

  const presignSessionId = String(init.presignSessionId || '').trim();
  if (!presignSessionId) {
    return {
      ok: false,
      code: 'internal',
      message: 'Router A/B ECDSA derivation pool-fill init returned empty presignSessionId',
    };
  }
  const ceremonyExpiresAtMs = Math.floor(Number(init.ceremonyExpiresAtMs));
  if (
    !Number.isSafeInteger(ceremonyExpiresAtMs) ||
    ceremonyExpiresAtMs <= Date.now() ||
    ceremonyExpiresAtMs > args.routerAbEcdsaDerivationPoolFill.ceremonyExpiresAtMs
  ) {
    return {
      ok: false,
      code: 'invalid_pool_fill_expiry',
      message: 'Router A/B ECDSA derivation pool-fill init returned invalid ceremony expiry',
    };
  }
  const materialExpiresAtMs = clientPresignatureExpiresAtMs({
    serverExpiresAtMs: init.materialExpiresAtMs,
    requestedExpiresAtMs: args.routerAbEcdsaDerivationPoolFill.materialExpiresAtMs,
  });
  if (materialExpiresAtMs === null) {
    return {
      ok: false,
      code: 'invalid_pool_fill_expiry',
      message: 'Router A/B ECDSA derivation pool-fill init returned invalid material expiry',
    };
  }

  const localSessionId = presignSessionId;
  const poolIdentity = makeClientPresignPoolIdentity({
    relayerUrl: args.relayerUrl,
    scope: args.routerAbEcdsaDerivationPoolFill.scope,
    materialActivation: args.materialActivation,
  });

  let localPresignatureHandle: string | null = null;
  let localBigR33: Uint8Array | null = null;
  let serverPresignatureId: string | null = null;
  let serverBigRB64u: string | null = null;
  let serverDone = false;
  let clientStage: PresignProtocolStage = 'triples';
  let serverStage: PresignProtocolStage = init.stage || 'triples';
  let pendingClientOutgoing = [] as Uint8Array[];
  let pendingServerOutgoing = fromB64uMessages(init.outgoingMessagesB64u);
  let shouldAbortLocalSession = true;
  let keepLocalMaterial = false;

  try {
    const localInit = await args.clientSigningMaterial.initClientPresignSession({
      sessionId: localSessionId,
      groupPublicKey33: args.groupPublicKey33,
      ceremonyExpiresAtMs,
      materialExpiresAtMs,
      poolIdentity,
      workerCtx: args.workerCtx,
    });
    clientStage = localInit.stage;
    pendingClientOutgoing = [...localInit.outgoingMessages];
    if (localInit.presignatureHandle && localInit.presignatureBigR33) {
      localPresignatureHandle = localInit.presignatureHandle;
      localBigR33 = localInit.presignatureBigR33;
    }

    for (let i = 0; i < MAX_HANDSHAKE_STEPS; i++) {
      if (pendingServerOutgoing.length > 0 && !localPresignatureHandle) {
        const localStepped = await args.clientSigningMaterial.stepClientPresignSession({
          sessionId: localSessionId,
          stage: resolvePresignExchangeStage({ clientStage, serverStage }),
          incomingMessages: pendingServerOutgoing,
          workerCtx: args.workerCtx,
        });
        clientStage = localStepped.stage;
        pendingServerOutgoing = [];
        pendingClientOutgoing.push(...localStepped.outgoingMessages);
        if (localStepped.presignatureHandle && localStepped.presignatureBigR33) {
          localPresignatureHandle = localStepped.presignatureHandle;
          localBigR33 = localStepped.presignatureBigR33;
        }
      }

      if (!serverDone) {
        const roundStartedAt = performance.now();
        const stepArgs = {
          relayerUrl: args.relayerUrl,
          presignSessionId,
          ceremonyExpiresAtMs,
          materialExpiresAtMs,
          stage: resolvePresignExchangeStage({ clientStage, serverStage }),
          outgoingMessagesB64u: toB64uMessages(pendingClientOutgoing),
          credential: args.credential,
          requestTag: args.requestTag,
          ...ecdsaPoolFillAuthorization(args),
        } as const;
        const stepped = await routerAbEcdsaDerivationPresignaturePoolFillStep(stepArgs);
        emitSigningSessionFlowTrace('evm-family', {
          event: 'ecdsa_presignature_round',
          requestTag: args.requestTag,
          presignSessionId,
          authorization: args.authorization.kind,
          round: i,
          stage: stepArgs.stage,
          durationMs: performance.now() - roundStartedAt,
          outcome: stepped.ok ? 'succeeded' : 'failed',
        });
        pendingClientOutgoing = [];
        if (!stepped.ok) {
          return {
            ok: false,
            code: stepped.code || 'presign_step_failed',
            message: stepped.message || 'Router A/B ECDSA derivation pool-fill step failed',
          };
        }
        pendingServerOutgoing = fromB64uMessages(stepped.outgoingMessagesB64u);
        serverStage = stepped.stage || serverStage;
        if (stepped.event === 'presign_done') {
          serverPresignatureId = String(stepped.presignatureId || '').trim() || null;
          serverBigRB64u = String(stepped.bigRB64u || '').trim() || null;
          serverDone = true;
        }
      }

      if (localPresignatureHandle && localBigR33 && serverPresignatureId && serverBigRB64u) {
        break;
      }

      if (
        !pendingServerOutgoing.length &&
        !pendingClientOutgoing.length &&
        !localPresignatureHandle
      ) {
        const localStepped = await args.clientSigningMaterial.stepClientPresignSession({
          sessionId: localSessionId,
          stage: resolvePresignExchangeStage({ clientStage, serverStage }),
          incomingMessages: [],
          workerCtx: args.workerCtx,
        });
        clientStage = localStepped.stage;
        pendingClientOutgoing.push(...localStepped.outgoingMessages);
        if (localStepped.presignatureHandle && localStepped.presignatureBigR33) {
          localPresignatureHandle = localStepped.presignatureHandle;
          localBigR33 = localStepped.presignatureBigR33;
        }
      }
    }

    if (!localPresignatureHandle || !localBigR33) {
      return {
        ok: false,
        code: 'presign_timeout',
        message: 'Client presign session did not reach done state',
      };
    }
    if (!serverPresignatureId || !serverBigRB64u) {
      return {
        ok: false,
        code: 'presign_timeout',
        message: 'Server presign session did not reach done state',
      };
    }
    if (localBigR33.length !== 33) {
      return {
        ok: false,
        code: 'internal',
        message: `Invalid local presignature bigR bytes (expected 33, got ${localBigR33.length})`,
      };
    }

    try {
      const createdAtMs = Date.now();
      const localBigRB64u = base64UrlEncode(localBigR33);
      if (localBigRB64u !== serverBigRB64u) {
        return {
          ok: false,
          code: 'presign_mismatch',
          message: 'Client/server presignature mismatch (bigR mismatch)',
        };
      }

      const admission = await args.clientSigningMaterial.admitClientPresignature({
        materialHandle: localPresignatureHandle,
        expectedPresignatureId: serverPresignatureId,
        poolIdentity,
        admissionMode: args.authorization.kind === 'operation_step_up' ? 'resident' : 'durable',
        workerCtx: args.workerCtx,
      });
      if (admission.kind === 'discarded_capacity') {
        return {
          ok: false,
          code: 'pool_full',
          message: 'Router A/B ECDSA derivation client presignature pool is full',
        };
      }
      if (admission.kind === 'discarded_ambiguous') {
        return {
          ok: false,
          code: 'presign_failed',
          message: 'Router A/B ECDSA derivation client presignature admission was ambiguous',
        };
      }

      keepLocalMaterial = true;
      shouldAbortLocalSession = false;
      return {
        ok: true,
        presignature: {
          presignatureId: serverPresignatureId,
          bigRB64u: localBigRB64u,
          materialHandle: localPresignatureHandle,
          createdAtMs,
          expiresAtMs: materialExpiresAtMs,
        },
      };
    } finally {
      zeroizeBytes(localBigR33);
    }
  } catch (e: unknown) {
    const msg = String(
      e && typeof e === 'object' && 'message' in e
        ? (e as { message?: unknown }).message
        : e || 'Router A/B ECDSA derivation pool-fill handshake failed',
    );
    return { ok: false, code: 'presign_failed', message: msg };
  } finally {
    emitSigningSessionFlowTrace('evm-family', {
      event: 'ecdsa_presignature_generation',
      requestTag: args.requestTag,
      presignSessionId,
      authorization: args.authorization.kind,
      durationMs: performance.now() - handshakeStartedAt,
      outcome: keepLocalMaterial ? 'available' : 'failed',
    });
    zeroizeBytes(localBigR33);
    if (!keepLocalMaterial && localPresignatureHandle) {
      await args.clientSigningMaterial
        .destroyClientPresignature({
          materialHandle: localPresignatureHandle,
          poolIdentity,
          workerCtx: args.workerCtx,
        })
        .catch(() => {});
    }
    if (shouldAbortLocalSession) {
      await args.clientSigningMaterial
        .abortClientPresignSession({
          sessionId: localSessionId,
          workerCtx: args.workerCtx,
        })
        .catch(() => {});
    }
  }
}

function isRetryablePoolFillStale(result: RouterAbEcdsaDerivationCoordinatorError): boolean {
  return result.code === 'stale_session_state' || result.code === 'stale_pool_fill_session';
}

function routerAbEcdsaDerivationSigningIdentityFromScope(
  scope: RouterAbEcdsaDerivationNormalSigningScopeV1,
): {
  ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  clientVerifyingShareB64u: EcdsaClientVerifyingShareB64u;
  thresholdEcdsaPublicKeyB64u: string;
} {
  const parsed = parseRouterAbEcdsaDerivationNormalSigningScopeV1(scope);
  return {
    ecdsaThresholdKeyId: parseEcdsaThresholdKeyId(parsed.ecdsa_threshold_key_id),
    clientVerifyingShareB64u: parseEcdsaClientVerifyingShareB64u(
      parsed.public_identity.derivation_client_share_public_key33_b64u,
    ),
    thresholdEcdsaPublicKeyB64u: parsed.public_identity.threshold_public_key33_b64u,
  };
}

function clientPresignatureExpiresAtMs(input: {
  serverExpiresAtMs: unknown;
  requestedExpiresAtMs: number;
}): number | null {
  const serverExpiresAtMs = Math.floor(Number(input.serverExpiresAtMs));
  const requestedExpiresAtMs = Math.floor(Number(input.requestedExpiresAtMs));
  if (
    !Number.isSafeInteger(serverExpiresAtMs) ||
    !Number.isSafeInteger(requestedExpiresAtMs) ||
    serverExpiresAtMs <= Date.now() ||
    serverExpiresAtMs > requestedExpiresAtMs
  ) {
    return null;
  }
  return serverExpiresAtMs;
}

function resolveSigningRequestExpiresAtMs(input: {
  authorizationExpiresAtMs?: number;
  materialExpiresAtMs: number;
  nowMs: number;
}): number | null {
  const materialExpiresAtMs = Math.floor(Number(input.materialExpiresAtMs));
  const authorizationExpiresAtMs = Number.isSafeInteger(input.authorizationExpiresAtMs)
    ? Math.floor(Number(input.authorizationExpiresAtMs))
    : input.nowMs + ROUTER_AB_ECDSA_DERIVATION_SIGNING_TTL_MS;
  const expiresAtMs = Math.min(
    materialExpiresAtMs,
    authorizationExpiresAtMs,
    input.nowMs + ROUTER_AB_ECDSA_DERIVATION_SIGNING_TTL_MS,
  );
  return Number.isSafeInteger(expiresAtMs) && expiresAtMs > input.nowMs ? expiresAtMs : null;
}

export async function signRouterAbEcdsaDerivationDigestWithPoolHit(
  args: {
    relayerUrl: string;
    scope: RouterAbEcdsaDerivationNormalSigningScopeV1;
    operationId: string;
    operationDigests: RouterAbEcdsaDerivationOperationDigestsV1Wire;
    materialActivation: RouterAbMpcMaterialActivationRefWire;
    credential: RouterAbOwnerNormalSigningCredential;
    signingDigest32: Uint8Array;
    clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
    expiresAtMs?: number;
    workerCtx: WorkerOperationContext;
  } & RouterAbEcdsaDerivationSigningAuthorization,
): Promise<RouterAbEcdsaDerivationCoordinatorResult> {
  return await signRouterAbEcdsaDerivationDigestWithPoolHitAttempt(args, 0);
}

async function signRouterAbEcdsaDerivationDigestWithPoolHitAttempt(
  args: {
    relayerUrl: string;
    scope: RouterAbEcdsaDerivationNormalSigningScopeV1;
    operationId: string;
    operationDigests: RouterAbEcdsaDerivationOperationDigestsV1Wire;
    materialActivation: RouterAbMpcMaterialActivationRefWire;
    credential: RouterAbOwnerNormalSigningCredential;
    signingDigest32: Uint8Array;
    clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
    expiresAtMs?: number;
    workerCtx: WorkerOperationContext;
  } & RouterAbEcdsaDerivationSigningAuthorization,
  retryCount: number,
): Promise<RouterAbEcdsaDerivationCoordinatorResult> {
  let poolKey: string | null = null;
  let poolIdentity: EcdsaClientPresignPoolIdentity | null = null;
  let foregroundStarted = false;
  let presignature: RouterAbEcdsaDerivationClientPresignatureRef | null = null;
  let clientSignatureShare32: Uint8Array | null = null;
  let clientRerandomizationContribution32: Uint8Array | null = null;
  let clientPresignatureCleanupState: ClientPresignatureCleanupState = { kind: 'unclaimed' };
  let poolGeneration: number | null = null;
  let preparationState: RouterAbEcdsaDerivationSigningPreparationState = {
    kind: 'before_prepare',
  };
  try {
    const relayerUrl = String(args.relayerUrl || '')
      .trim()
      .replace(/\/+$/g, '');
    if (!relayerUrl) {
      return {
        ok: false,
        code: 'invalid_args',
        message: 'Missing relayerUrl for Router A/B ECDSA derivation signing',
      };
    }
    const signingIdentity = routerAbEcdsaDerivationSigningIdentityFromScope(args.scope);
    const ecdsaThresholdKeyId = signingIdentity.ecdsaThresholdKeyId;
    if (!ecdsaThresholdKeyId) {
      return {
        ok: false,
        code: 'invalid_args',
        message: 'Missing ecdsaThresholdKeyId for Router A/B ECDSA derivation signing',
      };
    }
    const clientVerifyingShareB64u = signingIdentity.clientVerifyingShareB64u;
    if (!clientVerifyingShareB64u) {
      return {
        ok: false,
        code: 'invalid_args',
        message: 'Missing clientVerifyingShareB64u for Router A/B ECDSA derivation signing',
      };
    }
    if (!(args.signingDigest32 instanceof Uint8Array) || args.signingDigest32.length !== 32) {
      return {
        ok: false,
        code: 'invalid_args',
        message: 'signingDigest32 must be 32 bytes for Router A/B ECDSA derivation signing',
      };
    }
    const publicKeyStartedAt = performance.now();
    const groupPublicKey33 = await resolveGroupPublicKey33({
      clientVerifyingShareB64u,
      thresholdEcdsaPublicKeyB64u: signingIdentity.thresholdEcdsaPublicKeyB64u,
      workerCtx: args.workerCtx,
    });

    emitEcdsaSigningTiming(args.operationId, 'public_key_validation', publicKeyStartedAt);

    poolIdentity = makeClientPresignPoolIdentity({
      relayerUrl,
      scope: args.scope,
      materialActivation: args.materialActivation,
    });
    poolKey = ecdsaClientPresignPoolKey(poolIdentity);
    clientPresignaturePoolIdentityByPoolKey.set(poolKey, poolIdentity);
    startForegroundSign(poolKey);
    foregroundStarted = true;
    poolGeneration = getClientPresignaturePoolGeneration(poolKey);

    const lookupStartedAt = performance.now();
    presignature = await takeClientPresignature({
      poolKey,
      poolIdentity,
      clientSigningMaterial: args.clientSigningMaterial,
      workerCtx: args.workerCtx,
    });
    emitEcdsaSigningTiming(args.operationId, 'pool_lookup', lookupStartedAt);
    if (!presignature) {
      const restoreStartedAt = performance.now();
      await hydrateClientPresignaturePool({
        poolKey,
        poolIdentity,
        clientSigningMaterial: args.clientSigningMaterial,
        workerCtx: args.workerCtx,
        generation: poolGeneration,
      });
      emitEcdsaSigningTiming(args.operationId, 'pool_restore', restoreStartedAt);
      poolGeneration = getClientPresignaturePoolGeneration(poolKey);
      presignature = await takeClientPresignature({
        poolKey,
        poolIdentity,
        clientSigningMaterial: args.clientSigningMaterial,
        workerCtx: args.workerCtx,
      });
    }
    if (!presignature) {
      const refillWaitStartedAt = performance.now();
      await waitForAvailablePresignatureFromInFlightRefill(poolKey);
      emitEcdsaSigningTiming(args.operationId, 'refill_wait', refillWaitStartedAt);
      poolGeneration = getClientPresignaturePoolGeneration(poolKey);
      presignature = await takeClientPresignature({
        poolKey,
        poolIdentity,
        clientSigningMaterial: args.clientSigningMaterial,
        workerCtx: args.workerCtx,
      });
    }
    emitSigningSessionFlowTrace('evm-family', {
      event: 'ecdsa_presignature_selection',
      operationId: args.operationId,
      authorization: args.authorization.kind,
      outcome: presignature ? 'available' : 'empty',
      remainingDepth: getClientPresignaturePoolDepth(poolKey),
      attempt: retryCount,
    });
    if (!presignature) {
      return {
        ok: false,
        code: 'pool_empty',
        message: 'Router A/B ECDSA derivation client presignature pool is empty',
      };
    }

    const nowMs = Date.now();
    const expiresAtMs = resolveSigningRequestExpiresAtMs({
      authorizationExpiresAtMs: args.expiresAtMs,
      materialExpiresAtMs: presignature.expiresAtMs,
      nowMs,
    });
    if (!expiresAtMs) {
      return {
        ok: false,
        code: 'pool_entry_expired',
        message: 'Router A/B ECDSA derivation client presignature is expired',
      };
    }
    if (poolGeneration !== getClientPresignaturePoolGeneration(poolKey)) {
      return {
        ok: false,
        code: 'pool_entry_unavailable',
        message:
          'Router A/B ECDSA derivation client presignature pool was invalidated before prepare',
      };
    }
    clientRerandomizationContribution32 = secureRerandomizationContribution32();
    const clientRerandomizationCommitment32 = await routerAbEcdsaRerandomizationClientCommitmentV1(
      clientRerandomizationContribution32,
    );
    const prepareRequest = buildRouterAbEcdsaDerivationEvmDigestSigningRequestV1({
      scope: args.scope,
      requestId: secureRandomId(
        'router-ab-ecdsa-sign',
        32,
        'Router A/B ECDSA derivation sign request',
      ),
      operationId: args.operationId,
      operationDigests: args.operationDigests,
      authorization: args.authorization,
      materialActivation: args.materialActivation,
      clientPresignatureId: presignature.presignatureId,
      expiresAtMs,
      signingDigest32: args.signingDigest32,
      clientRerandomizationCommitment32,
    });
    zeroizeBytes(clientRerandomizationCommitment32);
    const reservationId = secureRandomId(
      'router-ab-ecdsa-reservation',
      32,
      'Router A/B ECDSA Client presignature reservation',
    );
    clientPresignatureCleanupState = { kind: 'destroy' };
    const reserveStartedAt = performance.now();
    const reservation = await args.clientSigningMaterial.reserveClientPresignature({
      materialHandle: presignature.materialHandle,
      expectedPresignatureId: presignature.presignatureId,
      poolIdentity,
      requestBinding: prepareRequest.request_id,
      reservationId,
      leaseExpiresAtMs: prepareRequest.expires_at_ms,
      workerCtx: args.workerCtx,
    });
    emitEcdsaSigningTiming(args.operationId, 'presignature_reserve', reserveStartedAt);
    if (reservation.kind === 'unavailable') {
      if (reservation.reason === 'claimed_elsewhere') {
        clientPresignatureCleanupState = { kind: 'owned_elsewhere' };
      }
      if (retryCount < MAX_CLIENT_PRESIGNATURE_CLAIM_RETRIES) {
        return await signRouterAbEcdsaDerivationDigestWithPoolHitAttempt(args, retryCount + 1);
      }
      return {
        ok: false,
        code: reservation.reason === 'expired' ? 'pool_entry_expired' : 'pool_entry_unavailable',
        message: `Router A/B ECDSA derivation client presignature is unavailable: ${reservation.reason}`,
      };
    }
    if (poolGeneration !== getClientPresignaturePoolGeneration(poolKey)) {
      return {
        ok: false,
        code: 'pool_entry_unavailable',
        message:
          'Router A/B ECDSA derivation client presignature pool was invalidated before prepare',
      };
    }
    preparationState = { kind: 'prepare_submitted' };
    const prepareStartedAt = performance.now();
    const prepareResponse = await prepareRouterAbEcdsaDerivationEvmDigestSigningV1({
      relayServerUrl: relayerUrl,
      credential: args.credential,
      request: prepareRequest,
      onServerTiming: emitEcdsaServerTiming.bind(undefined, args.operationId, 'prepare'),
    });
    emitEcdsaSigningTiming(args.operationId, 'prepare', prepareStartedAt);
    if (prepareResponse.server_big_r33_b64u !== presignature.bigRB64u) {
      return {
        ok: false,
        code: 'presign_mismatch',
        message: 'Router A/B ECDSA derivation SigningWorker returned a different presignature bigR',
      };
    }
    const commitStartedAt = performance.now();
    await args.clientSigningMaterial.commitClientPresignature({
      materialHandle: presignature.materialHandle,
      poolIdentity,
      requestBinding: prepareRequest.request_id,
      reservationId,
      workerCtx: args.workerCtx,
    });

    emitEcdsaSigningTiming(args.operationId, 'presignature_commit', commitStartedAt);

    const bigR33 = base64UrlDecode(presignature.bigRB64u);
    const signingWorkerRerandomizationContribution32 = base64UrlDecode(
      prepareResponse.signing_worker_rerandomization_contribution32_b64u,
    );
    try {
      if (bigR33.length !== 33) {
        return {
          ok: false,
          code: 'internal',
          message: 'Router A/B ECDSA derivation presign bigR must decode to 33 bytes',
        };
      }
      if (signingWorkerRerandomizationContribution32.length !== 32) {
        return {
          ok: false,
          code: 'internal',
          message:
            'Router A/B ECDSA derivation SigningWorker rerandomization contribution must decode to 32 bytes',
        };
      }

      const shareStartedAt = performance.now();
      clientSignatureShare32 =
        await args.clientSigningMaterial.computeSignatureShareFromPresignatureHandle({
          materialHandle: presignature.materialHandle,
          poolIdentity,
          requestBinding: prepareRequest.request_id,
          reservationId,
          groupPublicKey33,
          expectedPresignBigR33: bigR33,
          digest32: args.signingDigest32,
          clientRerandomizationContribution32,
          signingWorkerRerandomizationContribution32,
          workerCtx: args.workerCtx,
        });
      emitEcdsaSigningTiming(args.operationId, 'client_share', shareStartedAt);
      clientPresignatureCleanupState = { kind: 'consumed' };
    } finally {
      zeroizeBytes(bigR33);
      zeroizeBytes(signingWorkerRerandomizationContribution32);
    }

    if (clientSignatureShare32.length !== 32) {
      return {
        ok: false,
        code: 'internal',
        message: `Invalid Router A/B ECDSA derivation client signature share length (expected 32, got ${clientSignatureShare32.length})`,
      };
    }

    const finalizeRequest = buildRouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1({
      scope: args.scope,
      requestId: prepareRequest.request_id,
      operationId: prepareRequest.operation_id,
      operationDigests: prepareRequest.operation_digests,
      authorization: args.authorization,
      materialActivation: args.materialActivation,
      expiresAtMs: prepareRequest.expires_at_ms,
      signingDigest32: args.signingDigest32,
      serverPresignatureId: prepareResponse.server_presignature_id,
      clientSignatureShare32,
      clientRerandomizationContribution32,
    });
    const finalizeStartedAt = performance.now();
    const finalized = await finalizeRouterAbEcdsaDerivationEvmDigestSigningV1({
      relayServerUrl: relayerUrl,
      credential: args.credential,
      request: finalizeRequest,
      onServerTiming: emitEcdsaServerTiming.bind(undefined, args.operationId, 'finalize'),
    });
    emitEcdsaSigningTiming(args.operationId, 'finalize', finalizeStartedAt);
    const signature65 = base64UrlDecode(finalized.signature65_b64u);
    if (signature65.length !== 65) {
      return {
        ok: false,
        code: 'internal',
        message: `Router A/B ECDSA derivation returned invalid signature length (expected 65, got ${signature65.length})`,
      };
    }
    try {
      const verifyStartedAt = performance.now();
      await verifySecp256k1RecoverableSignatureAgainstPublicKey33Wasm({
        digest32: args.signingDigest32,
        signature65,
        publicKey33: groupPublicKey33,
        workerCtx: args.workerCtx,
      });
      emitEcdsaSigningTiming(args.operationId, 'signature_verify', verifyStartedAt);
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'internal',
        message: `Router A/B ECDSA derivation returned a signature that does not recover to the threshold group public key: ${recoverableSignatureErrorMessage(error)}`,
      };
    }
    return {
      ok: true,
      signature65,
      signature65B64u: finalized.signature65_b64u,
      rB64u: base64UrlEncode(signature65.slice(0, 32)),
      sB64u: base64UrlEncode(signature65.slice(32, 64)),
      recId: signature65[64],
    };
  } catch (e: unknown) {
    const msg = String(
      e && typeof e === 'object' && 'message' in e
        ? (e as { message?: unknown }).message
        : e || 'Router A/B ECDSA derivation signing failed',
    );
    if (e instanceof RouterAbSigningRequestError && e.code === 'expired_local_request') {
      return { ok: false, code: 'pool_entry_expired', message: msg };
    }
    if (
      poolKey &&
      poolIdentity &&
      poolGeneration !== null &&
      preparationState.kind === 'before_prepare' &&
      getClientPresignaturePoolGeneration(poolKey) !== poolGeneration
    ) {
      await invalidateClientPresignaturePool({
        poolKey,
        poolIdentity,
        clientSigningMaterial: args.clientSigningMaterial,
        workerCtx: args.workerCtx,
      });
      return {
        ok: false,
        code: 'pool_entry_unavailable',
        message:
          'Router A/B ECDSA derivation client presignature pool was invalidated before prepare',
      };
    }
    return { ok: false, code: 'router_ab_sign_failed', message: msg };
  } finally {
    zeroizeBytes(clientSignatureShare32);
    zeroizeBytes(clientRerandomizationContribution32);
    if (
      presignature &&
      poolIdentity &&
      clientPresignatureCleanupState.kind !== 'consumed' &&
      clientPresignatureCleanupState.kind !== 'owned_elsewhere'
    ) {
      let retainedUnclaimedEntry = false;
      if (
        clientPresignatureCleanupState.kind === 'unclaimed' &&
        poolKey &&
        poolGeneration !== null &&
        poolGeneration === getClientPresignaturePoolGeneration(poolKey)
      ) {
        const pushResult = pushClientPresignature(poolKey, poolIdentity, presignature);
        retainedUnclaimedEntry = pushResult === 'stored' || pushResult === 'duplicate';
      }
      if (!retainedUnclaimedEntry) {
        await args.clientSigningMaterial
          .destroyClientPresignature({
            materialHandle: presignature.materialHandle,
            poolIdentity,
            workerCtx: args.workerCtx,
          })
          .catch(() => {});
      }
    }
    if (poolKey && foregroundStarted) finishForegroundSign(poolKey);
  }
}

export async function signRouterAbEcdsaDerivationDigestWithPool(
  args: {
    relayerUrl: string;
    scope: RouterAbEcdsaDerivationNormalSigningScopeV1;
    operationId: string;
    operationDigests: RouterAbEcdsaDerivationOperationDigestsV1Wire;
    materialActivation: RouterAbMpcMaterialActivationRefWire;
    credential: RouterAbOwnerNormalSigningCredential;
    keyHandle: EcdsaKeyHandle;
    signingDigest32: Uint8Array;
    clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
    expiresAtMs: number;
    workerCtx: WorkerOperationContext;
  } & RouterAbEcdsaDerivationSigningAuthorization,
): Promise<RouterAbEcdsaDerivationCoordinatorResult> {
  const signingIdentity = routerAbEcdsaDerivationSigningIdentityFromScope(args.scope);
  const expiresAtMs = Math.floor(Number(args.expiresAtMs));
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) {
    return {
      ok: false,
      code: 'invalid_pool_fill_expiry',
      message: 'Router A/B ECDSA derivation pool fill expiry is unavailable or expired',
    };
  }
  const firstAttempt = await signRouterAbEcdsaDerivationDigestWithPoolHit({
    relayerUrl: args.relayerUrl,
    scope: args.scope,
    operationId: args.operationId,
    operationDigests: args.operationDigests,
    materialActivation: args.materialActivation,
    credential: args.credential,
    signingDigest32: args.signingDigest32,
    clientSigningMaterial: args.clientSigningMaterial,
    expiresAtMs,
    workerCtx: args.workerCtx,
    ...ecdsaPoolFillAuthorization(args),
  });
  if (
    firstAttempt.ok ||
    (firstAttempt.code !== 'pool_empty' &&
      firstAttempt.code !== 'pool_entry_expired' &&
      firstAttempt.code !== 'pool_entry_unavailable')
  ) {
    return firstAttempt;
  }

  const refillInput: RouterAbEcdsaDerivationClientPresignatureRefillInput = {
    relayerUrl: args.relayerUrl,
    keyHandle: args.keyHandle,
    ecdsaThresholdKeyId: signingIdentity.ecdsaThresholdKeyId,
    clientVerifyingShareB64u: signingIdentity.clientVerifyingShareB64u,
    clientSigningMaterial: args.clientSigningMaterial,
    thresholdEcdsaPublicKeyB64u: signingIdentity.thresholdEcdsaPublicKeyB64u,
    credential: args.credential,
    materialActivation: args.materialActivation,
    routerAbEcdsaDerivationPoolFill: {
      kind: 'router_ab_ecdsa_derivation_signing_worker_pool',
      scope: args.scope,
      ceremonyExpiresAtMs: expiresAtMs,
      materialExpiresAtMs:
        args.authorization.kind === 'operation_step_up'
          ? expiresAtMs
          : Date.now() + MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS,
    },
    workerCtx: args.workerCtx,
    ...ecdsaPoolFillAuthorization(args),
  };
  emitSigningSessionFlowTrace('evm-family', {
    event: 'ecdsa_foreground_refill',
    operationId: args.operationId,
    authorization: args.authorization.kind,
    reason: firstAttempt.code,
  });
  const refillStartedAt = performance.now();
  let refill = await refillRouterAbEcdsaDerivationClientPresignaturePool({
    ...refillInput,
    trafficClass: 'foreground',
  });
  if (!refill.ok && refill.code === 'invalidated') {
    refill = await refillRouterAbEcdsaDerivationClientPresignaturePool({
      ...refillInput,
      trafficClass: 'foreground',
    });
  }
  emitEcdsaSigningTiming(
    args.operationId,
    'foreground_refill',
    refillStartedAt,
    refill.ok ? 'succeeded' : 'failed',
  );
  if (!refill.ok) return refill;

  return await signRouterAbEcdsaDerivationDigestWithPoolHit({
    relayerUrl: args.relayerUrl,
    scope: args.scope,
    operationId: args.operationId,
    operationDigests: args.operationDigests,
    materialActivation: args.materialActivation,
    credential: args.credential,
    signingDigest32: args.signingDigest32,
    clientSigningMaterial: args.clientSigningMaterial,
    expiresAtMs,
    workerCtx: args.workerCtx,
    ...ecdsaPoolFillAuthorization(args),
  });
}

export async function refillRouterAbEcdsaDerivationClientPresignaturePool(
  args: RouterAbEcdsaDerivationClientPresignatureRefillInput & {
    trafficClass: 'foreground' | 'background';
  },
): Promise<{ ok: true; presignatureId: string } | RouterAbEcdsaDerivationCoordinatorError> {
  try {
    const poolIdentity = makeClientPresignPoolIdentity({
      relayerUrl: args.relayerUrl,
      scope: args.routerAbEcdsaDerivationPoolFill.scope,
      materialActivation: args.materialActivation,
    });
    const poolKey = ecdsaClientPresignPoolKey(poolIdentity);
    await destroyExpiredClientPresignatures({
      poolKey,
      poolIdentity,
      clientSigningMaterial: args.clientSigningMaterial,
      workerCtx: args.workerCtx,
    });
    const startedGeneration = getClientPresignaturePoolGeneration(poolKey);
    const groupPublicKey33 = await resolveGroupPublicKey33({
      clientVerifyingShareB64u: args.clientVerifyingShareB64u,
      thresholdEcdsaPublicKeyB64u: args.thresholdEcdsaPublicKeyB64u,
      relayerVerifyingShareB64u: args.relayerVerifyingShareB64u,
      workerCtx: args.workerCtx,
    });
    const generated = await runPresignHandshake({
      relayerUrl: args.relayerUrl,
      poolFillInitKeySelector: { keyHandle: formatEcdsaKeyHandleForWire(args.keyHandle) },
      clientSigningMaterial: args.clientSigningMaterial,
      groupPublicKey33,
      materialActivation: args.materialActivation,
      credential: args.credential,
      requestTag:
        args.trafficClass === 'foreground'
          ? 'foreground_presign_pool_refill'
          : 'background_presign_pool_refill',
      routerAbEcdsaDerivationPoolFill: args.routerAbEcdsaDerivationPoolFill,
      workerCtx: args.workerCtx,
      ...ecdsaPoolFillAuthorization(args),
    });
    if (!generated.ok) return generated;

    if (getClientPresignaturePoolGeneration(poolKey) !== startedGeneration) {
      await args.clientSigningMaterial
        .destroyClientPresignature({
          materialHandle: generated.presignature.materialHandle,
          poolIdentity,
          workerCtx: args.workerCtx,
        })
        .catch(() => {});
      return {
        ok: false,
        code: 'invalidated',
        message: 'Router A/B ECDSA derivation presignature pool invalidated',
      };
    }
    const pushResult = pushClientPresignature(poolKey, poolIdentity, generated.presignature);
    if (pushResult === 'capacity_full' || pushResult === 'invalid') {
      await args.clientSigningMaterial
        .destroyClientPresignature({
          materialHandle: generated.presignature.materialHandle,
          poolIdentity,
          workerCtx: args.workerCtx,
        })
        .catch(() => {});
    }
    return { ok: true, presignatureId: generated.presignature.presignatureId };
  } catch (e: unknown) {
    const msg = String(
      e && typeof e === 'object' && 'message' in e
        ? (e as { message?: unknown }).message
        : e || 'Router A/B ECDSA derivation presignature refill failed',
    );
    return { ok: false, code: 'internal', message: msg };
  }
}
