import type { ConfirmationConfig } from '@/core/types/signer-worker';

export type TransactionReviewValidity =
  | { readonly kind: 'unbounded'; readonly atMs?: never }
  | { readonly kind: 'expires_at'; readonly atMs: number };

export type TransactionReviewErrorCode =
  | 'cancelled'
  | 'review_expired'
  | 'review_invalid_input'
  | 'review_host_unavailable'
  | 'review_owner_disposed'
  | 'review_unsupported_mode'
  | 'review_identity_changed'
  | 'review_render_failed'
  | 'review_prepare_timeout';

export class TransactionReviewError extends Error {
  constructor(
    readonly code: TransactionReviewErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TransactionReviewError';
  }
}

export type TransactionReviewIdentity = {
  readonly connectionId: string;
  readonly requestId: string;
  readonly surfaceId: string;
  readonly generation: number;
};

export type TransactionReviewWire = TransactionReviewIdentity & {
  readonly kind: 'transaction_review_v1';
  readonly validity: TransactionReviewValidity;
};

export type TransactionReviewPhase = 'prepared' | 'activated' | 'signing' | 'cancelled';
export type TransactionReviewStateMessage = TransactionReviewIdentity & {
  readonly phase: TransactionReviewPhase;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) return false;
  }
  return true;
}

export function parseTransactionReviewValidity(value: unknown): TransactionReviewValidity {
  if (isRecord(value)) {
    if (value.kind === 'unbounded' && onlyKeys(value, ['kind'])) {
      return Object.freeze({ kind: 'unbounded' });
    }
    if (
      value.kind === 'expires_at' &&
      onlyKeys(value, ['kind', 'atMs']) &&
      typeof value.atMs === 'number' &&
      Number.isSafeInteger(value.atMs) &&
      value.atMs > 0
    ) {
      return Object.freeze({ kind: 'expires_at', atMs: value.atMs });
    }
  }
  throw new TransactionReviewError(
    'review_invalid_input',
    'Review requires explicit validity and a positive safe-integer expiry',
  );
}

export function assertTransactionReviewValid(validity: TransactionReviewValidity): void {
  if (validity.kind === 'expires_at' && Date.now() >= validity.atMs) {
    throw new TransactionReviewError(
      'review_expired',
      'This review has expired. Refresh the quote and try again.',
    );
  }
}

function parseIdentity(value: Record<string, unknown>): TransactionReviewIdentity {
  if (
    typeof value.connectionId !== 'string' ||
    !value.connectionId.trim() ||
    typeof value.requestId !== 'string' ||
    !value.requestId.trim() ||
    typeof value.surfaceId !== 'string' ||
    !value.surfaceId.trim() ||
    typeof value.generation !== 'number' ||
    !Number.isSafeInteger(value.generation) ||
    value.generation <= 0
  ) {
    throw new TransactionReviewError('review_invalid_input', 'Invalid transaction review identity');
  }
  return Object.freeze({
    connectionId: value.connectionId,
    requestId: value.requestId,
    surfaceId: value.surfaceId,
    generation: value.generation,
  });
}

export function parseTransactionReviewWire(value: unknown): TransactionReviewWire {
  if (
    !isRecord(value) ||
    value.kind !== 'transaction_review_v1' ||
    !onlyKeys(value, ['kind', 'connectionId', 'requestId', 'surfaceId', 'generation', 'validity'])
  ) {
    throw new TransactionReviewError('review_invalid_input', 'Invalid transaction review metadata');
  }
  const identity = parseIdentity(value);
  return Object.freeze({
    kind: 'transaction_review_v1',
    connectionId: identity.connectionId,
    requestId: identity.requestId,
    surfaceId: identity.surfaceId,
    generation: identity.generation,
    validity: parseTransactionReviewValidity(value.validity),
  });
}

export function parseTransactionReviewState(value: unknown): TransactionReviewStateMessage | null {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ['connectionId', 'requestId', 'surfaceId', 'generation', 'phase'])
  )
    return null;
  const phase = value.phase;
  if (phase !== 'prepared' && phase !== 'activated' && phase !== 'signing' && phase !== 'cancelled')
    return null;
  try {
    const identity = parseIdentity(value);
    return {
      connectionId: identity.connectionId,
      requestId: identity.requestId,
      surfaceId: identity.surfaceId,
      generation: identity.generation,
      phase,
    };
  } catch {
    return null;
  }
}

export function sameTransactionReviewIdentity(
  left: TransactionReviewIdentity,
  right: TransactionReviewIdentity,
): boolean {
  return (
    left.connectionId === right.connectionId &&
    left.requestId === right.requestId &&
    left.surfaceId === right.surfaceId &&
    left.generation === right.generation
  );
}

export function reviewedConfirmationConfig(
  stored: ConfirmationConfig,
  override: Partial<ConfirmationConfig> | undefined,
): ConfirmationConfig {
  const uiMode = override?.uiMode ?? stored.uiMode;
  const behavior = override?.behavior ?? stored.behavior;
  if (
    uiMode !== 'modal' ||
    behavior !== 'requireClick' ||
    override?.autoProceedDelay !== undefined
  ) {
    throw new TransactionReviewError(
      'review_unsupported_mode',
      'Transaction review requires modal presentation and requireClick approval',
    );
  }
  return Object.freeze({ uiMode, behavior });
}

export type TransactionReviewCancellationCode =
  | 'cancelled'
  | 'review_expired'
  | 'review_prepare_timeout'
  | 'review_owner_disposed'
  | 'review_identity_changed';

export function transactionReviewCancellationCode(
  value: unknown,
): TransactionReviewCancellationCode {
  switch (value) {
    case 'review_expired':
    case 'review_prepare_timeout':
    case 'review_owner_disposed':
    case 'review_identity_changed':
      return value;
    default:
      return 'cancelled';
  }
}
