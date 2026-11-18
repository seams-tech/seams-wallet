/** Passkey MPC warm-session material worker. */
import type {
  UserConfirmWorkerResponse,
  UserConfirmWorkerResponsePayload,
  WarmSessionSealAndPersistDiagnostics,
} from '@/core/types/secure-confirm-worker';
import { parseClearVolatileWarmMaterialCommand } from '@/core/signingEngine/session/warmCapabilities/volatileWarmMaterialCommands';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import {
  normalizeNonNegativeInteger,
  normalizeOptionalTrimmedString,
  normalizeOptionalNonEmptyString,
  normalizePositiveInteger,
} from '@shared/utils/normalize';
import {
  blindNewSigningSessionSealInput,
  blindSealedSigningSessionSecret,
  callSigningSessionSealEvaluateRoute,
  discardSigningSessionSealBlind,
  openSigningSessionSecret,
  parseSigningSessionSealRouteResult,
  sealSigningSessionSecret,
  SigningSessionSealPreparations,
  type SigningSessionSealRouteResult,
} from './oprf/signingSessionSeal';
import {
  WarmSessionPrfHandles,
  type ErrResult,
  type OkResult,
} from './passkeyMpcSession/warmSessionPrfHandles';

const sealPreparations = new SigningSessionSealPreparations();

type OkSealResult = OkResult & {
  sealedSecretB64u: string;
  keyVersion: string;
  diagnostics?: WarmSessionSealAndPersistDiagnostics;
};

type SigningSessionSealTransport = {
  walletId: string;
  relayerUrl: string;
  walletSessionToken: string;
  keyVersion?: string;
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

type SigningSessionSealEvaluationResult = Extract<SigningSessionSealRouteResult, { ok: true }>;

const warmSessionPrfHandles = new WarmSessionPrfHandles();
const signingSessionSealApplyInFlight = new Map<string, Promise<OkSealResult | ErrResult>>();
const signingSessionSealRemoveInFlight = new Map<string, Promise<OkResult | ErrResult>>();

type SealPreparationRef = { preparationId: string; thresholdSessionId: string };

type PasskeyMpcSessionWorkerIncomingMessage =
  | { kind: 'ping'; id?: string }
  | { kind: 'prewarm'; id?: string }
  | {
      kind: 'prepare_seal_blind' | 'discard_seal_blind' | 'read_seal_blind';
      id?: string;
      payload: SealPreparationRef | null;
    }
  | {
      kind: 'complete_seal';
      id?: string;
      payload: {
        preparationId: string;
        thresholdSessionId: string;
        transport: SigningSessionSealTransport;
        evaluation: SigningSessionSealEvaluationResult;
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

function parseSealPreparationRef(value: unknown): SealPreparationRef | null {
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

function parseSealCompletion(
  value: unknown,
): Extract<PasskeyMpcSessionWorkerIncomingMessage, { kind: 'complete_seal' }>['payload'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (
    fields.length !== 4 ||
    !fields.includes('preparationId') ||
    !fields.includes('thresholdSessionId') ||
    !fields.includes('transport') ||
    !fields.includes('evaluation')
  ) {
    return null;
  }
  const preparationId = parseSessionString(Reflect.get(value, 'preparationId'));
  const thresholdSessionId = parseSessionString(Reflect.get(value, 'thresholdSessionId'));
  const transport = parseSigningSessionSealTransport(Reflect.get(value, 'transport'));
  const evaluation = parseSigningSessionSealRouteResult(Reflect.get(value, 'evaluation'));
  if (!preparationId || !thresholdSessionId || !transport || !evaluation.ok) return null;
  return { preparationId, thresholdSessionId, transport, evaluation };
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
    case 'PREWARM_SESSION_SEAL':
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
    case 'PREPARE_SESSION_SEAL_BLIND':
      return { kind: 'prepare_seal_blind', id, payload: parseSealPreparationRef(payload) };
    case 'READ_SESSION_SEAL_BLIND':
      return { kind: 'read_seal_blind', id, payload: parseSealPreparationRef(payload) };
    case 'COMPLETE_SESSION_SEAL':
      return { kind: 'complete_seal', id, payload: parseSealCompletion(payload) };
    case 'DISCARD_SESSION_SEAL_BLIND':
      return { kind: 'discard_seal_blind', id, payload: parseSealPreparationRef(payload) };
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
    blindMs: 0,
    serverRouteMs: 0,
    finalizeMs: 0,
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

function clearWarmSessionPrfHandles(): void {
  sealPreparations.clear();
  warmSessionPrfHandles.clear();
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
  const optionalFields = ['signingSessionSealKeyVersion'];
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
  if (
    !walletId ||
    !relayerUrl ||
    !walletSessionToken ||
    restore === null ||
    typeof restore !== 'object' ||
    Array.isArray(restore) ||
    (curve === 'ecdsa' &&
      (chainTarget === null || typeof chainTarget !== 'object' || Array.isArray(chainTarget))) ||
    (hasKeyVersion && !keyVersion)
  ) {
    return null;
  }
  return {
    walletId,
    relayerUrl,
    walletSessionToken,
    ...(hasKeyVersion && keyVersion ? { keyVersion } : {}),
  };
}

function makeSigningSessionSealSingleFlightKey(args: {
  operation: 'seal' | 'restore';
  thresholdSessionId: string;
  relayerUrl: string;
  keyVersion?: string;
  payloadKey?: string;
}): string {
  return [
    args.operation,
    normalizeOptionalTrimmedString(args.thresholdSessionId) || '',
    normalizeOptionalTrimmedString(args.relayerUrl) || '',
    normalizeOptionalNonEmptyString(args.keyVersion) || '',
    normalizeOptionalNonEmptyString(args.payloadKey) || '',
  ].join('|');
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

type SigningSessionSealExecution = {
  readonly thresholdSessionId: string;
  readonly transport: SigningSessionSealTransport;
} & (
  | { readonly kind: 'server_route'; readonly preparationId?: never; readonly evaluation?: never }
  | {
      readonly kind: 'prepared_response';
      readonly preparationId: string;
      readonly evaluation: SigningSessionSealEvaluationResult;
    }
);

/**
 * Seals the warm PRF output of a threshold session. A prepared registration seal uses the blind
 * and the evaluation that the registration request carried; otherwise a new blind goes to the
 * seal route.
 */
async function runSigningSessionSealAndPersist(
  args: SigningSessionSealExecution,
): Promise<OkSealResult | ErrResult> {
  const thresholdSessionId = normalizeOptionalTrimmedString(args.thresholdSessionId);
  if (!thresholdSessionId) {
    return { ok: false, code: 'invalid_args', message: 'Missing threshold sessionId' };
  }
  const activeEntry = warmSessionPrfHandles.read(thresholdSessionId);
  if (!activeEntry.ok) return activeEntry;
  const entry = activeEntry.entry;
  const singleFlightKey = makeSigningSessionSealSingleFlightKey({
    operation: 'seal',
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
      const blindStartedAt = performance.now();
      const blind =
        args.kind === 'prepared_response'
          ? await sealPreparations.takeExact(thresholdSessionId, args.preparationId)
          : await blindNewSigningSessionSealInput();
      recordWarmSessionSealAndPersistDiagnosticDuration({
        diagnostics,
        bucket: 'blindMs',
        startedAt: blindStartedAt,
      });
      let blindOwned = true;
      try {
        const routeStartedAt = performance.now();
        const evaluation =
          args.kind === 'prepared_response'
            ? args.evaluation
            : await callSigningSessionSealEvaluateRoute({
                relayerUrl: args.transport.relayerUrl,
                bearerToken: args.transport.walletSessionToken,
                thresholdSessionId,
                blindedElementB64u: blind.blindedElementB64u,
                ...(args.transport.keyVersion ? { keyVersion: args.transport.keyVersion } : {}),
              });
        if (args.kind === 'server_route') {
          recordWarmSessionSealAndPersistDiagnosticDuration({
            diagnostics,
            bucket: 'serverRouteMs',
            startedAt: routeStartedAt,
          });
        }
        if (!evaluation.ok) return evaluation;
        const policyUpdateStartedAt = performance.now();
        const policy = resolvePolicyFromServerAndLocal({
          localRemainingUses: entry.remainingUses,
          localExpiresAtMs: entry.expiresAtMs,
          serverRemainingUses: evaluation.remainingUses,
          serverExpiresAtMs: evaluation.expiresAtMs,
        });
        if (!policy.ok) {
          warmSessionPrfHandles.deleteEntry(thresholdSessionId, entry);
          return policy;
        }
        const current = warmSessionPrfHandles.applyPolicy(thresholdSessionId, entry, policy);
        if (!current.ok) return current;
        recordWarmSessionSealAndPersistDiagnosticDuration({
          diagnostics,
          bucket: 'policyUpdateMs',
          startedAt: policyUpdateStartedAt,
        });
        const finalizeStartedAt = performance.now();
        const secret32 = base64UrlDecode(activeEntry.secret.prfFirstB64u);
        blindOwned = false;
        let sealedSecretB64u: string;
        try {
          sealedSecretB64u = await sealSigningSessionSecret({
            blind,
            scope: { walletId: args.transport.walletId, thresholdSessionId },
            evaluation,
            secret32,
          });
        } finally {
          secret32.fill(0);
        }
        recordWarmSessionSealAndPersistDiagnosticDuration({
          diagnostics,
          bucket: 'finalizeMs',
          startedAt: finalizeStartedAt,
        });
        return {
          ok: true,
          sealedSecretB64u,
          keyVersion: evaluation.keyVersion,
          remainingUses: policy.remainingUses,
          expiresAtMs: policy.expiresAtMs,
          diagnostics,
        };
      } finally {
        if (blindOwned) discardSigningSessionSealBlind(blind);
      }
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'internal',
        message:
          error instanceof Error ? error.message : String(error || 'Failed to seal warm session'),
      };
    }
  })().finally(() => {
    signingSessionSealApplyInFlight.delete(singleFlightKey);
  });

  signingSessionSealApplyInFlight.set(singleFlightKey, task);
  return await task;
}

/** Restores the warm PRF output from a sealed record with one evaluation of its blinded input. */
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
  const keyVersion = normalizeOptionalNonEmptyString(args.keyVersion) || args.transport.keyVersion;
  const singleFlightKey = makeSigningSessionSealSingleFlightKey({
    operation: 'restore',
    thresholdSessionId,
    relayerUrl: args.transport.relayerUrl,
    keyVersion,
    payloadKey: sealedSecretB64u,
  });
  const inFlight = signingSessionSealRemoveInFlight.get(singleFlightKey);
  if (inFlight) return await inFlight;
  const expected = warmSessionPrfHandles.revision(thresholdSessionId);

  const task = (async (): Promise<OkResult | ErrResult> => {
    try {
      const opening = await blindSealedSigningSessionSecret(sealedSecretB64u);
      let blindOwned = true;
      try {
        const evaluation = await callSigningSessionSealEvaluateRoute({
          relayerUrl: args.transport.relayerUrl,
          bearerToken: args.transport.walletSessionToken,
          thresholdSessionId,
          blindedElementB64u: opening.blind.blindedElementB64u,
          ...(keyVersion ? { keyVersion } : {}),
        });
        if (!evaluation.ok) return evaluation;
        blindOwned = false;
        const secret32 = await openSigningSessionSecret({
          opening,
          scope: { walletId: args.transport.walletId, thresholdSessionId },
          evaluation,
        });
        const prfFirstB64u = base64UrlEncode(secret32);
        secret32.fill(0);
        const policy = resolvePolicyFromServerAndLocal({
          localRemainingUses,
          localExpiresAtMs,
          serverRemainingUses: evaluation.remainingUses,
          serverExpiresAtMs: evaluation.expiresAtMs,
        });
        if (!policy.ok) return policy;

        return warmSessionPrfHandles.rehydrate({
          thresholdSessionId,
          expected,
          prfFirstB64u,
          remainingUses: policy.remainingUses,
          expiresAtMs: policy.expiresAtMs,
        });
      } finally {
        if (blindOwned) discardSigningSessionSealBlind(opening.blind);
      }
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'internal',
        message:
          error instanceof Error
            ? error.message
            : String(error || 'Failed to restore warm session'),
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

async function handleSealPreparation(
  incoming: Extract<
    PasskeyMpcSessionWorkerIncomingMessage,
    { kind: 'prepare_seal_blind' | 'discard_seal_blind' | 'read_seal_blind' }
  >,
): Promise<void> {
  try {
    const payload = incoming.payload;
    if (!payload) throw new Error('Invalid signing-session seal preparation request');
    switch (incoming.kind) {
      case 'prepare_seal_blind':
        await sealPreparations.prepare(payload.thresholdSessionId, payload.preparationId);
        postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: { ok: true } });
        return;
      case 'read_seal_blind': {
        const blindedElementB64u = await sealPreparations.readBlindedElement(
          payload.thresholdSessionId,
          payload.preparationId,
        );
        postPasskeyMpcSessionWorkerResponse(incoming.id, {
          success: true,
          data: { ok: true, blindedElementB64u },
        });
        return;
      }
      case 'discard_seal_blind':
        sealPreparations.discard(payload.thresholdSessionId, payload.preparationId);
        postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: { ok: true } });
        return;
    }
  } catch (error: unknown) {
    postPasskeyMpcSessionWorkerResponse(incoming.id, {
      success: false,
      error: error instanceof Error ? error.message : 'Signing-session seal preparation failed',
    });
  }
}

async function handleSealCompletion(
  incoming: Extract<PasskeyMpcSessionWorkerIncomingMessage, { kind: 'complete_seal' }>,
): Promise<void> {
  const payload = incoming.payload;
  if (!payload) {
    postPasskeyMpcSessionWorkerResponse(incoming.id, {
      success: false,
      error: 'Invalid signing-session seal completion request',
    });
    return;
  }
  const result = await runSigningSessionSealAndPersist({
    kind: 'prepared_response',
    thresholdSessionId: payload.thresholdSessionId,
    preparationId: payload.preparationId,
    transport: payload.transport,
    evaluation: payload.evaluation,
  });
  postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: result });
}

/** Starts the OPRF runtime ahead of the first seal. It never rejects; failure is data. */
async function prewarmSessionSeal(): Promise<
  { kind: 'succeeded'; elapsedMs: number } | { kind: 'failed'; elapsedMs: number }
> {
  const startedAt = performance.now();
  try {
    discardSigningSessionSealBlind(await blindNewSigningSessionSealInput());
    return { kind: 'succeeded', elapsedMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { kind: 'failed', elapsedMs: Math.round(performance.now() - startedAt) };
  }
}

self.onmessage = (event: MessageEvent) => {
  const incoming = parsePasskeyMpcSessionWorkerMessage(event.data);
  switch (incoming.kind) {
    case 'prepare_seal_blind':
    case 'discard_seal_blind':
    case 'read_seal_blind':
      void handleSealPreparation(incoming);
      return;
    case 'complete_seal':
      void handleSealCompletion(incoming);
      return;
    case 'ping':
      postPasskeyMpcSessionWorkerResponse(incoming.id, { success: true, data: { ok: true } });
      return;
    case 'prewarm':
      void (async () => {
        const outcome = await prewarmSessionSeal();
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
        warmSessionPrfHandles.store({
          thresholdSessionId,
          prfFirstB64u,
          expiresAtMs,
          remainingUses,
        });
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
        data: warmSessionPrfHandles.readClaim(incoming.payload.thresholdSessionId),
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
              result: warmSessionPrfHandles.readClaim(thresholdSessionId),
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
        data: warmSessionPrfHandles.claim(
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
        data: warmSessionPrfHandles.consume(
          incoming.payload.thresholdSessionId,
          incoming.payload.uses,
        ),
      });
      return;
    case 'volatile_clear': {
      const command = parseClearVolatileWarmMaterialCommand(incoming.payload);
      if (command?.scope.kind === 'session') {
        sealPreparations.clearSession(String(command.scope.thresholdSessionId));
        warmSessionPrfHandles.delete(String(command.scope.thresholdSessionId));
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
