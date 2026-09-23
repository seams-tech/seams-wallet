/** Passkey MPC warm-session material worker. */
import type {
  UserConfirmWorkerResponse,
  UserConfirmWorkerResponsePayload,
  WarmSessionSealAndPersistDiagnostics,
} from '@/core/types/secure-confirm-worker';
import { parseClearVolatileWarmMaterialCommand } from '@/core/signingEngine/session/warmCapabilities/volatileWarmMaterialCommands';
import { bytesToHex } from '../../chains/evm/bytes';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import {
  decodeSigningSessionSecret32,
  SIGNING_SESSION_SEAL_GROUP_ID,
  WALLET_SESSION_SEAL_BASE_PATH,
} from '@shared/utils/signingSessionSeal';
import { base64UrlEncode } from '@shared/utils/base64';
import {
  joinNormalizedUrl,
  normalizeNonNegativeInteger,
  normalizeOptionalTrimmedString,
  normalizeOptionalNonEmptyString,
  normalizePositiveInteger,
} from '@shared/utils/normalize';
import { getShamir3PassRuntime, warmupShamir3PassRuntime } from './shamir3pass/runtime';

import { ClientSealPreparations } from './shamir3pass/clientSealPreparation';
const clientSealPreparations = new ClientSealPreparations(getShamir3PassRuntime);

type WarmSessionMaterialEntry = {
  prfFirstHandle: string;
  expiresAtMs: number;
  remainingUses: number;
};

type PasskeyPrfFirstHandleEntry = {
  prfFirstB64u: string;
  expiresAtMs: number;
};

type PasskeyServerSealedSecretCacheEntry = {
  sealedSecretB64u: string;
  expiresAtMs: number;
};

type PasskeyServerSealedSecretCacheScope = {
  kind: 'passkey_registration';
  walletId: string;
  credentialIdB64u: string;
  walletSessionId: string;
  quotaId: string;
};

type OkResult = { ok: true; remainingUses: number; expiresAtMs: number };
type OkSealResult = OkResult & {
  sealedSecretB64u: string;
  keyVersion?: string;
  diagnostics?: WarmSessionSealAndPersistDiagnostics;
};
type OkDispenseResult = OkResult & { prfFirstB64u: string };
type ErrResult = { ok: false; code: string; message: string };
type WarmSessionMaterialReadResult =
  | ({ ok: true; entry: WarmSessionMaterialEntry; secret: PasskeyPrfFirstHandleEntry } & OkResult)
  | ErrResult;

const PASSKEY_SERVER_SEALED_SECRET_CACHE_MAX_ENTRIES = 32;

type SigningSessionSealTransport = {
  relayerUrl: string;
  walletSessionToken: string;
  keyVersion?: string;
  serverSealedSecretCacheScope?: PasskeyServerSealedSecretCacheScope;
};

type WarmSessionMaterialPutPayload = {
  thresholdSessionId: string;
  prfFirstB64u: string;
  expiresAtMs: number;
  remainingUses: number;
  transport?: SigningSessionSealTransport;
};

type WarmSessionStatusReadPayload = {
  thresholdSessionId: string;
};

type WarmSessionStatusBatchReadPayload = {
  thresholdSessionIds: string[];
};

type WarmSessionMaterialClaimPayload = {
  thresholdSessionId: string;
  uses: number;
  consume: boolean;
  curve?: 'ed25519' | 'ecdsa';
};

type WarmSessionMaterialConsumePayload = {
  thresholdSessionId: string;
  uses: number;
  curve?: 'ed25519' | 'ecdsa';
};

type WarmSessionSealAndPersistPayload = {
  thresholdSessionId: string;
  transport: SigningSessionSealTransport;
};

type WarmSessionRehydratePayload = {
  thresholdSessionId: string;
  sealedSecretB64u: string;
  expiresAtMs: number;
  remainingUses: number;
  keyVersion?: string;
  transport: SigningSessionSealTransport;
};

type SigningSessionSealRouteResult =
  | {
      ok: true;
      ciphertext: string;
      keyVersion?: string;
      expiresAtMs?: number;
      remainingUses?: number;
    }
  | ErrResult;

const warmSessionPrfHandleCache = new Map<string, WarmSessionMaterialEntry>();
const passkeyPrfFirstHandleStore = new Map<string, PasskeyPrfFirstHandleEntry>();
const passkeyServerSealedSecretCache = new Map<string, PasskeyServerSealedSecretCacheEntry>();
const signingSessionSealApplyInFlight = new Map<string, Promise<OkSealResult | ErrResult>>();
const signingSessionSealRemoveInFlight = new Map<string, Promise<OkResult | ErrResult>>();
const SIGNING_SESSION_SEAL_BASE_PATH = WALLET_SESSION_SEAL_BASE_PATH;
const SIGNING_SESSION_SEAL_ROUTE_TIMEOUT_MS = 15_000;

function abortSigningSessionSealRoute(controller: AbortController): void {
  controller.abort('timeout');
}

type PasskeyMpcSessionWorkerIncomingMessage =
  | { kind: 'ping'; id?: string }
  | { kind: 'prewarm'; id?: string }
  | {
      kind: 'prepare_client_seal';
      id?: string;
      payload: { preparationId: string; thresholdSessionId: string; prfFirstB64u: string } | null;
    }
  | {
      kind: 'discard_client_seal';
      id?: string;
      payload: { preparationId: string; thresholdSessionId: string } | null;
    }
  | {
      kind: 'read_client_seal';
      id?: string;
      payload: { preparationId: string; thresholdSessionId: string } | null;
    }
  | {
      kind: 'complete_client_seal';
      id?: string;
      payload: {
        preparationId: string;
        thresholdSessionId: string;
        transport: SigningSessionSealTransport;
        serverSeal: Extract<SigningSessionSealRouteResult, { ok: true }>;
      } | null;
    }
  | { kind: 'material_put'; id?: string; payload: WarmSessionMaterialPutPayload | null }
  | { kind: 'status_read'; id?: string; payload: WarmSessionStatusReadPayload | null }
  | { kind: 'status_batch_read'; id?: string; payload: WarmSessionStatusBatchReadPayload | null }
  | { kind: 'material_claim'; id?: string; payload: WarmSessionMaterialClaimPayload | null }
  | { kind: 'material_consume'; id?: string; payload: WarmSessionMaterialConsumePayload | null }
  | { kind: 'volatile_clear'; id?: string; payload: unknown }
  | { kind: 'volatile_clear_all'; id?: string; payload: unknown }
  | { kind: 'seal_and_persist'; id?: string; payload: WarmSessionSealAndPersistPayload | null }
  | { kind: 'rehydrate'; id?: string; payload: WarmSessionRehydratePayload | null }
  | { kind: 'unknown'; id?: string; type: unknown };

function parseSessionMessageId(value: unknown): string | undefined {
  return typeof value === 'string' ? normalizeOptionalTrimmedString(value) || undefined : undefined;
}

function parseSessionString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return normalizeOptionalTrimmedString(value) || null;
}

function parseSessionInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function parseSessionStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== value.length || keys.some((key) => !/^\d+$/.test(key))) return null;
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseSessionString(value[index]);
    if (!parsed) return null;
    output.push(parsed);
  }
  return output;
}

function parseClientSealPreparation(
  value: unknown,
): { preparationId: string; thresholdSessionId: string; prfFirstB64u: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (
    fields.length !== 3 ||
    !fields.includes('preparationId') ||
    !fields.includes('thresholdSessionId') ||
    !fields.includes('prfFirstB64u')
  )
    return null;
  const preparationId = parseSessionString(Reflect.get(value, 'preparationId'));
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  const prfFirstB64u = parseSessionString(Reflect.get(value, 'prfFirstB64u'));
  return preparationId && thresholdSessionId && prfFirstB64u
    ? { preparationId, thresholdSessionId, prfFirstB64u }
    : null;
}

function parseClientSealDiscard(
  value: unknown,
): { preparationId: string; thresholdSessionId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (
    fields.length !== 2 ||
    !fields.includes('preparationId') ||
    !fields.includes('thresholdSessionId')
  )
    return null;
  const preparationId = parseSessionString(Reflect.get(value, 'preparationId'));
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  return preparationId && thresholdSessionId ? { preparationId, thresholdSessionId } : null;
}

function parseClientSealCompletion(
  value: unknown,
): Extract<PasskeyMpcSessionWorkerIncomingMessage, { kind: 'complete_client_seal' }>['payload'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (
    fields.length !== 4 ||
    !fields.includes('preparationId') ||
    !fields.includes('thresholdSessionId') ||
    !fields.includes('transport') ||
    !fields.includes('serverSeal')
  ) {
    return null;
  }
  const preparationId = parseSessionString(Reflect.get(value, 'preparationId'));
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  const transport = parseSigningSessionSealTransport(Reflect.get(value, 'transport'));
  const serverSeal = parseSigningSessionSealRouteResult(Reflect.get(value, 'serverSeal'));
  if (!preparationId || !thresholdSessionId || !transport || !serverSeal.ok) return null;
  return { preparationId, thresholdSessionId, transport, serverSeal };
}

function parseWarmSessionMaterialPutPayload(value: unknown): WarmSessionMaterialPutPayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (
    fields.some(
      (field) =>
        ![
          'thresholdSessionId',
          'prfFirstB64u',
          'expiresAtMs',
          'remainingUses',
          'transport',
        ].includes(field),
    ) ||
    !['thresholdSessionId', 'prfFirstB64u', 'expiresAtMs', 'remainingUses'].every((field) =>
      fields.includes(field),
    )
  ) {
    return null;
  }
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  const prfFirstB64u = parseSessionString(Reflect.get(value, 'prfFirstB64u'));
  const expiresAtMs = parseSessionInteger(Reflect.get(value, 'expiresAtMs'));
  const remainingUses = parseSessionInteger(Reflect.get(value, 'remainingUses'));
  const hasTransport = fields.includes('transport');
  const transport = hasTransport
    ? parseSigningSessionSealTransport(Reflect.get(value, 'transport'))
    : undefined;
  if (
    !thresholdSessionId ||
    !prfFirstB64u ||
    expiresAtMs === null ||
    remainingUses === null ||
    (hasTransport && !transport)
  ) {
    return null;
  }
  return {
    thresholdSessionId,
    prfFirstB64u,
    expiresAtMs,
    remainingUses,
    ...(transport ? { transport } : {}),
  };
}

function parseWarmSessionStatusReadPayload(value: unknown): WarmSessionStatusReadPayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (fields.length !== 1 || fields[0] !== 'thresholdSessionId') return null;
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  return thresholdSessionId ? { thresholdSessionId } : null;
}

function parseWarmSessionStatusBatchReadPayload(
  value: unknown,
): WarmSessionStatusBatchReadPayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (fields.length !== 1 || fields[0] !== 'thresholdSessionIds') return null;
  const thresholdSessionIds = parseSessionStringArray(Reflect.get(value, 'thresholdSessionIds'));
  return thresholdSessionIds ? { thresholdSessionIds } : null;
}

function parseWarmSessionMaterialClaimPayload(
  value: unknown,
): WarmSessionMaterialClaimPayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (
    fields.some((field) => !['thresholdSessionId', 'uses', 'consume', 'curve'].includes(field)) ||
    !fields.includes('thresholdSessionId')
  ) {
    return null;
  }
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  const hasUses = fields.includes('uses');
  const uses = hasUses ? parseSessionInteger(Reflect.get(value, 'uses')) : 1;
  const hasConsume = fields.includes('consume');
  const consume = hasConsume ? Reflect.get(value, 'consume') : true;
  const hasCurve = fields.includes('curve');
  const curve = hasCurve ? Reflect.get(value, 'curve') : undefined;
  if (
    !thresholdSessionId ||
    uses === null ||
    uses < 1 ||
    typeof consume !== 'boolean' ||
    (curve !== undefined && curve !== 'ed25519' && curve !== 'ecdsa')
  ) {
    return null;
  }
  return {
    thresholdSessionId,
    uses,
    consume,
    ...(curve !== undefined ? { curve } : {}),
  };
}

function parseWarmSessionMaterialConsumePayload(
  value: unknown,
): WarmSessionMaterialConsumePayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (
    fields.some((field) => !['thresholdSessionId', 'uses', 'curve'].includes(field)) ||
    !fields.includes('thresholdSessionId')
  ) {
    return null;
  }
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  const hasUses = fields.includes('uses');
  const uses = hasUses ? parseSessionInteger(Reflect.get(value, 'uses')) : 1;
  const hasCurve = fields.includes('curve');
  const curve = hasCurve ? Reflect.get(value, 'curve') : undefined;
  if (
    !thresholdSessionId ||
    uses === null ||
    uses < 1 ||
    (curve !== undefined && curve !== 'ed25519' && curve !== 'ecdsa')
  ) {
    return null;
  }
  return {
    thresholdSessionId,
    uses,
    ...(curve !== undefined ? { curve } : {}),
  };
}

function parseWarmSessionSealAndPersistPayload(
  value: unknown,
): WarmSessionSealAndPersistPayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (
    fields.length !== 2 ||
    !fields.includes('thresholdSessionId') ||
    !fields.includes('transport')
  ) {
    return null;
  }
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  const transport = parseSigningSessionSealTransport(Reflect.get(value, 'transport'));
  return thresholdSessionId && transport ? { thresholdSessionId, transport } : null;
}

function parseWarmSessionRehydratePayload(value: unknown): WarmSessionRehydratePayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  const requiredFields = [
    'thresholdSessionId',
    'sealedSecretB64u',
    'expiresAtMs',
    'remainingUses',
    'transport',
  ];
  if (
    fields.some((field) => ![...requiredFields, 'signingSessionSealKeyVersion'].includes(field)) ||
    requiredFields.some((field) => !fields.includes(field))
  ) {
    return null;
  }
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  const sealedSecretB64u = parseSessionString(Reflect.get(value, 'sealedSecretB64u'));
  const expiresAtMs = parseSessionInteger(Reflect.get(value, 'expiresAtMs'));
  const remainingUses = parseSessionInteger(Reflect.get(value, 'remainingUses'));
  const transport = parseSigningSessionSealTransport(Reflect.get(value, 'transport'));
  const hasKeyVersion = fields.includes('signingSessionSealKeyVersion');
  const keyVersion = hasKeyVersion
    ? parseSessionString(Reflect.get(value, 'signingSessionSealKeyVersion'))
    : undefined;
  if (
    !thresholdSessionId ||
    !sealedSecretB64u ||
    expiresAtMs === null ||
    remainingUses === null ||
    !transport ||
    (hasKeyVersion && !keyVersion)
  ) {
    return null;
  }
  return {
    thresholdSessionId,
    sealedSecretB64u,
    expiresAtMs,
    remainingUses,
    ...(keyVersion ? { keyVersion } : {}),
    transport,
  };
}

function parsePasskeyMpcSessionWorkerMessage(
  value: unknown,
): PasskeyMpcSessionWorkerIncomingMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'unknown', type: undefined };
  }
  const fields = Object.keys(value);
  if (
    fields.some((field) => !['id', 'type', 'payload'].includes(field)) ||
    !fields.includes('type')
  ) {
    return { kind: 'unknown', type: Reflect.get(value, 'type') };
  }
  const id = fields.includes('id') ? parseSessionMessageId(Reflect.get(value, 'id')) : undefined;
  if (fields.includes('id') && id === undefined) {
    return { kind: 'unknown', type: Reflect.get(value, 'type') };
  }
  const type = Reflect.get(value, 'type');
  const hasPayload = fields.includes('payload');
  const payload = hasPayload ? Reflect.get(value, 'payload') : undefined;
  switch (type) {
    case 'PING':
      return fields.length === (fields.includes('id') ? 2 : 1)
        ? { kind: 'ping', ...(id ? { id } : {}) }
        : { kind: 'unknown', id, type };
    case 'PREWARM_SHAMIR3PASS':
      if (
        !hasPayload ||
        payload === null ||
        typeof payload !== 'object' ||
        Array.isArray(payload)
      ) {
        return { kind: 'unknown', id, type };
      }
      if (Object.keys(payload).length !== 0) return { kind: 'unknown', id, type };
      return { kind: 'prewarm', ...(id ? { id } : {}) };
    case 'PREPARE_SESSION_CLIENT_SEAL':
      return { kind: 'prepare_client_seal', id, payload: parseClientSealPreparation(payload) };
    case 'READ_SESSION_CLIENT_SEAL':
      return { kind: 'read_client_seal', id, payload: parseClientSealDiscard(payload) };
    case 'COMPLETE_SESSION_CLIENT_SEAL':
      return { kind: 'complete_client_seal', id, payload: parseClientSealCompletion(payload) };
    case 'DISCARD_SESSION_CLIENT_SEAL':
      return { kind: 'discard_client_seal', id, payload: parseClientSealDiscard(payload) };
    case 'WARM_SESSION_MATERIAL_PUT':
      return {
        kind: 'material_put',
        ...(id ? { id } : {}),
        payload: hasPayload ? parseWarmSessionMaterialPutPayload(payload) : null,
      };
    case 'WARM_SESSION_STATUS_READ':
      return {
        kind: 'status_read',
        ...(id ? { id } : {}),
        payload: hasPayload ? parseWarmSessionStatusReadPayload(payload) : null,
      };
    case 'WARM_SESSION_STATUS_BATCH_READ':
      return {
        kind: 'status_batch_read',
        ...(id ? { id } : {}),
        payload: hasPayload ? parseWarmSessionStatusBatchReadPayload(payload) : null,
      };
    case 'WARM_SESSION_MATERIAL_CLAIM':
      return {
        kind: 'material_claim',
        ...(id ? { id } : {}),
        payload: hasPayload ? parseWarmSessionMaterialClaimPayload(payload) : null,
      };
    case 'WARM_SESSION_MATERIAL_CONSUME':
      return {
        kind: 'material_consume',
        ...(id ? { id } : {}),
        payload: hasPayload ? parseWarmSessionMaterialConsumePayload(payload) : null,
      };
    case 'WARM_SESSION_VOLATILE_MATERIAL_CLEAR':
      return hasPayload
        ? { kind: 'volatile_clear', ...(id ? { id } : {}), payload }
        : { kind: 'unknown', id, type };
    case 'WARM_SESSION_VOLATILE_MATERIAL_CLEAR_ALL':
      return hasPayload
        ? { kind: 'volatile_clear_all', ...(id ? { id } : {}), payload }
        : { kind: 'unknown', id, type };
    case 'WARM_SESSION_SEAL_AND_PERSIST':
      return {
        kind: 'seal_and_persist',
        ...(id ? { id } : {}),
        payload: hasPayload ? parseWarmSessionSealAndPersistPayload(payload) : null,
      };
    case 'WARM_SESSION_REHYDRATE':
      return {
        kind: 'rehydrate',
        ...(id ? { id } : {}),
        payload: hasPayload ? parseWarmSessionRehydratePayload(payload) : null,
      };
    default:
      return { kind: 'unknown', id, type };
  }
}

function nowMs(): number {
  return Date.now();
}

function roundWorkerDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function createWarmSessionSealAndPersistDiagnostics(): WarmSessionSealAndPersistDiagnostics {
  return {
    runtimeSetupMs: 0,
    clientSealMs: 0,
    serverSealRouteMs: 0,
    clientUnsealMs: 0,
    policyUpdateMs: 0,
  };
}

function recordWarmSessionSealAndPersistDiagnosticDuration(args: {
  diagnostics: WarmSessionSealAndPersistDiagnostics;
  bucket: keyof WarmSessionSealAndPersistDiagnostics;
  startedAt: number;
}): void {
  args.diagnostics[args.bucket] += roundWorkerDurationMs(args.startedAt);
}

function overwriteBytes(bytes: Uint8Array | null | undefined): void {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return;
  bytes.fill(0);
}

function toSessionId(prefix: string): string {
  const value = String(prefix || '').trim() || 'session';
  return `${value}:${secureRandomBase64Url(32, 'passkey confirm worker session IDs')}`;
}

function createPasskeyPrfFirstHandle(args: { prfFirstB64u: string; expiresAtMs: number }): string {
  const prfFirstB64u = normalizeOptionalTrimmedString(args.prfFirstB64u);
  const expiresAtMs = Math.floor(Number(args.expiresAtMs) || 0);
  if (!prfFirstB64u || expiresAtMs <= nowMs()) {
    throw new Error('Invalid passkey PRF material handle input');
  }
  const prfFirstHandle = toSessionId('passkey-prf-first');
  passkeyPrfFirstHandleStore.set(prfFirstHandle, {
    prfFirstB64u,
    expiresAtMs,
  });
  return prfFirstHandle;
}

async function sha256HexUtf8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function passkeyServerSealedSecretCacheKey(args: {
  prfFirstB64u: string;
  relayerUrl: string;
  keyVersion: string;
  cacheScope: PasskeyServerSealedSecretCacheScope | undefined;
}): Promise<string | null> {
  const prfFirstB64u = normalizeOptionalTrimmedString(args.prfFirstB64u);
  const relayerUrl = normalizeOptionalTrimmedString(args.relayerUrl);
  const keyVersion = normalizeOptionalNonEmptyString(args.keyVersion);
  const cacheScope = args.cacheScope;
  if (!prfFirstB64u || !relayerUrl || !keyVersion || !cacheScope) return null;
  const prfDigestHex = await sha256HexUtf8(prfFirstB64u);
  return [
    'passkey-server-sealed-secret-v1',
    relayerUrl,
    keyVersion,
    SIGNING_SESSION_SEAL_GROUP_ID,
    cacheScope.walletId,
    cacheScope.credentialIdB64u,
    cacheScope.walletSessionId,
    cacheScope.quotaId,
    prfDigestHex,
  ].join('|');
}

function prunePasskeyServerSealedSecretCache(): void {
  const now = nowMs();
  for (const [key, entry] of passkeyServerSealedSecretCache) {
    if (entry.expiresAtMs <= now) passkeyServerSealedSecretCache.delete(key);
  }
  while (passkeyServerSealedSecretCache.size > PASSKEY_SERVER_SEALED_SECRET_CACHE_MAX_ENTRIES) {
    const firstKey = passkeyServerSealedSecretCache.keys().next().value;
    if (typeof firstKey !== 'string') return;
    passkeyServerSealedSecretCache.delete(firstKey);
  }
}

function readPasskeyServerSealedSecretCache(
  cacheKey: string | null,
): PasskeyServerSealedSecretCacheEntry | null {
  if (!cacheKey) return null;
  prunePasskeyServerSealedSecretCache();
  const entry = passkeyServerSealedSecretCache.get(cacheKey);
  if (!entry || entry.expiresAtMs <= nowMs()) {
    if (entry) passkeyServerSealedSecretCache.delete(cacheKey);
    return null;
  }
  return entry;
}

function writePasskeyServerSealedSecretCache(args: {
  cacheKey: string | null;
  sealedSecretB64u: string;
  expiresAtMs: number;
}): void {
  if (!args.cacheKey) return;
  const sealedSecretB64u = normalizeOptionalTrimmedString(args.sealedSecretB64u);
  const expiresAtMs = Math.floor(Number(args.expiresAtMs) || 0);
  if (!sealedSecretB64u || expiresAtMs <= nowMs()) return;
  passkeyServerSealedSecretCache.set(args.cacheKey, { sealedSecretB64u, expiresAtMs });
  prunePasskeyServerSealedSecretCache();
}

function deleteWarmSessionPrfHandle(thresholdSessionId: string): void {
  const entry = warmSessionPrfHandleCache.get(thresholdSessionId);
  if (entry) passkeyPrfFirstHandleStore.delete(entry.prfFirstHandle);
  warmSessionPrfHandleCache.delete(thresholdSessionId);
}

function clearWarmSessionPrfHandles(): void {
  clientSealPreparations.clear();
  warmSessionPrfHandleCache.clear();
  passkeyPrfFirstHandleStore.clear();
  passkeyServerSealedSecretCache.clear();
}

function storeWarmSessionPrfHandle(args: {
  thresholdSessionId: string;
  prfFirstB64u: string;
  expiresAtMs: number;
  remainingUses: number;
}): WarmSessionMaterialEntry {
  const thresholdSessionId = normalizeOptionalTrimmedString(args.thresholdSessionId);
  const remainingUses = Math.floor(Number(args.remainingUses) || 0);
  const expiresAtMs = Math.floor(Number(args.expiresAtMs) || 0);
  if (!thresholdSessionId || remainingUses <= 0 || expiresAtMs <= nowMs()) {
    throw new Error('Invalid warm-session PRF handle input');
  }
  deleteWarmSessionPrfHandle(thresholdSessionId);
  const prfFirstHandle = createPasskeyPrfFirstHandle({
    prfFirstB64u: args.prfFirstB64u,
    expiresAtMs,
  });
  const entry = { prfFirstHandle, expiresAtMs, remainingUses };
  warmSessionPrfHandleCache.set(thresholdSessionId, entry);
  return entry;
}

function updateWarmSessionPrfHandlePolicy(
  thresholdSessionId: string,
  entry: WarmSessionMaterialEntry,
  policy: OkResult,
): WarmSessionMaterialEntry {
  const nextEntry = {
    prfFirstHandle: entry.prfFirstHandle,
    remainingUses: policy.remainingUses,
    expiresAtMs: policy.expiresAtMs,
  };
  const secret = passkeyPrfFirstHandleStore.get(entry.prfFirstHandle);
  if (secret) {
    passkeyPrfFirstHandleStore.set(entry.prfFirstHandle, {
      prfFirstB64u: secret.prfFirstB64u,
      expiresAtMs: policy.expiresAtMs,
    });
  }
  warmSessionPrfHandleCache.set(thresholdSessionId, nextEntry);
  return nextEntry;
}

function parseSigningSessionSealTransport(value: unknown): SigningSessionSealTransport | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const curve = Reflect.get(value, 'curve');
  const authMethod = Reflect.get(value, 'authMethod');
  const requiredFields =
    curve === 'ed25519'
      ? ['curve', 'authMethod', 'walletId', 'relayerUrl', 'walletSessionToken', 'ed25519Restore']
      : curve === 'ecdsa'
        ? [
            'curve',
            'authMethod',
            'walletId',
            'chainTarget',
            'relayerUrl',
            'walletSessionToken',
            'ecdsaRestore',
          ]
        : [];
  const optionalFields = [
    'signingSessionSealKeyVersion',
    'groupId',
    'serverSealedSecretCacheScope',
  ];
  const fields = Object.keys(value);
  if (
    (curve !== 'ed25519' && curve !== 'ecdsa') ||
    authMethod !== 'passkey' ||
    fields.some((field) => ![...requiredFields, ...optionalFields].includes(field)) ||
    requiredFields.some((field) => !fields.includes(field))
  ) {
    return null;
  }
  const walletId = parseSessionString(Reflect.get(value, 'walletId'));
  const relayerUrl = normalizeOptionalNonEmptyString(Reflect.get(value, 'relayerUrl'));
  const walletSessionToken = normalizeOptionalNonEmptyString(
    Reflect.get(value, 'walletSessionToken'),
  );
  const restore = Reflect.get(value, curve === 'ed25519' ? 'ed25519Restore' : 'ecdsaRestore');
  const chainTarget = curve === 'ecdsa' ? Reflect.get(value, 'chainTarget') : undefined;
  const rawKeyVersion = Reflect.get(value, 'signingSessionSealKeyVersion');
  const hasKeyVersion = fields.includes('signingSessionSealKeyVersion');
  const keyVersion = normalizeOptionalNonEmptyString(rawKeyVersion);
  const hasCacheScope = fields.includes('serverSealedSecretCacheScope');
  const serverSealedSecretCacheScope = parsePasskeyServerSealedSecretCacheScope(
    Reflect.get(value, 'serverSealedSecretCacheScope'),
  );
  if (
    !walletId ||
    !relayerUrl ||
    !walletSessionToken ||
    restore === null ||
    typeof restore !== 'object' ||
    Array.isArray(restore) ||
    (curve === 'ecdsa' &&
      (chainTarget === null || typeof chainTarget !== 'object' || Array.isArray(chainTarget))) ||
    (hasKeyVersion && !keyVersion) ||
    (hasCacheScope && !serverSealedSecretCacheScope)
  ) {
    return null;
  }
  return {
    relayerUrl,
    walletSessionToken,
    ...(hasKeyVersion && keyVersion ? { keyVersion } : {}),
    ...(serverSealedSecretCacheScope ? { serverSealedSecretCacheScope } : {}),
  };
}

function parsePasskeyServerSealedSecretCacheScope(
  value: unknown,
): PasskeyServerSealedSecretCacheScope | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const fields = Object.keys(value);
  if (
    fields.length !== 5 ||
    !['kind', 'walletId', 'credentialIdB64u', 'walletSessionId', 'quotaId'].every((field) =>
      fields.includes(field),
    ) ||
    Reflect.get(value, 'kind') !== 'passkey_registration'
  ) {
    return undefined;
  }
  const walletId = normalizeOptionalNonEmptyString(Reflect.get(value, 'walletId'));
  const credentialIdB64u = normalizeOptionalNonEmptyString(Reflect.get(value, 'credentialIdB64u'));
  const walletSessionId = normalizeOptionalNonEmptyString(Reflect.get(value, 'walletSessionId'));
  const quotaId = normalizeOptionalNonEmptyString(Reflect.get(value, 'quotaId'));
  if (!walletId || !credentialIdB64u || !walletSessionId || !quotaId) return undefined;
  return {
    kind: 'passkey_registration',
    walletId,
    credentialIdB64u,
    walletSessionId,
    quotaId,
  };
}

function parseSigningSessionSealRouteResult(value: unknown): SigningSessionSealRouteResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      code: 'invalid_response',
      message: 'Invalid signing-session seal response',
    };
  }
  const ok = Reflect.get(value, 'ok');
  if (typeof ok !== 'boolean') {
    return {
      ok: false,
      code: 'invalid_response',
      message: 'Invalid signing-session seal response',
    };
  }
  const fields = Object.keys(value);
  const allowedFields = ok
    ? ['ok', 'ciphertext', 'keyVersion', 'expiresAtMs', 'remainingUses']
    : ['ok', 'code', 'message'];
  if (fields.some((field) => !allowedFields.includes(field))) {
    return {
      ok: false,
      code: 'invalid_response',
      message: 'Invalid signing-session seal response',
    };
  }
  if (!ok) {
    const code = Reflect.get(value, 'code');
    const message = Reflect.get(value, 'message');
    return {
      ok: false,
      code: typeof code === 'string' ? code : 'request_failed',
      message: typeof message === 'string' ? message : 'Signing-session seal request failed',
    };
  }
  const ciphertext = normalizeOptionalTrimmedString(Reflect.get(value, 'ciphertext'));
  const keyVersion = normalizeOptionalNonEmptyString(Reflect.get(value, 'keyVersion'));
  const expiresAtMs = normalizePositiveInteger(Reflect.get(value, 'expiresAtMs'));
  const remainingUses = normalizeNonNegativeInteger(Reflect.get(value, 'remainingUses'));
  if (!ciphertext) {
    return {
      ok: false,
      code: 'invalid_response',
      message: 'Missing ciphertext in signing-session seal response',
    };
  }
  return {
    ok: true,
    ciphertext,
    ...(keyVersion ? { keyVersion } : {}),
    ...(expiresAtMs != null ? { expiresAtMs } : {}),
    ...(remainingUses != null ? { remainingUses } : {}),
  };
}

function makeSigningSessionSealSingleFlightKey(args: {
  operation: 'apply-server-seal' | 'remove-server-seal';
  thresholdSessionId: string;
  relayerUrl: string;
  keyVersion?: string;
  payloadKey?: string;
}): string {
  const operation =
    args.operation === 'apply-server-seal' ? 'apply-server-seal' : 'remove-server-seal';
  const thresholdSessionId = normalizeOptionalTrimmedString(args.thresholdSessionId) || '';
  const relayerUrl = normalizeOptionalTrimmedString(args.relayerUrl) || '';
  const keyVersion = normalizeOptionalNonEmptyString(args.keyVersion) || '';
  const payloadKey = normalizeOptionalNonEmptyString(args.payloadKey) || '';
  return `${operation}|${thresholdSessionId}|${relayerUrl}|${keyVersion}|${SIGNING_SESSION_SEAL_GROUP_ID}|${payloadKey}`;
}

async function callSigningSessionSealRoute(args: {
  operation: 'apply-server-seal' | 'remove-server-seal';
  transport: SigningSessionSealTransport;
  thresholdSessionId: string;
  ciphertext: string;
  keyVersion?: string;
}): Promise<SigningSessionSealRouteResult> {
  const routePath =
    args.operation === 'apply-server-seal' ? 'apply-server-seal' : 'remove-server-seal';
  const url = joinNormalizedUrl(
    args.transport.relayerUrl,
    `${SIGNING_SESSION_SEAL_BASE_PATH}/${routePath}`,
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(
    abortSigningSessionSealRoute,
    SIGNING_SESSION_SEAL_ROUTE_TIMEOUT_MS,
    controller,
  );

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const keyVersion = normalizeOptionalNonEmptyString(args.keyVersion);
    headers.Authorization = `Bearer ${args.transport.walletSessionToken}`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        thresholdSessionId: args.thresholdSessionId,
        ciphertext: args.ciphertext,
        ...(keyVersion ? { keyVersion } : {}),
      }),
    });
    const data = await response.json().catch(() => null);
    const parsed = parseSigningSessionSealRouteResult(data);
    if (!response.ok && parsed.ok) {
      return {
        ok: false,
        code: 'http_error',
        message: `Signing-session seal route returned HTTP ${response.status}`,
      };
    }
    if (!parsed.ok) return parsed;
    return parsed;
  } catch (error: unknown) {
    return {
      ok: false,
      code: controller.signal.aborted ? 'timeout' : 'network_error',
      message: controller.signal.aborted
        ? `Signing-session seal request timed out after ${SIGNING_SESSION_SEAL_ROUTE_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error || 'Signing-session seal request failed'),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolvePolicyFromServerAndLocal(args: {
  localRemainingUses: number;
  localExpiresAtMs: number;
  serverRemainingUses?: number;
  serverExpiresAtMs?: number;
}): OkResult | ErrResult {
  const localRemainingUses = Math.max(0, Math.floor(Number(args.localRemainingUses) || 0));
  const localExpiresAtMs = Math.max(0, Math.floor(Number(args.localExpiresAtMs) || 0));
  const serverRemainingUses =
    normalizeNonNegativeInteger(args.serverRemainingUses) ?? localRemainingUses;
  const serverExpiresAtMs = normalizePositiveInteger(args.serverExpiresAtMs) || localExpiresAtMs;
  const remainingUses = Math.min(localRemainingUses, serverRemainingUses);
  const expiresAtMs = Math.min(localExpiresAtMs, serverExpiresAtMs);
  if (remainingUses <= 0) {
    return {
      ok: false,
      code: 'exhausted',
      message: 'Warm-session material exhausted for threshold session',
    };
  }
  if (expiresAtMs <= nowMs()) {
    return {
      ok: false,
      code: 'expired',
      message: 'Warm-session material expired for threshold session',
    };
  }
  return { ok: true, remainingUses, expiresAtMs };
}

function readWarmSessionMaterialEntry(thresholdSessionId: string): WarmSessionMaterialReadResult {
  if (!thresholdSessionId)
    return { ok: false, code: 'invalid_args', message: 'Missing threshold sessionId' };
  const entry = warmSessionPrfHandleCache.get(thresholdSessionId);
  if (!entry)
    return {
      ok: false,
      code: 'not_found',
      message: 'Warm-session material is not available for threshold session',
    };
  if (nowMs() >= entry.expiresAtMs) {
    deleteWarmSessionPrfHandle(thresholdSessionId);
    return {
      ok: false,
      code: 'expired',
      message: 'Warm-session material expired for threshold session',
    };
  }
  if (entry.remainingUses <= 0) {
    deleteWarmSessionPrfHandle(thresholdSessionId);
    return {
      ok: false,
      code: 'exhausted',
      message: 'Warm-session material exhausted for threshold session',
    };
  }
  const secret = passkeyPrfFirstHandleStore.get(entry.prfFirstHandle);
  if (!secret || nowMs() >= secret.expiresAtMs) {
    deleteWarmSessionPrfHandle(thresholdSessionId);
    return {
      ok: false,
      code: 'not_found',
      message: 'Warm-session material handle is not available for threshold session',
    };
  }
  return {
    ok: true,
    entry,
    secret,
    remainingUses: entry.remainingUses,
    expiresAtMs: entry.expiresAtMs,
  };
}

function readWarmSessionClaimEntry(thresholdSessionId: string): OkResult | ErrResult {
  const activeEntry = readWarmSessionMaterialEntry(thresholdSessionId);
  if (!activeEntry.ok) return activeEntry;
  return {
    ok: true,
    remainingUses: activeEntry.remainingUses,
    expiresAtMs: activeEntry.expiresAtMs,
  };
}

function claimWarmSessionMaterialEntry(
  thresholdSessionId: string,
  uses: number,
  consume: boolean,
): OkDispenseResult | ErrResult {
  const activeEntry = readWarmSessionMaterialEntry(thresholdSessionId);
  if (!activeEntry.ok) return activeEntry;
  const entry = activeEntry.entry;
  const usesNeeded = Math.max(1, Math.floor(Number(uses) || 1));
  if (entry.remainingUses < usesNeeded) {
    return {
      ok: false,
      code: 'exhausted',
      message: 'Warm-session material exhausted for threshold session',
    };
  }
  if (consume) {
    entry.remainingUses -= usesNeeded;
    if (entry.remainingUses <= 0) {
      deleteWarmSessionPrfHandle(thresholdSessionId);
    } else {
      warmSessionPrfHandleCache.set(thresholdSessionId, entry);
    }
  }
  return {
    ok: true,
    prfFirstB64u: activeEntry.secret.prfFirstB64u,
    remainingUses: entry.remainingUses,
    expiresAtMs: entry.expiresAtMs,
  };
}

function consumeWarmSessionMaterialEntry(
  thresholdSessionId: string,
  uses: number,
): OkResult | ErrResult {
  const activeEntry = readWarmSessionMaterialEntry(thresholdSessionId);
  if (!activeEntry.ok) return activeEntry;
  const entry = activeEntry.entry;
  const usesNeeded = Math.max(1, Math.floor(Number(uses) || 1));
  if (entry.remainingUses < usesNeeded) {
    return {
      ok: false,
      code: 'exhausted',
      message: 'Warm-session material exhausted for threshold session',
    };
  }
  entry.remainingUses -= usesNeeded;
  if (entry.remainingUses <= 0) {
    deleteWarmSessionPrfHandle(thresholdSessionId);
  } else {
    warmSessionPrfHandleCache.set(thresholdSessionId, entry);
  }
  return {
    ok: true,
    remainingUses: entry.remainingUses,
    expiresAtMs: entry.expiresAtMs,
  };
}

type SigningSessionSealExecution = {
  readonly thresholdSessionId: string;
  readonly transport: SigningSessionSealTransport;
} & (
  | { readonly kind: 'server_route'; readonly preparationId?: never; readonly serverSeal?: never }
  | {
      readonly kind: 'prepared_response';
      readonly preparationId: string;
      readonly serverSeal: Extract<SigningSessionSealRouteResult, { readonly ok: true }>;
    }
);

async function runSigningSessionSealAndPersist(
  args: SigningSessionSealExecution,
): Promise<OkSealResult | ErrResult> {
  const thresholdSessionId = normalizeOptionalTrimmedString(args.thresholdSessionId);
  if (!thresholdSessionId) {
    return { ok: false, code: 'invalid_args', message: 'Missing threshold sessionId' };
  }
  const activeEntry = readWarmSessionMaterialEntry(thresholdSessionId);
  if (!activeEntry.ok) return activeEntry;
  const entry = activeEntry.entry;
  const singleFlightKey = makeSigningSessionSealSingleFlightKey({
    operation: 'apply-server-seal',
    thresholdSessionId,
    relayerUrl: args.transport.relayerUrl,
    keyVersion: args.transport.keyVersion,
    payloadKey: entry.prfFirstHandle,
  });
  const inFlight = signingSessionSealApplyInFlight.get(singleFlightKey);
  if (inFlight) return await inFlight;

  const task = (async (): Promise<OkSealResult | ErrResult> => {
    const diagnostics = createWarmSessionSealAndPersistDiagnostics();
    try {
      const prepared =
        args.kind === 'prepared_response'
          ? await clientSealPreparations.takeExact(
              thresholdSessionId,
              args.preparationId,
              activeEntry.secret.prfFirstB64u,
            )
          : await clientSealPreparations.take(thresholdSessionId, activeEntry.secret.prfFirstB64u);
      const { runtime, keyHandle, ciphertext: clientEncryptedCiphertext } = prepared;
      diagnostics.runtimeSetupMs = prepared.runtimeSetupMs;
      diagnostics.clientSealMs = prepared.clientSealMs;
      try {
        const serverSealRouteStartedAt = performance.now();
        const applied =
          args.kind === 'prepared_response'
            ? args.serverSeal
            : await callSigningSessionSealRoute({
                operation: 'apply-server-seal',
                transport: args.transport,
                thresholdSessionId,
                ciphertext: clientEncryptedCiphertext,
                keyVersion: args.transport.keyVersion,
              });
        if (args.kind === 'server_route') {
          recordWarmSessionSealAndPersistDiagnosticDuration({
            diagnostics,
            bucket: 'serverSealRouteMs',
            startedAt: serverSealRouteStartedAt,
          });
        }
        if (!applied.ok) return applied;
        const policyUpdateStartedAt = performance.now();
        const policy = resolvePolicyFromServerAndLocal({
          localRemainingUses: entry.remainingUses,
          localExpiresAtMs: entry.expiresAtMs,
          serverRemainingUses: applied.remainingUses,
          serverExpiresAtMs: applied.expiresAtMs,
        });
        if (!policy.ok) {
          deleteWarmSessionPrfHandle(thresholdSessionId);
          return policy;
        }
        updateWarmSessionPrfHandlePolicy(thresholdSessionId, entry, policy);
        recordWarmSessionSealAndPersistDiagnosticDuration({
          diagnostics,
          bucket: 'policyUpdateMs',
          startedAt: policyUpdateStartedAt,
        });
        const keyVersion =
          normalizeOptionalNonEmptyString(applied.keyVersion) ||
          normalizeOptionalNonEmptyString(args.transport.keyVersion);
        const sealedSecretCacheKey = keyVersion
          ? await passkeyServerSealedSecretCacheKey({
              prfFirstB64u: activeEntry.secret.prfFirstB64u,
              relayerUrl: args.transport.relayerUrl,
              keyVersion,
              cacheScope: args.transport.serverSealedSecretCacheScope,
            })
          : null;
        const cachedSealedSecret = readPasskeyServerSealedSecretCache(sealedSecretCacheKey);
        let sealedSecretB64u = cachedSealedSecret?.sealedSecretB64u || '';
        if (!sealedSecretB64u) {
          const clientUnsealStartedAt = performance.now();
          sealedSecretB64u = await runtime.removeClientSealWithKeyHandle({
            ciphertextB64u: applied.ciphertext,
            keyHandle: keyHandle,
          });
          recordWarmSessionSealAndPersistDiagnosticDuration({
            diagnostics,
            bucket: 'clientUnsealMs',
            startedAt: clientUnsealStartedAt,
          });
          writePasskeyServerSealedSecretCache({
            cacheKey: sealedSecretCacheKey,
            sealedSecretB64u,
            expiresAtMs: policy.expiresAtMs,
          });
        }
        return {
          ok: true,
          sealedSecretB64u,
          ...(keyVersion ? { keyVersion } : {}),
          remainingUses: policy.remainingUses,
          expiresAtMs: policy.expiresAtMs,
          diagnostics,
        };
      } finally {
        await runtime.destroyClientKeyHandle({ keyHandle: keyHandle }).catch(() => undefined);
      }
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'internal',
        message:
          error instanceof Error ? error.message : String(error || 'Failed to apply server seal'),
      };
    }
  })().finally(() => {
    signingSessionSealApplyInFlight.delete(singleFlightKey);
  });

  signingSessionSealApplyInFlight.set(singleFlightKey, task);
  return await task;
}

async function runSigningSessionRehydrate(args: {
  thresholdSessionId: string;
  sealedSecretB64u: string;
  keyVersion?: string;
  remainingUses: number;
  expiresAtMs: number;
  transport: SigningSessionSealTransport;
}): Promise<OkResult | ErrResult> {
  const thresholdSessionId = normalizeOptionalTrimmedString(args.thresholdSessionId);
  if (!thresholdSessionId) {
    return { ok: false, code: 'invalid_args', message: 'Missing threshold sessionId' };
  }
  const sealedSecretB64u = normalizeOptionalTrimmedString(args.sealedSecretB64u);
  if (!sealedSecretB64u) {
    return { ok: false, code: 'invalid_args', message: 'Missing sealedSecretB64u' };
  }
  const localRemainingUses = Math.max(0, Math.floor(Number(args.remainingUses) || 0));
  const localExpiresAtMs = Math.max(0, Math.floor(Number(args.expiresAtMs) || 0));
  if (localRemainingUses <= 0) {
    return {
      ok: false,
      code: 'exhausted',
      message: 'Warm-session material exhausted for threshold session',
    };
  }
  if (localExpiresAtMs <= nowMs()) {
    return {
      ok: false,
      code: 'expired',
      message: 'Warm-session material expired for threshold session',
    };
  }
  const singleFlightKey = makeSigningSessionSealSingleFlightKey({
    operation: 'remove-server-seal',
    thresholdSessionId,
    relayerUrl: args.transport.relayerUrl,
    keyVersion: args.keyVersion || args.transport.keyVersion,
    payloadKey: sealedSecretB64u,
  });
  const inFlight = signingSessionSealRemoveInFlight.get(singleFlightKey);
  if (inFlight) return await inFlight;

  const task = (async (): Promise<OkResult | ErrResult> => {
    try {
      const runtime = await getShamir3PassRuntime();
      const clientKeyHandle = await runtime.createClientKeyHandle({
        groupId: SIGNING_SESSION_SEAL_GROUP_ID,
      });
      try {
        const clientEncryptedCiphertext = await runtime.addClientSealWithKeyHandle({
          ciphertextB64u: sealedSecretB64u,
          keyHandle: clientKeyHandle.keyHandle,
        });

        const removed = await callSigningSessionSealRoute({
          operation: 'remove-server-seal',
          transport: args.transport,
          thresholdSessionId,
          ciphertext: clientEncryptedCiphertext,
          keyVersion: normalizeOptionalNonEmptyString(args.keyVersion) || args.transport.keyVersion,
        });
        if (!removed.ok) return removed;

        const plaintext = await runtime.removeClientSealWithKeyHandleToBytes({
          ciphertextB64u: removed.ciphertext,
          keyHandle: clientKeyHandle.keyHandle,
        });
        const secret32 = decodeSigningSessionSecret32(plaintext);
        plaintext.fill(0);
        if (!secret32) throw new Error('Restored passkey PRF has invalid length');
        const prfFirstB64u = base64UrlEncode(secret32);
        secret32.fill(0);
        const policy = resolvePolicyFromServerAndLocal({
          localRemainingUses,
          localExpiresAtMs,
          serverRemainingUses: removed.remainingUses,
          serverExpiresAtMs: removed.expiresAtMs,
        });
        if (!policy.ok) return policy;

        storeWarmSessionPrfHandle({
          thresholdSessionId,
          prfFirstB64u,
          remainingUses: policy.remainingUses,
          expiresAtMs: policy.expiresAtMs,
        });
        return policy;
      } finally {
        await runtime
          .destroyClientKeyHandle({ keyHandle: clientKeyHandle.keyHandle })
          .catch(() => undefined);
      }
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'internal',
        message:
          error instanceof Error ? error.message : String(error || 'Failed to remove server seal'),
      };
    }
  })().finally(() => {
    signingSessionSealRemoveInFlight.delete(singleFlightKey);
  });

  signingSessionSealRemoveInFlight.set(singleFlightKey, task);
  return await task;
}

function postPasskeyMpcSessionWorkerResponse(
  id: unknown,
  payload: UserConfirmWorkerResponsePayload,
): void {
  const response: UserConfirmWorkerResponse = payload.success
    ? {
        ...(typeof id === 'string' && id.trim() ? { id: id.trim() } : {}),
        success: true,
        data: payload.data,
      }
    : {
        ...(typeof id === 'string' && id.trim() ? { id: id.trim() } : {}),
        success: false,
        error: payload.error,
      };
  try {
    self.postMessage(response);
  } catch {}
}

async function handleClientSealPreparation(
  incoming: Extract<
    PasskeyMpcSessionWorkerIncomingMessage,
    { kind: 'prepare_client_seal' | 'discard_client_seal' }
  >,
): Promise<void> {
  try {
    if (!incoming.payload) throw new Error('Invalid client seal preparation request');
    if (incoming.kind === 'prepare_client_seal')
      await clientSealPreparations.prepare(
        incoming.payload.thresholdSessionId,
        incoming.payload.preparationId,
        incoming.payload.prfFirstB64u,
      );
    else
      await clientSealPreparations.discard(
        incoming.payload.thresholdSessionId,
        incoming.payload.preparationId,
      );
    postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: { ok: true } });
  } catch (error: unknown) {
    postPasskeyMpcSessionWorkerResponse(incoming.id, {
      success: false,
      error: error instanceof Error ? error.message : 'Client seal preparation failed',
    });
  }
}

async function handleClientSealRead(
  incoming: Extract<PasskeyMpcSessionWorkerIncomingMessage, { kind: 'read_client_seal' }>,
): Promise<void> {
  try {
    if (!incoming.payload) throw new Error('Invalid client seal read request');
    const ciphertext = await clientSealPreparations.readCiphertext(
      incoming.payload.thresholdSessionId,
      incoming.payload.preparationId,
    );
    postPasskeyMpcSessionWorkerResponse(incoming.id, {
      success: true,
      data: { ok: true, ciphertext },
    });
  } catch (error: unknown) {
    postPasskeyMpcSessionWorkerResponse(incoming.id, {
      success: false,
      error: error instanceof Error ? error.message : 'Client seal read failed',
    });
  }
}

async function handleClientSealCompletion(
  incoming: Extract<PasskeyMpcSessionWorkerIncomingMessage, { kind: 'complete_client_seal' }>,
): Promise<void> {
  const payload = incoming.payload;
  if (!payload) {
    postPasskeyMpcSessionWorkerResponse(incoming.id, {
      success: false,
      error: 'Invalid client seal completion request',
    });
    return;
  }
  const result = await runSigningSessionSealAndPersist({
    kind: 'prepared_response',
    thresholdSessionId: payload.thresholdSessionId,
    preparationId: payload.preparationId,
    transport: payload.transport,
    serverSeal: payload.serverSeal,
  });
  postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: result });
}

self.onmessage = (event: MessageEvent) => {
  const incoming = parsePasskeyMpcSessionWorkerMessage(event.data);
  switch (incoming.kind) {
    case 'prepare_client_seal':
    case 'discard_client_seal':
      void handleClientSealPreparation(incoming);
      return;
    case 'read_client_seal':
      void handleClientSealRead(incoming);
      return;
    case 'complete_client_seal':
      void handleClientSealCompletion(incoming);
      return;
    case 'ping':
      postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: { ok: true } });
      return;
    case 'prewarm':
      void (async () => {
        // warmupShamir3PassRuntime never rejects; it reports failure as data.
        const outcome = await warmupShamir3PassRuntime();
        postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: outcome });
      })();
      return;
    case 'material_put': {
      try {
        const payload = incoming.payload;
        if (!payload) {
          postPasskeyMpcSessionWorkerResponse(incoming.id, {
            success: true,
            data: {
              ok: false,
              code: 'invalid_args',
              message: 'Invalid WARM_SESSION_MATERIAL_PUT payload',
            } satisfies ErrResult,
          });
          return;
        }
        const { thresholdSessionId, prfFirstB64u, expiresAtMs, remainingUses } = payload;
        if (expiresAtMs <= nowMs() || remainingUses <= 0) {
          postPasskeyMpcSessionWorkerResponse(incoming.id, {
            success: true,
            data: {
              ok: false,
              code: 'invalid_args',
              message: 'Invalid expiresAtMs or remainingUses',
            } satisfies ErrResult,
          });
          return;
        }
        storeWarmSessionPrfHandle({ thresholdSessionId, prfFirstB64u, expiresAtMs, remainingUses });
        postPasskeyMpcSessionWorkerResponse(incoming.id, {
          success: true,
          data: { ok: true, remainingUses, expiresAtMs } satisfies OkResult,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        postPasskeyMpcSessionWorkerResponse(incoming.id, { success: false, error: message });
      }
      return;
    }
    case 'status_read':
      if (!incoming.payload) {
        postPasskeyMpcSessionWorkerResponse(incoming.id, {
          success: false,
          error: 'Invalid WARM_SESSION_STATUS_READ payload',
        });
        return;
      }
      postPasskeyMpcSessionWorkerResponse(incoming.id, {
        success: true,
        data: readWarmSessionClaimEntry(incoming.payload.thresholdSessionId),
      });
      return;
    case 'status_batch_read':
      if (!incoming.payload) {
        postPasskeyMpcSessionWorkerResponse(incoming.id, {
          success: false,
          error: 'Invalid WARM_SESSION_STATUS_BATCH_READ payload',
        });
        return;
      }
      postPasskeyMpcSessionWorkerResponse(incoming.id, {
        success: true,
        data: {
          results: Array.from(new Set(incoming.payload.thresholdSessionIds)).map(
            (thresholdSessionId) => ({
              thresholdSessionId,
              result: readWarmSessionClaimEntry(thresholdSessionId),
            }),
          ),
        },
      });
      return;
    case 'material_claim':
      if (!incoming.payload) {
        postPasskeyMpcSessionWorkerResponse(incoming.id, {
          success: false,
          error: 'Invalid WARM_SESSION_MATERIAL_CLAIM payload',
        });
        return;
      }
      postPasskeyMpcSessionWorkerResponse(incoming.id, {
        success: true,
        data: claimWarmSessionMaterialEntry(
          incoming.payload.thresholdSessionId,
          incoming.payload.uses,
          incoming.payload.consume,
        ),
      });
      return;
    case 'material_consume':
      if (!incoming.payload) {
        postPasskeyMpcSessionWorkerResponse(incoming.id, {
          success: false,
          error: 'Invalid WARM_SESSION_MATERIAL_CONSUME payload',
        });
        return;
      }
      postPasskeyMpcSessionWorkerResponse(incoming.id, {
        success: true,
        data: consumeWarmSessionMaterialEntry(
          incoming.payload.thresholdSessionId,
          incoming.payload.uses,
        ),
      });
      return;
    case 'volatile_clear': {
      const command = parseClearVolatileWarmMaterialCommand(incoming.payload);
      if (command?.scope.kind === 'session') {
        clientSealPreparations.clearSession(String(command.scope.thresholdSessionId));
        deleteWarmSessionPrfHandle(String(command.scope.thresholdSessionId));
      }
      postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: { ok: true } });
      return;
    }
    case 'volatile_clear_all':
      clearWarmSessionPrfHandles();
      postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: { ok: true } });
      return;
    case 'seal_and_persist':
      void (async () => {
        const payload = incoming.payload;
        if (!payload) {
          postPasskeyMpcSessionWorkerResponse(incoming.id, {
            success: true,
            data: {
              ok: false,
              code: 'invalid_args',
              message: 'Invalid WARM_SESSION_SEAL_AND_PERSIST payload',
            } satisfies ErrResult,
          });
          return;
        }
        const result = await runSigningSessionSealAndPersist({
          kind: 'server_route',
          ...payload,
        });
        postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: result });
      })();
      return;
    case 'rehydrate':
      void (async () => {
        const payload = incoming.payload;
        if (!payload) {
          postPasskeyMpcSessionWorkerResponse(incoming.id, {
            success: true,
            data: {
              ok: false,
              code: 'invalid_args',
              message: 'Invalid WARM_SESSION_REHYDRATE payload',
            } satisfies ErrResult,
          });
          return;
        }
        const result = await runSigningSessionRehydrate(payload);
        postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: result });
      })();
      return;
    case 'unknown':
      if (incoming.id) {
        postPasskeyMpcSessionWorkerResponse(incoming.id, {
          success: false,
          error: `Unsupported Passkey MPC session worker message type: ${String(incoming.type)}`,
        });
      }
      return;
  }
};

// === GLOBAL ERROR MONITORING ===

self.onerror = (error) => {
  console.error('[passkey-mpc-session-worker] error:', error);
};

self.onunhandledrejection = (event) => {
  console.error('[passkey-mpc-session-worker] Unhandled promise rejection:', event.reason);
  event.preventDefault();
};
