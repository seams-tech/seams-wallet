import type {
  SpeakToSignEnrollmentRefusalReason,
  SpeakToSignEnrollmentRequest,
  SpeakToSignEnrollmentResult,
  SpeakToSignMessageRefusalReason,
  SpeakToSignMessageResult,
  SpeakToSignNoteRefusalReason,
  SpeakToSignNoteResult,
  SpeakToSignProgress,
  SpeakToSignRefusalReason,
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
  SpeakToSignTransferTimes,
  SpeakToSignUnavailableReason,
} from '@/core/transactionFeatures/hostPlugin';
import { BET_OUTCOMES, type BetOutcome } from '@/core/transactionFeatures/spokenBet';
import { NOTE_RATINGS, type NoteRating } from '@/core/transactionFeatures/spokenNote';
import type { VoiceApproval } from '@/core/transactionFeatures/voiceVerdict';
import {
  isActionArgsWasm,
  validateActionArgsWasm,
  type ActionArgsWasm,
  type TransactionInputWasm,
} from '@/core/types/actions';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { isValidAccountId } from '@shared/utils/near';
import { parseWalletId } from '@shared/utils/domainIds';
import { isFiniteNumber, isNonEmptyString, isPlainObject } from '@shared/utils/validation';
import type { Variant } from '@shared/utils/variant';

/** The `PM_SPEAK_TO_SIGN_TRANSFER` payload. The owner never crosses the channel. */
export type PMSpeakToSignTransferPayload = Omit<SpeakToSignTransferRequest, 'onProgress'>;

/** A progress message of one spoken request, from the Wallet iframe to the app. */
export type SpeakToSignProgressV1 = Readonly<{
  event: 'speak_to_sign_progress_v1';
  progress: SpeakToSignProgress;
}>;

export function parseSpeakToSignProgressV1(value: unknown): SpeakToSignProgressV1 | null {
  if (!hasExactKeys(value, ['event', 'progress']) || value.event !== 'speak_to_sign_progress_v1') {
    return null;
  }
  const progress = readProgress(value.progress);
  return progress ? { event: 'speak_to_sign_progress_v1', progress } : null;
}

function readProgress(value: unknown): SpeakToSignProgress | null {
  if (!isPlainObject(value)) return null;
  switch (value.stage) {
    case 'recording_sent':
    case 'verifier_running':
    case 'transaction_sent':
      return hasExactKeys(value, ['stage']) ? { stage: value.stage } : null;
    case 'verdict': {
      if (!hasExactKeys(value, ['stage', 'ms']) || !isPlainObject(value.ms)) return null;
      const entries = Object.entries(value.ms);
      return entries.every(([, ms]) => isFiniteNumber(ms))
        ? { stage: 'verdict', ms: Object.fromEntries(entries) as Record<string, number> }
        : null;
    }
    case 'step_up':
      return hasExactKeys(value, ['stage', 'policyText']) &&
        (value.policyText === null || typeof value.policyText === 'string')
        ? { stage: 'step_up', policyText: value.policyText }
        : null;
    case 'settled':
      return hasExactKeys(value, ['stage', 'transactionHash']) &&
        isNonEmptyString(value.transactionHash)
        ? { stage: 'settled', transactionHash: value.transactionHash }
        : null;
    default:
      return null;
  }
}

/** The `PM_SPEAK_TO_SIGN_ENROLL` payload. The owner never crosses the channel. */
export type PMSpeakToSignEnrollPayload = SpeakToSignEnrollmentRequest;

export function parseSpeakToSignEnrollPayload(value: unknown): PMSpeakToSignEnrollPayload {
  if (!hasExactKeys(value, ['walletId']) || !parseWalletId(value.walletId).ok) {
    throw new Error('Speak-to-Sign enrollment request is invalid.');
  }
  return { walletId: String(value.walletId) };
}

/** The `PM_SPEAK_TO_SIGN_NOTE` payload: one note, rating, merge approval or market bet. */
export type PMSpeakToSignNotePayload = Readonly<{
  walletId: string;
  action:
    | Readonly<{
        kind: 'community_note';
        contract: string;
        postId: number;
        text: string;
        summary: string;
      }>
    | Readonly<{ kind: 'note_rating'; contract: string; noteId: number; rating: NoteRating }>
    | Readonly<{
        kind: 'merge_approval';
        contract: string;
        repo: string;
        pullRequest: number;
        base: string;
        headCommit: string;
      }>
    | Readonly<{
        kind: 'market_bet';
        /** The market contract. */
        contract: string;
        token: string;
        marketId: number;
        outcome: BetOutcome;
        /** Decimal base units of the token (10^-6 USDC). Wallet core checks the amount rules. */
        amountUnits: string;
      }>
    | Readonly<{
        kind: 'transaction';
        /** The receiver and the actions in the signer's wire form. */
        transaction: TransactionInputWasm;
        summary: string;
      }>
    /** One NEP-413 message. Its result is a `SpeakToSignMessageResult`. */
    | Readonly<{
        kind: 'signed_message';
        message: string;
        recipient: string;
        callbackUrl?: string;
        state?: string;
        summary: string;
      }>;
}>;

/** Generous text bounds; Wallet core checks the exact note and summary rules. */
const MAX_NOTE_TEXT_LENGTH = 1_200;
const MAX_SUMMARY_TEXT_LENGTH = 200;
/** Generous bounds of a NEP-413 message. Wallet core signs the exact text. */
const MAX_MESSAGE_LENGTH = 16_384;
const MAX_MESSAGE_FIELD_LENGTH = 2_048;
/** NEAR takes at most 100 actions in one transaction. */
const MAX_TRANSACTION_ACTIONS = 100;
/** Base units up to 1,000,000 USDC have at most 13 digits. */
const BET_UNITS_PATTERN = /^[1-9]\d{0,12}$/;

export function parseSpeakToSignNotePayload(value: unknown): PMSpeakToSignNotePayload {
  const action = readNoteAction(isPlainObject(value) ? value.action : undefined);
  if (!hasExactKeys(value, ['walletId', 'action']) || !parseWalletId(value.walletId).ok || !action) {
    throw new Error('Speak-to-Sign note request is invalid.');
  }
  return { walletId: String(value.walletId), action };
}

function readTransactionAction(
  value: Record<string, unknown>,
): PMSpeakToSignNotePayload['action'] | null {
  const { transaction, summary } = value;
  if (
    !hasExactKeys(value, ['kind', 'transaction', 'summary']) ||
    typeof summary !== 'string' ||
    summary.length > MAX_SUMMARY_TEXT_LENGTH ||
    !hasExactKeys(transaction, ['receiverId', 'actions']) ||
    typeof transaction.receiverId !== 'string' ||
    !isValidAccountId(transaction.receiverId) ||
    !Array.isArray(transaction.actions) ||
    transaction.actions.length === 0 ||
    transaction.actions.length > MAX_TRANSACTION_ACTIONS
  ) {
    return null;
  }
  const actions: ActionArgsWasm[] = [];
  for (const action of transaction.actions) {
    if (!isActionArgsWasm(action)) return null;
    try {
      validateActionArgsWasm(action);
    } catch {
      return null;
    }
    actions.push(action);
  }
  return {
    kind: 'transaction',
    transaction: { receiverId: transaction.receiverId, actions },
    summary,
  };
}

function readMessageAction(
  value: Record<string, unknown>,
): PMSpeakToSignNotePayload['action'] | null {
  const optional = (['callbackUrl', 'state'] as const).filter((key) => key in value);
  const { message, recipient, summary, callbackUrl, state } = value;
  if (
    !hasExactKeys(value, ['kind', 'message', 'recipient', 'summary', ...optional]) ||
    !isBoundedString(message, MAX_MESSAGE_LENGTH) ||
    !isBoundedString(recipient, MAX_MESSAGE_FIELD_LENGTH) ||
    typeof summary !== 'string' ||
    summary.length > MAX_SUMMARY_TEXT_LENGTH ||
    ('callbackUrl' in value && !isBoundedString(callbackUrl, MAX_MESSAGE_FIELD_LENGTH)) ||
    ('state' in value && !isBoundedString(state, MAX_MESSAGE_FIELD_LENGTH))
  ) {
    return null;
  }
  return {
    kind: 'signed_message',
    message,
    recipient,
    ...(typeof callbackUrl === 'string' ? { callbackUrl } : {}),
    ...(typeof state === 'string' ? { state } : {}),
    summary,
  };
}

function readNoteAction(value: unknown): PMSpeakToSignNotePayload['action'] | null {
  if (isPlainObject(value) && value.kind === 'transaction') return readTransactionAction(value);
  if (isPlainObject(value) && value.kind === 'signed_message') return readMessageAction(value);
  if (!isPlainObject(value) || typeof value.contract !== 'string') return null;
  if (!isValidAccountId(value.contract)) return null;
  if (value.kind === 'merge_approval') {
    // Wallet core checks the exact repository, base and commit rules.
    if (
      !hasExactKeys(value, ['kind', 'contract', 'repo', 'pullRequest', 'base', 'headCommit']) ||
      !isNoteId(value.pullRequest) ||
      !isBoundedString(value.repo, 141) ||
      !isBoundedString(value.base, 32) ||
      !isBoundedString(value.headCommit, 40)
    ) {
      return null;
    }
    return {
      kind: 'merge_approval',
      contract: value.contract,
      repo: value.repo,
      pullRequest: value.pullRequest,
      base: value.base,
      headCommit: value.headCommit,
    };
  }
  if (value.kind === 'market_bet') {
    const outcome = BET_OUTCOMES.find((candidate) => candidate === value.outcome);
    if (
      !hasExactKeys(value, ['kind', 'contract', 'token', 'marketId', 'outcome', 'amountUnits']) ||
      typeof value.token !== 'string' ||
      !isValidAccountId(value.token) ||
      !isNoteId(value.marketId) ||
      !outcome ||
      typeof value.amountUnits !== 'string' ||
      !BET_UNITS_PATTERN.test(value.amountUnits)
    ) {
      return null;
    }
    return {
      kind: 'market_bet',
      contract: value.contract,
      token: value.token,
      marketId: value.marketId,
      outcome,
      amountUnits: value.amountUnits,
    };
  }
  if (value.kind === 'community_note') {
    if (
      !hasExactKeys(value, ['kind', 'contract', 'postId', 'text', 'summary']) ||
      !isNoteId(value.postId) ||
      typeof value.text !== 'string' ||
      value.text.length > MAX_NOTE_TEXT_LENGTH ||
      typeof value.summary !== 'string' ||
      value.summary.length > MAX_SUMMARY_TEXT_LENGTH
    ) {
      return null;
    }
    return {
      kind: 'community_note',
      contract: value.contract,
      postId: value.postId,
      text: value.text,
      summary: value.summary,
    };
  }
  if (value.kind === 'note_rating') {
    const rating = NOTE_RATINGS.find((candidate) => candidate === value.rating);
    if (!hasExactKeys(value, ['kind', 'contract', 'noteId', 'rating']) || !isNoteId(value.noteId)) {
      return null;
    }
    return rating
      ? { kind: 'note_rating', contract: value.contract, noteId: value.noteId, rating }
      : null;
  }
  return null;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isNoteId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
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
  cosigner_refused: true,
  transaction_failed: true,
};
const NOTE_REFUSAL_REASONS: Readonly<Record<SpeakToSignNoteRefusalReason, true>> = {
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
  summary_not_speakable: true,
  note_not_valid: true,
  merge_not_valid: true,
  bet_not_valid: true,
  transaction_not_valid: true,
  verdict_mismatch: true,
  cosigner_refused: true,
  transaction_failed: true,
};
const MESSAGE_REFUSAL_REASONS: Readonly<Record<SpeakToSignMessageRefusalReason, true>> = {
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
  summary_not_speakable: true,
  message_not_valid: true,
  verdict_mismatch: true,
  cosigner_refused: true,
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
  const result = readResult(value, REFUSAL_REASONS);
  if (!result) throw new Error('Speak-to-Sign transfer result is invalid.');
  return result;
}

/** Reads the iframe's note or rating answer. Anything outside the union is a protocol error. */
export function parseSpeakToSignNoteResult(value: unknown): SpeakToSignNoteResult {
  const result = readResult(value, NOTE_REFUSAL_REASONS);
  if (!result) throw new Error('Speak-to-Sign note result is invalid.');
  return result;
}

/** Reads the iframe's signed-message answer. Anything outside the union is a protocol error. */
export function parseSpeakToSignMessageResult(value: unknown): SpeakToSignMessageResult {
  const result = readMessageResult(value);
  if (!result) throw new Error('Speak-to-Sign message result is invalid.');
  return result;
}

function readMessageResult(value: unknown): SpeakToSignMessageResult | null {
  if (!isPlainObject(value)) return null;
  switch (value.kind) {
    case 'signed': {
      const keys = ['kind', 'accountId', 'publicKey', 'signature', 'nonce', 'approval', 'times'];
      if (!hasExactKeys(value, 'state' in value ? [...keys, 'state'] : keys)) return null;
      const { accountId, publicKey, signature, nonce, approval, state } = value;
      const times = readTimes(value.times);
      if (
        !isNonEmptyString(accountId) ||
        !isNonEmptyString(publicKey) ||
        !isNonEmptyString(signature) ||
        !isNonEmptyString(nonce) ||
        typeof approval !== 'string' ||
        !Object.hasOwn(APPROVALS, approval) ||
        !times ||
        ('state' in value && typeof state !== 'string')
      ) {
        return null;
      }
      return {
        kind: 'signed',
        accountId,
        publicKey,
        signature,
        nonce,
        ...(typeof state === 'string' ? { state } : {}),
        approval: approval as VoiceApproval,
        times,
      };
    }
    case 'refused': {
      const reason = readReason(value, MESSAGE_REFUSAL_REASONS);
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

function readResult<R extends string>(
  value: unknown,
  refusals: Readonly<Record<R, true>>,
): SpokenResultOf<R> | null {
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
      const reason = readReason(value, refusals);
      if (reason === null) return null;
      return typeof value.detail === 'string'
        ? { kind: 'refused', reason, detail: value.detail }
        : { kind: 'refused', reason };
    }
    default:
      return null;
  }
}

/** A transfer, note or rating result whose refusals are `R`; the other kinds are shared. */
type SpokenResultOf<R extends string> =
  | Variant<SpeakToSignTransferResult, 'kind', 'sent' | 'cancelled' | 'unavailable'>
  | Readonly<{ kind: 'refused'; reason: R; detail?: string }>;

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
