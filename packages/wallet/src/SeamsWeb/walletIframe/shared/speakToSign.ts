import type {
  SpeakToSignEnrollmentRefusalReason,
  SpeakToSignEnrollmentRequest,
  SpeakToSignEnrollmentResult,
  SpeakToSignRefusalReason,
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
  SpeakToSignTransferTimes,
  SpeakToSignUnavailableReason,
} from '@/core/transactionFeatures/hostPlugin';
import type { VoiceApproval } from '@/core/transactionFeatures/voiceVerdict';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { isValidAccountId } from '@shared/utils/near';
import { parseWalletId } from '@shared/utils/domainIds';
import { isFiniteNumber, isNonEmptyString, isPlainObject } from '@shared/utils/validation';
import type { Variant } from '@shared/utils/variant';

/** The `PM_SPEAK_TO_SIGN_TRANSFER` payload. The owner never crosses the channel. */
export type PMSpeakToSignTransferPayload = SpeakToSignTransferRequest;

/** The `PM_SPEAK_TO_SIGN_ENROLL` payload. The owner never crosses the channel. */
export type PMSpeakToSignEnrollPayload = SpeakToSignEnrollmentRequest;

export function parseSpeakToSignEnrollPayload(value: unknown): PMSpeakToSignEnrollPayload {
  if (!hasExactKeys(value, ['walletId']) || !parseWalletId(value.walletId).ok) {
    throw new Error('Speak-to-Sign enrollment request is invalid.');
  }
  return { walletId: String(value.walletId) };
}

/** A decimal NEAR amount as text. The host plugin decides which amounts are speakable. */
const AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,24})?$/;

export function parseSpeakToSignTransferPayload(value: unknown): PMSpeakToSignTransferPayload {
  if (
    !hasExactKeys(value, ['walletId', 'receiver', 'amount']) ||
    !parseWalletId(value.walletId).ok ||
    typeof value.receiver !== 'string' ||
    !isValidAccountId(value.receiver) ||
    typeof value.amount !== 'string' ||
    !AMOUNT_PATTERN.test(value.amount)
  ) {
    throw new Error('Speak-to-Sign transfer request is invalid.');
  }
  return {
    walletId: String(value.walletId),
    receiver: value.receiver,
    amount: value.amount,
  };
}

// Records keyed by every reason, so a new reason fails to compile until it is listed here.
const UNAVAILABLE_REASONS: Readonly<Record<SpeakToSignUnavailableReason, true>> = {
  flow_not_available: true,
  voiceid_unavailable: true,
  verifier_unavailable: true,
  not_submitted: true,
  submission_unknown: true,
};
const REFUSAL_REASONS: Readonly<Record<SpeakToSignRefusalReason, true>> = {
  quality: true,
  speaker: true,
  words: true,
  audio_reused: true,
  audio_invalid: true,
  template_missing: true,
  unsupported: true,
  speaker_unavailable: true,
  storage: true,
  transcriber_unavailable: true,
  amount_not_speakable: true,
  receiver_not_speakable: true,
  receiver_missing: true,
  verdict_mismatch: true,
  transaction_failed: true,
};
const ENROLLMENT_REFUSAL_REASONS: Readonly<Record<SpeakToSignEnrollmentRefusalReason, true>> = {
  quality: true,
  speaker: true,
  audio_reused: true,
  audio_invalid: true,
  unsupported: true,
  speaker_unavailable: true,
  storage: true,
  template_exists: true,
  not_authorized: true,
  authorization_unavailable: true,
};
const APPROVALS: Readonly<Record<VoiceApproval, true>> = { voice: true, voice_and_passkey: true };
const TIME_KEYS = ['speechMs', 'verifyMs', 'transactionMs', 'endOfSpeechToReceiptMs'] as const;

/** Reads the iframe's answer. Anything outside the result union is a protocol error. */
export function parseSpeakToSignTransferResult(value: unknown): SpeakToSignTransferResult {
  const result = readResult(value);
  if (!result) throw new Error('Speak-to-Sign transfer result is invalid.');
  return result;
}

/** Reads the iframe's enrollment answer. Anything outside the union is a protocol error. */
export function parseSpeakToSignEnrollmentResult(value: unknown): SpeakToSignEnrollmentResult {
  const result = readEnrollmentResult(value);
  if (!result) throw new Error('Speak-to-Sign enrollment result is invalid.');
  return result;
}

function readEnrollmentResult(value: unknown): SpeakToSignEnrollmentResult | null {
  if (!isPlainObject(value)) return null;
  switch (value.kind) {
    case 'enrolled': {
      if (!hasExactKeys(value, ['kind', 'templateEpoch', 'agreementMilli'])) return null;
      const { templateEpoch, agreementMilli } = value;
      if (
        !Number.isSafeInteger(templateEpoch) ||
        (templateEpoch as number) < 1 ||
        !Number.isSafeInteger(agreementMilli)
      ) {
        return null;
      }
      return {
        kind: 'enrolled',
        templateEpoch: templateEpoch as number,
        agreementMilli: agreementMilli as number,
      };
    }
    case 'refused': {
      const reason = readReason(value, ENROLLMENT_REFUSAL_REASONS);
      if (reason === null) return null;
      return typeof value.detail === 'string'
        ? { kind: 'refused', reason, detail: value.detail }
        : { kind: 'refused', reason };
    }
    case 'cancelled':
    case 'unavailable':
      return readSharedResult(value);
    default:
      return null;
  }
}

/** The `cancelled` and `unavailable` results, which both flows share. */
function readSharedResult(
  value: Record<string, unknown>,
): Variant<SpeakToSignTransferResult, 'kind', 'cancelled' | 'unavailable'> | null {
  if (value.kind === 'cancelled')
    return hasExactKeys(value, ['kind']) ? { kind: 'cancelled' } : null;
  const reason = readReason(value, UNAVAILABLE_REASONS);
  if (reason === null) return null;
  return typeof value.detail === 'string'
    ? { kind: 'unavailable', reason, detail: value.detail }
    : { kind: 'unavailable', reason };
}

function readResult(value: unknown): SpeakToSignTransferResult | null {
  if (!isPlainObject(value)) return null;
  switch (value.kind) {
    case 'cancelled':
    case 'unavailable':
      return readSharedResult(value);
    case 'sent': {
      if (!hasExactKeys(value, ['kind', 'transactionHash', 'approval', 'times'])) return null;
      const times = readTimes(value.times);
      const approval = value.approval;
      if (
        !isNonEmptyString(value.transactionHash) ||
        typeof approval !== 'string' ||
        !Object.hasOwn(APPROVALS, approval) ||
        !times
      ) {
        return null;
      }
      return {
        kind: 'sent',
        transactionHash: value.transactionHash,
        approval: approval as VoiceApproval,
        times,
      };
    }
    case 'refused': {
      const reason = readReason(value, REFUSAL_REASONS);
      if (reason === null) return null;
      return typeof value.detail === 'string'
        ? { kind: 'refused', reason, detail: value.detail }
        : { kind: 'refused', reason };
    }
    default:
      return null;
  }
}

function readReason<R extends string>(
  value: Record<string, unknown>,
  reasons: Readonly<Record<R, true>>,
): R | null {
  const keys = 'detail' in value ? ['kind', 'reason', 'detail'] : ['kind', 'reason'];
  if (!hasExactKeys(value, keys)) return null;
  if ('detail' in value && typeof value.detail !== 'string') return null;
  const reason = value.reason;
  return typeof reason === 'string' && Object.hasOwn(reasons, reason) ? (reason as R) : null;
}

function readTimes(value: unknown): SpeakToSignTransferTimes | null {
  if (!hasExactKeys(value, TIME_KEYS)) return null;
  for (const key of TIME_KEYS) {
    if (!isFiniteNumber(value[key]) || value[key] < 0) return null;
  }
  return value as SpeakToSignTransferTimes;
}
