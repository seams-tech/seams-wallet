/**
 * Worker-side handshake entrypoint.
 *
 * Called by the UserConfirm worker runtime (`passkey-confirm.worker.ts`) and waits for
 * `USER_PASSKEY_CONFIRM_RESPONSE` messages emitted by the main-thread uiConfirm runtime.
 */
import {
  WorkerConfirmationResponse,
  ConfirmPrompt,
  UserConfirmMessageType,
  RegistrationConfirmationDiagnostics,
  SerializableCredential,
  WalletSessionExpiredConfirmationFailure,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import type { WorkerUserConfirmPromptEnvelope } from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import type { NonceLeaseRef } from '@/core/signingEngine/interfaces/nonceLease';
import { isObject, isString, isBoolean } from '@shared/utils/validation';
import { toError } from '@shared/utils/errors';
import { normalizeOptionalNonEmptyString } from '@shared/utils/normalize';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { TransactionContext } from '@/core/types/rpc';
import type { NearTransactionReadiness } from '../nonce/nearTransactionReadiness';
import type { NearOperationStepUpPreparationRef } from '../interfaces/operationStepUpPreparation';

type ConfirmResponsePayload = {
  requestId: string;
  confirmed: boolean;
  intentDigest?: string;
  credential?: SerializableCredential;
  operationStepUpPreparation?: NearOperationStepUpPreparationRef;
  otpCode?: string;
  emailOtpChallengeId?: string;
  transactionContext?: TransactionContext;
  nonceLeases?: NonceLeaseRef[];
  nearTransactionReadiness?: NearTransactionReadiness;
  registrationDiagnostics?: RegistrationConfirmationDiagnostics;
  walletSessionFailure?: WalletSessionExpiredConfirmationFailure;
  error?: string;
};

type ConfirmResponseEnvelope = {
  type: UserConfirmMessageType.USER_PASSKEY_CONFIRM_RESPONSE;
  requestId?: string;
  channelToken?: string;
  data: ConfirmResponsePayload;
};

/**
 * Worker-side bridge used by the UserConfirm worker runtime to request a main-thread confirmation.
 *
 * Where this runs:
 * - Runs inside the UserConfirm Web Worker (not the main thread).
 * - Invoked from the worker runtime; the UserConfirm worker exposes this as
 *   `globalThis.awaitUserConfirmationV2` in `client/src/core/signingEngine/workerManager/workers/passkey-confirm.worker.ts`.
 *
 * High-level flow:
 * 1) UserConfirm runtime calls `awaitUserConfirmationV2(prompt)`
 * 2) This posts `PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD` to the main thread
 * 3) Main-thread uiConfirm runtime intercepts that message and runs uiConfirm handlers
 *    (`handlePromptFromWorker`), then posts back `USER_PASSKEY_CONFIRM_RESPONSE`
 * 4) This resolves to a Rust-friendly `WorkerConfirmationResponse` (snake_case fields)
 *
 * API contract:
 * - Prompt references only: normal confirmations carry a pending request id;
 *   export confirmations carry a serializable local request.
 * - The `requestId` is used to correlate responses when multiple confirmations are in-flight.
 */
export function awaitUserConfirmationV2(
  promptInput: ConfirmPrompt,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<WorkerConfirmationResponse> {
  let prompt: ConfirmPrompt;
  let requestId: string;
  try {
    prompt = normalizeConfirmPrompt(promptInput);
    requestId = requestIdForPrompt(prompt);
  } catch (error: unknown) {
    return Promise.reject(
      new Error(`[signer-worker]: invalid confirmation prompt: ${toError(error).message}`),
    );
  }

  return new Promise((resolve, reject) => {
    const channelToken = createChannelToken(requestId);

    // 2) Setup cleanup utilities for this single in-flight request.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      self.removeEventListener('message', onDecisionReceived);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('[signer-worker]: confirmation aborted'));
    };

    // 3) Wait for the matching decision message from the main thread.
    // Note: `passkey-confirm.worker.ts` intentionally ignores USER_PASSKEY_CONFIRM_RESPONSE
    // at the worker `onmessage` level and lets this handler consume it.
    const onDecisionReceived = (messageEvent: MessageEvent) => {
      const env = messageEvent?.data as unknown;
      if (!isConfirmResponseEnvelope(env)) return;
      if (!isValidUserConfirmOrigin(messageEvent)) return;
      if (resolveEnvelopeRequestId(env) !== requestId) return;
      if (!isMatchingChannelToken(env, channelToken)) return;
      cleanup();
      let response: WorkerConfirmationResponse;
      try {
        response = env.data.confirmed
          ? buildConfirmedWorkerConfirmationResponse({
              requestId,
              data: env.data,
            })
          : env.data.walletSessionFailure
            ? {
                request_id: requestId,
                intent_digest: env.data.intentDigest,
                confirmed: false,
                registration_diagnostics: env.data.registrationDiagnostics,
                wallet_session_failure: env.data.walletSessionFailure,
              }
            : {
                request_id: requestId,
                intent_digest: env.data.intentDigest,
                confirmed: false,
                registration_diagnostics: env.data.registrationDiagnostics,
                error: env.data.error,
              };
      } catch (error: unknown) {
        return reject(toError(error));
      }
      return resolve(response);
    };
    self.addEventListener('message', onDecisionReceived);

    // Optional timeout / abort support
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('[signer-worker]: confirmation timed out'));
      }, opts.timeoutMs);
    }
    if (opts.signal) {
      if (opts.signal.aborted) {
        cleanup();
        return reject(new Error('[signer-worker]: confirmation aborted'));
      }
      opts.signal.addEventListener('abort', onAbort);
    }

    // 4) Post only the prompt reference. The main thread resolves pending ids
    // against its original request so callback-bearing fields stay local.
    try {
      const promptEnvelope: WorkerUserConfirmPromptEnvelope = {
        type: UserConfirmMessageType.PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD,
        requestId,
        channelToken,
        data: prompt,
      };
      self.postMessage(promptEnvelope);
    } catch (postErr: unknown) {
      cleanup();
      console.error('[signer-worker][V2] postMessage failed', postErr);
      return reject(toError(postErr));
    }
  });
}

function normalizeConfirmPrompt(input: ConfirmPrompt): ConfirmPrompt {
  if (!isObject(input)) {
    throw new Error('expected an object');
  }
  if (input.kind === 'pending_request') {
    const requestId = normalizePromptRequestId(input.requestId);
    const requestToken = normalizePromptRequestToken(input.requestToken);
    return { kind: 'pending_request', requestId, requestToken };
  }
  if (input.kind === 'export_request') {
    if (!isObject(input.request)) {
      throw new Error('export request is missing');
    }
    normalizePromptRequestId(input.request.requestId);
    return input;
  }
  throw new Error('unsupported prompt kind');
}

function requestIdForPrompt(prompt: ConfirmPrompt): string {
  switch (prompt.kind) {
    case 'pending_request':
      return prompt.requestId;
    case 'export_request':
      return normalizePromptRequestId(prompt.request.requestId);
    default:
      return assertNever(prompt);
  }
}

function normalizePromptRequestId(value: unknown): string {
  if (!isString(value)) {
    throw new Error('missing requestId');
  }
  const requestId = value.trim();
  if (!requestId) {
    throw new Error('missing requestId');
  }
  return requestId;
}

function normalizePromptRequestToken(value: unknown): string {
  if (!isString(value)) {
    throw new Error('missing requestToken');
  }
  const requestToken = value.trim();
  if (!requestToken) {
    throw new Error('missing requestToken');
  }
  return requestToken;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected confirmation prompt kind: ${String(value)}`);
}

function buildConfirmedWorkerConfirmationResponse(args: {
  requestId: string;
  data: ConfirmResponsePayload;
}): WorkerConfirmationResponse {
  const nonceLeases = normalizeNonceLeaseRefs(args.data.nonceLeases);
  const base = {
    request_id: args.requestId,
    confirmed: true as const,
    ...(args.data.intentDigest ? { intent_digest: args.data.intentDigest } : {}),
    ...(args.data.credential ? { credential: args.data.credential } : {}),
    ...(args.data.operationStepUpPreparation
      ? { operation_step_up_preparation: args.data.operationStepUpPreparation }
      : {}),
    ...(args.data.otpCode ? { otp_code: args.data.otpCode } : {}),
    ...(args.data.emailOtpChallengeId
      ? { email_otp_challenge_id: args.data.emailOtpChallengeId }
      : {}),
    ...(args.data.registrationDiagnostics
      ? { registration_diagnostics: args.data.registrationDiagnostics }
      : {}),
  };
  if (args.data.nearTransactionReadiness) {
    if (args.data.transactionContext || nonceLeases !== undefined) {
      throw new Error('Secure confirm NEAR readiness cannot include top-level transaction context');
    }
    return {
      ...base,
      near_transaction_readiness: args.data.nearTransactionReadiness,
    };
  }
  if (args.data.transactionContext) {
    if (!nonceLeases?.length) {
      throw new Error('Secure confirm transaction response requires nonceLeases');
    }
    return {
      ...base,
      transaction_context: args.data.transactionContext,
      nonce_leases: nonceLeases,
    };
  }
  if (nonceLeases !== undefined) {
    throw new Error('Secure confirm response nonceLeases require transactionContext');
  }
  return base;
}

function normalizeNonceLeaseRefs(value: unknown): NonceLeaseRef[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('Invalid secure confirm response nonceLeases: expected array');
  }
  return value.map(normalizeNonceLeaseRef);
}

function normalizeNonceLeaseRef(value: unknown): NonceLeaseRef {
  if (!isObject(value)) {
    throw new Error('Invalid secure confirm response nonceLease: expected object');
  }
  const leaseId = normalizeNonceLeaseString(value.leaseId, 'nonceLease.leaseId');
  const operationId = normalizeNonceLeaseString(value.operationId, 'nonceLease.operationId');
  const operationFingerprint = normalizeNonceLeaseString(
    value.operationFingerprint,
    'nonceLease.operationFingerprint',
  );
  const nonce = normalizeNonceLeaseString(value.nonce, 'nonceLease.nonce');
  const batchId =
    value.batchId == null
      ? undefined
      : normalizeNonceLeaseString(value.batchId, 'nonceLease.batchId');
  const txIndex = normalizeNonceLeaseTxIndex(value.txIndex);
  return {
    leaseId,
    operationId,
    operationFingerprint,
    nonce,
    ...(batchId ? { batchId } : {}),
    ...(txIndex !== undefined ? { txIndex } : {}),
  };
}

function normalizeNonceLeaseString(value: unknown, field: string): string {
  if (!isString(value)) {
    throw new Error(`Invalid secure confirm response ${field}: expected string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Invalid secure confirm response ${field}: expected non-empty string`);
  }
  return normalized;
}

function normalizeNonceLeaseTxIndex(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Invalid secure confirm response nonceLease.txIndex: expected safe integer');
  }
  return value;
}

function isConfirmResponseEnvelope(msg: unknown): msg is ConfirmResponseEnvelope {
  if (!isObject(msg)) return false;
  if (msg.type !== UserConfirmMessageType.USER_PASSKEY_CONFIRM_RESPONSE) return false;
  const data = msg.data;
  if (!isObject(data)) return false;
  return isString(data.requestId) && isBoolean(data.confirmed);
}

function createChannelToken(requestId: string): string {
  const seed = String(requestId || '').trim() || 'sc';
  const randomPart = secureRandomBase64Url(32, 'user confirmation channel tokens');
  return `${seed}:${randomPart}`;
}

function resolveEnvelopeRequestId(env: ConfirmResponseEnvelope): string {
  const topLevelRequestId = isString(env.requestId) ? env.requestId.trim() : '';
  if (topLevelRequestId) {
    return topLevelRequestId;
  }
  return String(env.data.requestId || '').trim();
}

function isMatchingChannelToken(env: ConfirmResponseEnvelope, expectedChannelToken: string): boolean {
  return (normalizeOptionalNonEmptyString(env.channelToken) || '') === expectedChannelToken;
}

function isValidUserConfirmOrigin(messageEvent: MessageEvent): boolean {
  const origin = messageEvent.origin.trim();
  if (!origin) {
    return true;
  }
  try {
    const selfOrigin = String(self.location?.origin || '').trim();
    return !!selfOrigin && origin === selfOrigin;
  } catch {
    return false;
  }
}
