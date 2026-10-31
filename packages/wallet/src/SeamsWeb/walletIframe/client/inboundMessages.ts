import { parseWalletConnectionRequest } from '../shared/walletAlternatives';
import { parseTransactionReviewState } from '../shared/transactionReview';
import { parseOwnerNearSubmissionProgress } from '../shared/ownerNearOperation';
import {
  type ProgressPayload,
  type PreferencesChangedPayload,
  type ErrorPayload,
  type PMResultPayload,
  isDeviceLinkEmailOtpBaseFactorSelectionProgressV1,
  isDeviceLinkTargetFactorActivationProgressV1,
  type DeviceLinkEmailOtpBaseFactorSelectionProgressV1,
  type DeviceLinkTargetFactorActivationProgressV1,
  parseWalletIframeSurfaceMeasurement,
  parseHostedAuthMenuErrorEvent,
  isRegistrationTimingSpanV1,
} from '../shared/messages';
import type { SdkLifecycleEvent } from '@/core/types/sdkSentEvents';
import { isWalletFlowEvent, parseSdkLifecycleEvent } from '@/core/types/sdkSentEvents';
import { parseHostedAuthMenuExternalAuthRequest } from '../shared/messages';
import { isObject } from '@shared/utils/validation';
import {
  parseWalletIframeExactSessionSnapshot,
  parseWalletIframeSessionRevision,
  type WalletIframeExactSessionSnapshot,
} from '../shared/exactSessionState';

type ParsedSdkLifecycleEnvelope =
  | { readonly kind: 'not_lifecycle_event' }
  | { readonly kind: 'invalid_lifecycle_event' }
  | {
      readonly kind: 'lifecycle_event';
      readonly revision: number;
      readonly event: SdkLifecycleEvent;
    };

type ParsedChildToParentEnvelope =
  | {
      readonly type: 'WALLET_CONNECTION_REQUEST';
      readonly requestId?: string;
      readonly payload: NonNullable<ReturnType<typeof parseWalletConnectionRequest>>;
    }
  | { readonly type: 'SESSION_CHANGED'; readonly payload: WalletIframeExactSessionSnapshot }
  | {
      readonly type: 'TRANSACTION_REVIEW_STATE';
      readonly requestId?: string;
      readonly payload: NonNullable<ReturnType<typeof parseTransactionReviewState>>;
    }
  | { readonly type: 'PONG'; readonly requestId?: string }
  | {
      readonly type: 'PREFERENCES_CHANGED';
      readonly requestId?: string;
      readonly payload: PreferencesChangedPayload;
    }
  | {
      readonly type: 'AUTH_MENU_EXTERNAL_AUTH_REQUEST';
      readonly requestId?: string;
      readonly payload: NonNullable<ReturnType<typeof parseHostedAuthMenuExternalAuthRequest>>;
    }
  | {
      readonly type: 'AUTH_MENU_ERROR';
      readonly requestId?: string;
      readonly payload: NonNullable<ReturnType<typeof parseHostedAuthMenuErrorEvent>>;
    }
  | {
      readonly type: 'SURFACE_MEASUREMENT';
      readonly requestId?: string;
      readonly payload: NonNullable<ReturnType<typeof parseWalletIframeSurfaceMeasurement>>;
    }
  | {
      readonly type: 'TRANSACTION_ACTIVITY';
      readonly requestId: string;
      readonly payload: 'expanded' | 'toast' | 'closed';
    }
  | { readonly type: 'PROGRESS'; readonly requestId?: string; readonly payload: ProgressPayload }
  | { readonly type: 'PM_RESULT'; readonly requestId?: string; readonly payload: PMResultPayload }
  | { readonly type: 'ERROR'; readonly requestId?: string; readonly payload: ErrorPayload };

function rawClientMessageObject(value: unknown): object | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function hasOnlyClientMessageFields(value: object, allowedFields: readonly string[]): boolean {
  const allowed = new Set(allowedFields);
  return Object.keys(value).every((field) => allowed.has(field));
}

function clientChildRequestId(value: object): string | undefined | null {
  if (!Object.hasOwn(value, 'requestId')) return undefined;
  const requestId: unknown = Reflect.get(value, 'requestId');
  if (requestId === undefined) return undefined;
  return typeof requestId === 'string' ? requestId : null;
}

function clientChildRequestIdFields(requestId: string | undefined): { requestId?: string } {
  return requestId === undefined ? {} : { requestId };
}

export function parseClientPreferencesChangedPayload(
  value: unknown,
): PreferencesChangedPayload | null {
  const record = rawClientMessageObject(value);
  if (
    !record ||
    !hasOnlyClientMessageFields(record, ['walletId', 'confirmationConfig', 'revision'])
  ) {
    return null;
  }
  const walletId: unknown = Reflect.get(record, 'walletId');
  if (walletId !== null && typeof walletId !== 'string') return null;
  const confirmationConfig = rawClientMessageObject(Reflect.get(record, 'confirmationConfig'));
  if (
    !confirmationConfig ||
    !hasOnlyClientMessageFields(confirmationConfig, ['uiMode', 'behavior', 'autoProceedDelay'])
  ) {
    return null;
  }
  const uiMode: unknown = Reflect.get(confirmationConfig, 'uiMode');
  const behavior: unknown = Reflect.get(confirmationConfig, 'behavior');
  if (uiMode !== 'none' && uiMode !== 'modal' && uiMode !== 'drawer') {
    return null;
  }
  if (behavior !== 'requireClick' && behavior !== 'skipClick') return null;
  const autoProceedDelay: unknown = Reflect.get(confirmationConfig, 'autoProceedDelay');
  if (
    autoProceedDelay !== undefined &&
    (typeof autoProceedDelay !== 'number' || !Number.isFinite(autoProceedDelay))
  ) {
    return null;
  }
  const revision: unknown = Reflect.get(record, 'revision');
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
  return {
    walletId,
    confirmationConfig:
      autoProceedDelay === undefined
        ? { uiMode, behavior }
        : { uiMode, behavior, autoProceedDelay },
    revision,
  };
}

function isClientDeviceLinkProgressCandidate(
  value: unknown,
): value is
  | DeviceLinkEmailOtpBaseFactorSelectionProgressV1
  | DeviceLinkTargetFactorActivationProgressV1 {
  const record = rawClientMessageObject(value);
  if (!record) return false;
  const event: unknown = Reflect.get(record, 'event');
  return (
    event === 'wallet_device_link_email_otp_base_factor_selection_required_v1' ||
    event === 'wallet_device_link_target_factor_activation_v1'
  );
}

function parseClientProgressPayload(value: unknown): ProgressPayload | null {
  if (isWalletFlowEvent(value)) return value;
  if (isRegistrationTimingSpanV1(value)) return value;
  try {
    const submission = parseOwnerNearSubmissionProgress(value);
    if (submission) return submission;
  } catch {
    return null;
  }
  if (!isClientDeviceLinkProgressCandidate(value)) return null;
  if (isDeviceLinkEmailOtpBaseFactorSelectionProgressV1(value)) return value;
  return isDeviceLinkTargetFactorActivationProgressV1(value) ? value : null;
}

function parseClientPmResultPayload(value: unknown): PMResultPayload | null {
  const record = rawClientMessageObject(value);
  if (!record || !hasOnlyClientMessageFields(record, ['ok', 'result', 'error'])) return null;
  const ok: unknown = Reflect.get(record, 'ok');
  if (typeof ok !== 'boolean') return null;
  const error: unknown = Reflect.get(record, 'error');
  if (error !== undefined && typeof error !== 'string') return null;
  return {
    ok,
    ...(Object.hasOwn(record, 'result') ? { result: Reflect.get(record, 'result') } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function parseClientErrorPayload(value: unknown): ErrorPayload | null {
  const record = rawClientMessageObject(value);
  if (!record || !hasOnlyClientMessageFields(record, ['code', 'message', 'details'])) return null;
  const code: unknown = Reflect.get(record, 'code');
  const message: unknown = Reflect.get(record, 'message');
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return {
    code,
    message,
    ...(Object.hasOwn(record, 'details') ? { details: Reflect.get(record, 'details') } : {}),
  };
}

export function parseClientChildToParentEnvelope(
  value: unknown,
): ParsedChildToParentEnvelope | null {
  const record = rawClientMessageObject(value);
  if (!record || !hasOnlyClientMessageFields(record, ['type', 'requestId', 'payload'])) {
    return null;
  }
  const requestId = clientChildRequestId(record);
  if (requestId === null) return null;
  const requestIdFields = clientChildRequestIdFields(requestId);
  const type: unknown = Reflect.get(record, 'type');
  switch (type) {
    case 'PONG':
      return Object.hasOwn(record, 'payload') ? null : { ...requestIdFields, type };
    case 'SESSION_CHANGED': {
      try {
        return {
          type,
          payload: parseWalletIframeExactSessionSnapshot(Reflect.get(record, 'payload')),
        };
      } catch {
        return null;
      }
    }
    case 'PREFERENCES_CHANGED': {
      const payload = parseClientPreferencesChangedPayload(Reflect.get(record, 'payload'));
      return payload ? { ...requestIdFields, type, payload } : null;
    }
    case 'WALLET_CONNECTION_REQUEST': {
      const payload = parseWalletConnectionRequest(Reflect.get(record, 'payload'));
      return payload ? { ...requestIdFields, type, payload } : null;
    }
    case 'AUTH_MENU_EXTERNAL_AUTH_REQUEST': {
      const payload = parseHostedAuthMenuExternalAuthRequest(Reflect.get(record, 'payload'));
      return payload ? { ...requestIdFields, type, payload } : null;
    }
    case 'AUTH_MENU_ERROR': {
      const payload = parseHostedAuthMenuErrorEvent(Reflect.get(record, 'payload'));
      return payload ? { ...requestIdFields, type, payload } : null;
    }
    case 'TRANSACTION_REVIEW_STATE': {
      const payload = parseTransactionReviewState(Reflect.get(record, 'payload'));
      return payload ? { ...requestIdFields, type, payload } : null;
    }
    case 'SURFACE_MEASUREMENT': {
      const payload = parseWalletIframeSurfaceMeasurement(Reflect.get(record, 'payload'));
      return payload ? { ...requestIdFields, type, payload } : null;
    }
    case 'TRANSACTION_ACTIVITY': {
      const payload = Reflect.get(record, 'payload');
      return typeof requestId === 'string' &&
        (payload === 'expanded' || payload === 'toast' || payload === 'closed')
        ? { type, requestId, payload }
        : null;
    }
    case 'PROGRESS': {
      const payload = parseClientProgressPayload(Reflect.get(record, 'payload'));
      return payload ? { ...requestIdFields, type, payload } : null;
    }
    case 'PM_RESULT': {
      const payload = parseClientPmResultPayload(Reflect.get(record, 'payload'));
      return payload ? { ...requestIdFields, type, payload } : null;
    }
    case 'ERROR': {
      const payload = parseClientErrorPayload(Reflect.get(record, 'payload'));
      return payload ? { ...requestIdFields, type, payload } : null;
    }
    default:
      return null;
  }
}

export function parseSdkLifecycleEnvelope(value: unknown): ParsedSdkLifecycleEnvelope {
  if (!isObject(value) || value.type !== 'SDK_LIFECYCLE_EVENT') {
    return { kind: 'not_lifecycle_event' };
  }
  const payload = rawClientMessageObject(value.payload);
  if (!payload) return { kind: 'invalid_lifecycle_event' };
  const event = parseSdkLifecycleEvent(Reflect.get(payload, 'event'));
  if (!event) return { kind: 'invalid_lifecycle_event' };
  try {
    const revision = parseWalletIframeSessionRevision(Reflect.get(payload, 'revision'));
    return { kind: 'lifecycle_event', revision, event };
  } catch {
    return { kind: 'invalid_lifecycle_event' };
  }
}
