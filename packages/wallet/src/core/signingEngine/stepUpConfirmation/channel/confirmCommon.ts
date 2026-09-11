import type {
  TransactionSummary,
  UserConfirmDecision,
  UserConfirmResponseEnvelope,
  UserConfirmProgressEnvelope,
} from './confirmTypes';
import type { UserConfirmProgressEvent } from '../types';
import { UserConfirmMessageType } from './confirmTypes';
import { isObject, isFunction, isString } from '@shared/utils/validation';
import {
  toError,
  isTouchIdCancellationError,
  isWebAuthnRpIdOriginConfigurationError,
} from '@shared/utils/errors';
import { normalizeOptionalNonEmptyString } from '@shared/utils/normalize';

export function parseTransactionSummary(summaryData: unknown): TransactionSummary {
  if (typeof summaryData === 'string') {
    const raw = summaryData.trim();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (isObject(parsed) && !Array.isArray(parsed)) {
        return parsed as TransactionSummary;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (!isObject(summaryData) || Array.isArray(summaryData)) {
    throw new Error('Invalid secure confirm request summary: expected an object');
  }
  return summaryData as TransactionSummary;
}

// ===== Utility: postMessage sanitization (exported in case flows need to respond directly) =====
export type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? never : K;
}[keyof T];

export type ShallowPostMessageSafe<T> = T extends object
  ? Omit<Pick<T, NonFunctionKeys<T>>, '_confirmHandle'>
  : T;

export function sanitizeForPostMessage<T>(data: T): ShallowPostMessageSafe<T> {
  if (data == null) return data as ShallowPostMessageSafe<T>;
  if (Array.isArray(data)) return data.map((v) => v) as unknown as ShallowPostMessageSafe<T>;
  if (isObject(data)) {
    const src = data as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      if (key === '_confirmHandle') continue;
      const value = src[key];
      if (isFunction(value)) continue;
      out[key] = value;
    }
    return out as ShallowPostMessageSafe<T>;
  }
  return data as ShallowPostMessageSafe<T>;
}

// ===== Shared worker response + UI close helpers =====
export const ERROR_MESSAGES = {
  cancelled: 'User cancelled secure confirm request',
  collectCredentialsFailed: 'Failed to collect credentials',
  nearRpcFailed: 'Failed to fetch NEAR data',
} as const;

export type UserConfirmResponsePort = Pick<Worker, 'postMessage'> & {
  channelToken?: string;
  onDecision?: (decision: UserConfirmDecision) => void;
};

function getWorkerChannelToken(worker: UserConfirmResponsePort): string | undefined {
  return normalizeOptionalNonEmptyString(worker.channelToken);
}

export function createUserConfirmScopedWorker(
  worker: Worker,
  options?: {
    channelToken?: string;
    onDecision?: (decision: UserConfirmDecision) => void;
  },
): UserConfirmResponsePort {
  const channelToken = normalizeOptionalNonEmptyString(options?.channelToken);
  if (!channelToken && !options?.onDecision) {
    return worker;
  }
  const scopedWorker: UserConfirmResponsePort = {
    postMessage: worker.postMessage.bind(worker),
    ...(channelToken ? { channelToken } : {}),
    ...(options?.onDecision ? { onDecision: options.onDecision } : {}),
  };
  return scopedWorker;
}

export function sendConfirmResponse(
  worker: UserConfirmResponsePort,
  response: UserConfirmDecision,
  options?: { channelToken?: string },
) {
  const { _confirmHandle: _ignoredConfirmHandle, ...decision } = response;
  void _ignoredConfirmHandle;
  const requestId = isString(decision.requestId) ? decision.requestId : response.requestId;
  const channelToken =
    normalizeOptionalNonEmptyString(options?.channelToken) ?? getWorkerChannelToken(worker);
  const envelope: UserConfirmResponseEnvelope = {
    type: UserConfirmMessageType.USER_PASSKEY_CONFIRM_RESPONSE,
    requestId,
    data: decision,
    ...(channelToken ? { channelToken } : {}),
  };
  worker.onDecision?.(decision);
  worker.postMessage(envelope);
}

export function sendConfirmProgress(
  worker: UserConfirmResponsePort,
  progress: UserConfirmProgressEvent,
  options?: { channelToken?: string },
): void {
  const sanitized = sanitizeForPostMessage(progress);
  const requestId = isString(sanitized?.requestId) ? sanitized.requestId : progress.requestId;
  const channelToken =
    normalizeOptionalNonEmptyString(options?.channelToken) ?? getWorkerChannelToken(worker);
  const envelope: UserConfirmProgressEnvelope = {
    type: UserConfirmMessageType.USER_PASSKEY_CONFIRM_PROGRESS,
    requestId,
    data: sanitized as UserConfirmProgressEvent,
    ...(channelToken ? { channelToken } : {}),
  };
  worker.postMessage(envelope);
}

export function isUserCancelledUserConfirm(error: unknown): boolean {
  if (isWebAuthnRpIdOriginConfigurationError(error)) return false;
  return (
    isTouchIdCancellationError(error) ||
    (() => {
      const e = toError(error);
      return e?.name === 'NotAllowedError' || e?.name === 'AbortError';
    })()
  );
}
