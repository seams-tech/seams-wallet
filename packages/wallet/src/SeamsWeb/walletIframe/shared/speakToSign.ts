import type {
  SpeakToSignRefusalReason,
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
  SpeakToSignTransferTimes,
  SpeakToSignUnavailableReason,
} from '@/core/transactionFeatures/hostPlugin';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { isValidAccountId } from '@shared/utils/near';
import { parseWalletId } from '@shared/utils/domainIds';
import { isFiniteNumber, isNonEmptyString, isPlainObject } from '@shared/utils/validation';

/** The `PM_SPEAK_TO_SIGN_TRANSFER` payload. The vault and the owner never cross the channel. */
export type PMSpeakToSignTransferPayload = SpeakToSignTransferRequest;

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
  vault_missing: true,
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
  receiver_not_contact: true,
  verdict_mismatch: true,
  vault_rejected: true,
};
const TIME_KEYS = [
  'speechMs',
  'verifyMs',
  'checkMs',
  'transactionMs',
  'endOfSpeechToReceiptMs',
] as const;

/** Reads the iframe's answer. Anything outside the result union is a protocol error. */
export function parseSpeakToSignTransferResult(value: unknown): SpeakToSignTransferResult {
  const result = readResult(value);
  if (!result) throw new Error('Speak-to-Sign transfer result is invalid.');
  return result;
}

function readResult(value: unknown): SpeakToSignTransferResult | null {
  if (!isPlainObject(value)) return null;
  switch (value.kind) {
    case 'cancelled':
      return hasExactKeys(value, ['kind']) ? { kind: 'cancelled' } : null;
    case 'sent': {
      if (!hasExactKeys(value, ['kind', 'transactionHash', 'times'])) return null;
      const times = readTimes(value.times);
      if (!isNonEmptyString(value.transactionHash) || !times) return null;
      return { kind: 'sent', transactionHash: value.transactionHash, times };
    }
    case 'refused': {
      const reason = readReason(value, REFUSAL_REASONS);
      if (reason === null) return null;
      return typeof value.detail === 'string'
        ? { kind: 'refused', reason, detail: value.detail }
        : { kind: 'refused', reason };
    }
    case 'unavailable': {
      const reason = readReason(value, UNAVAILABLE_REASONS);
      if (reason === null) return null;
      return typeof value.detail === 'string'
        ? { kind: 'unavailable', reason, detail: value.detail }
        : { kind: 'unavailable', reason };
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
