import { base64UrlEncode } from '@shared/utils/encoders';
import { sha256BytesUtf8 } from '@shared/utils/digests';
import { failure } from '@shared/utils/failure';
import type {
  CreateSigningSessionSealServiceOptions,
  SigningSessionSealAuthorizationSessionRecord,
  SigningSessionSealEvaluateRequest,
  SigningSessionSealRouteResult,
  SigningSessionSealService,
} from './signingSessionSeal.types';

const SIGNING_SESSION_SEAL_LOG_LABEL = '[threshold-signing-session-seal]';
const SIGNING_SESSION_SEAL_IDEMPOTENCY_TTL_MS_DEFAULT = 90_000;
const SIGNING_SESSION_SEAL_REPLAYABLE_ERROR_CODES = new Set([
  'expired',
  'exhausted',
  'forbidden',
  'not_found',
  'invalid_blinded_element',
  'invalid_key_version',
]);

function toMessage(input: unknown, defaultMessage: string): string {
  const value = String(input || '').trim();
  return value || defaultMessage;
}

function toCode(input: unknown, defaultCode: string): string {
  const value = String(input || '').trim();
  return value || defaultCode;
}

function toPositiveInt(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
}

function isExpired(
  session: Pick<SigningSessionSealAuthorizationSessionRecord, 'expiresAtMs'>,
  nowMs: number,
): boolean {
  return !Number.isFinite(session.expiresAtMs) || session.expiresAtMs <= nowMs;
}

async function emitAudit(input: {
  options: CreateSigningSessionSealServiceOptions;
  thresholdSessionId: string;
  userId: string;
  result: SigningSessionSealRouteResult;
  startedAtMs: number;
  nowMs: () => number;
}): Promise<void> {
  if (!input.options.audit) return;
  try {
    await input.options.audit({
      thresholdSessionId: input.thresholdSessionId,
      userId: input.userId,
      ok: input.result.ok,
      ...(input.result.ok ? {} : { code: input.result.code }),
      durationMs: Math.max(0, input.nowMs() - input.startedAtMs),
    });
  } catch {}
}

function emitOperationRequestLog(input: {
  options: CreateSigningSessionSealServiceOptions;
  thresholdSessionId: string;
  userId: string;
  keyVersion?: string;
}): void {
  const logger = input.options.logger;
  if (!logger) return;
  logger.info(`${SIGNING_SESSION_SEAL_LOG_LABEL} evaluate request`, {
    thresholdSessionId: input.thresholdSessionId,
    userId: input.userId,
    ...(input.keyVersion ? { keyVersion: input.keyVersion } : {}),
  });
}

function emitOperationResultLog(input: {
  options: CreateSigningSessionSealServiceOptions;
  thresholdSessionId: string;
  userId: string;
  result: SigningSessionSealRouteResult;
  durationMs: number;
}): void {
  const logger = input.options.logger;
  if (!logger) return;
  const payload = {
    thresholdSessionId: input.thresholdSessionId,
    userId: input.userId,
    durationMs: input.durationMs,
    ...(input.result.ok
      ? {
          keyVersion: input.result.keyVersion,
          expiresAtMs: input.result.expiresAtMs,
        }
      : {
          code: input.result.code,
          message: input.result.message,
        }),
  };
  if (input.result.ok) {
    logger.info(`${SIGNING_SESSION_SEAL_LOG_LABEL} evaluate success`, payload);
    return;
  }
  logger.warn(`${SIGNING_SESSION_SEAL_LOG_LABEL} evaluate failure`, payload);
}

type SigningSessionSealAuthInput = {
  userId: string;
  session: SigningSessionSealAuthorizationSessionRecord;
};

function signingSessionSealAuthorizationId(
  session: SigningSessionSealAuthorizationSessionRecord,
): string {
  switch (session.kind) {
    case 'exact_wallet_session_operation_credential':
      return session.thresholdSessionId;
  }
}

function fnv1aHex(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function hashBlindedElementForIdempotency(blindedElementB64u: string): Promise<string> {
  const normalized = String(blindedElementB64u || '').trim();
  if (!normalized) return '';
  try {
    const digest32 = await sha256BytesUtf8(normalized);
    return `sha256:${base64UrlEncode(digest32)}`;
  } catch {
    return `fnv1a:${fnv1aHex(normalized)}`;
  }
}

async function makeOperationRequestKey(args: {
  request: SigningSessionSealEvaluateRequest;
  auth: SigningSessionSealAuthInput;
}): Promise<string> {
  const thresholdSessionId = String(args.request.thresholdSessionId || '').trim();
  const userId = String(args.auth.userId || '').trim();
  const blindedElementB64u = String(args.request.blindedElementB64u || '').trim();
  if (!thresholdSessionId || !userId || !blindedElementB64u) return '';
  const keyVersion = String(args.request.keyVersion || '').trim();
  const blindedElementHash = await hashBlindedElementForIdempotency(blindedElementB64u);
  if (!blindedElementHash) return '';
  return [
    'signing-session-seal',
    'evaluate',
    userId,
    thresholdSessionId,
    keyVersion || '_',
    blindedElementHash,
  ].join(':');
}

function shouldPersistIdempotentResult(result: SigningSessionSealRouteResult): boolean {
  if (result.ok) return true;
  return SIGNING_SESSION_SEAL_REPLAYABLE_ERROR_CODES.has(String(result.code || '').trim());
}

async function runSealOperation(input: {
  options: CreateSigningSessionSealServiceOptions;
  request: SigningSessionSealEvaluateRequest;
  auth: SigningSessionSealAuthInput;
}): Promise<SigningSessionSealRouteResult> {
  const nowMs = input.options.nowMs || Date.now;
  const startedAtMs = nowMs();
  let result: SigningSessionSealRouteResult = failure('internal', 'Internal error');

  try {
    emitOperationRequestLog({
      options: input.options,
      thresholdSessionId: input.request.thresholdSessionId,
      userId: input.auth.userId,
      keyVersion: input.request.keyVersion,
    });

    const session = input.auth.session;
    if (signingSessionSealAuthorizationId(session) !== input.request.thresholdSessionId) {
      result = failure('forbidden', 'Wallet Session does not match requested thresholdSessionId');
      return result;
    }

    if (session.userId !== input.auth.userId) {
      result = failure('forbidden', 'thresholdSessionId does not belong to authenticated user');
      return result;
    }

    if (isExpired(session, nowMs())) {
      result = failure('expired', 'threshold session expired');
      return result;
    }

    if (input.options.guard) {
      const guard = await input.options.guard({
        thresholdSessionId: input.request.thresholdSessionId,
        auth: input.auth,
      });
      if (!guard.ok) {
        result = failure(
          toCode(guard.code, 'forbidden'),
          toMessage(guard.message, 'Request rejected'),
        );
        return result;
      }
    }

    // Router/SigningWorker private D1 owns the live signing budget. The evaluation only binds
    // the seal to the admitted wallet, threshold session and expiry, through the POPRF info.
    const evaluated = await input.options.evaluator.evaluate({
      walletId: input.auth.userId,
      thresholdSessionId: input.request.thresholdSessionId,
      keyVersion: input.request.keyVersion || input.options.evaluator.currentKeyVersion,
      blindedElementB64u: input.request.blindedElementB64u,
    });
    if (!evaluated.ok) {
      result = failure(
        toCode(evaluated.code, 'internal'),
        toMessage(evaluated.message, 'Signing-session seal evaluation failed'),
      );
      return result;
    }

    result = {
      ok: true,
      evaluatedElementB64u: evaluated.evaluatedElementB64u,
      proofB64u: evaluated.proofB64u,
      publicKeyB64u: evaluated.publicKeyB64u,
      keyVersion: evaluated.keyVersion,
      expiresAtMs: session.expiresAtMs,
    };
    return result;
  } catch (error: unknown) {
    result = failure(
      'internal',
      toMessage(error instanceof Error ? error.message : error, 'Internal error'),
    );
    return result;
  } finally {
    const durationMs = Math.max(0, nowMs() - startedAtMs);
    emitOperationResultLog({
      options: input.options,
      thresholdSessionId: input.request.thresholdSessionId,
      userId: input.auth.userId,
      result,
      durationMs,
    });
    await emitAudit({
      options: input.options,
      thresholdSessionId: input.request.thresholdSessionId,
      userId: input.auth.userId,
      result,
      startedAtMs,
      nowMs,
    });
  }
}

export function createSigningSessionSealService(
  options: CreateSigningSessionSealServiceOptions,
): SigningSessionSealService {
  const singleFlight = new Map<string, Promise<SigningSessionSealRouteResult>>();
  const nowMs = options.nowMs || Date.now;
  const idempotencyStore = options.idempotency?.store;
  const idempotencyTtlMs = toPositiveInt(
    options.idempotency?.ttlMs,
    SIGNING_SESSION_SEAL_IDEMPOTENCY_TTL_MS_DEFAULT,
  );

  const tryReplayIdempotentResult = async (
    thresholdSessionId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<SigningSessionSealRouteResult | null> => {
    if (!idempotencyStore || !idempotencyKey) return null;
    try {
      const replay = await idempotencyStore.get({
        key: idempotencyKey,
        nowMs: nowMs(),
      });
      if (!replay) return null;
      options.logger?.info(`${SIGNING_SESSION_SEAL_LOG_LABEL} idempotency_replay_hit`, {
        thresholdSessionId,
        userId,
      });
      return replay;
    } catch (error: unknown) {
      options.logger?.warn(`${SIGNING_SESSION_SEAL_LOG_LABEL} idempotency_replay_error`, {
        thresholdSessionId,
        userId,
        message: toMessage(error instanceof Error ? error.message : error, 'Unknown error'),
      });
      return null;
    }
  };

  const tryPersistIdempotentResult = async (
    thresholdSessionId: string,
    userId: string,
    idempotencyKey: string,
    result: SigningSessionSealRouteResult,
  ): Promise<void> => {
    if (!idempotencyStore || !idempotencyKey) return;
    try {
      await idempotencyStore.set({
        key: idempotencyKey,
        result,
        expiresAtMs: nowMs() + idempotencyTtlMs,
      });
    } catch (error: unknown) {
      options.logger?.warn(`${SIGNING_SESSION_SEAL_LOG_LABEL} idempotency_persist_error`, {
        thresholdSessionId,
        userId,
        message: toMessage(error instanceof Error ? error.message : error, 'Unknown error'),
      });
    }
  };

  const evaluate = async (
    request: SigningSessionSealEvaluateRequest,
    auth: SigningSessionSealAuthInput,
  ): Promise<SigningSessionSealRouteResult> => {
    const operationKey = await makeOperationRequestKey({ request, auth });
    const idempotentReplay = await tryReplayIdempotentResult(
      request.thresholdSessionId,
      auth.userId,
      operationKey,
    );
    if (idempotentReplay) return idempotentReplay;

    const runAndPersist = async (): Promise<SigningSessionSealRouteResult> => {
      const result = await runSealOperation({
        options,
        request,
        auth,
      });
      if (shouldPersistIdempotentResult(result)) {
        await tryPersistIdempotentResult(
          request.thresholdSessionId,
          auth.userId,
          operationKey,
          result,
        );
      }
      return result;
    };

    if (!operationKey) {
      return await runAndPersist();
    }

    const inFlight = singleFlight.get(operationKey);
    if (inFlight) {
      options.logger?.info(`${SIGNING_SESSION_SEAL_LOG_LABEL} single_flight_hit`, {
        thresholdSessionId: request.thresholdSessionId,
        userId: auth.userId,
      });
      return await inFlight;
    }

    const task = runAndPersist().finally(() => {
      singleFlight.delete(operationKey);
    });
    singleFlight.set(operationKey, task);
    return await task;
  };

  return { evaluate };
}
