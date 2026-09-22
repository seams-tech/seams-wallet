import type { ReactNode } from 'react';

export type TransactionReviewValidity =
  | { readonly kind: 'unbounded'; readonly atMs?: never }
  | { readonly kind: 'expires_at'; readonly atMs: number };

export type TransactionReviewControls = {
  readonly continueToWallet: () => void;
  readonly cancel: () => void;
  readonly fail: (error: unknown) => void;
};

export type TransactionReview = {
  readonly title: string;
  readonly validity: TransactionReviewValidity;
  readonly render: (controls: TransactionReviewControls) => ReactNode;
  readonly className?: string;
};

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
  readonly code: TransactionReviewErrorCode;

  constructor(code: TransactionReviewErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransactionReviewError';
    this.code = code;
  }
}

export type ValidatedTransactionReview = {
  readonly title: string;
  readonly validity: TransactionReviewValidity;
  readonly render: TransactionReview['render'];
  readonly className?: string;
};

export function validateTransactionReview(input: unknown): ValidatedTransactionReview {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TransactionReviewError('review_invalid_input', 'Review must be an object');
  }
  const review = input as Record<string, unknown>;
  const title = typeof review.title === 'string' ? review.title.trim() : '';
  if (!title || typeof review.render !== 'function') {
    throw new TransactionReviewError(
      'review_invalid_input',
      'Review requires a nonempty title and a render function',
    );
  }
  const rawValidity = review.validity;
  if (!rawValidity || typeof rawValidity !== 'object' || Array.isArray(rawValidity)) {
    throw new TransactionReviewError('review_invalid_input', 'Review validity is required');
  }
  const validity = rawValidity as Record<string, unknown>;
  if (validity.kind === 'unbounded') {
    if (validity.atMs !== undefined) {
      throw new TransactionReviewError('review_invalid_input', 'Unbounded review cannot expire');
    }
  } else if (validity.kind === 'expires_at') {
    if (
      typeof validity.atMs !== 'number' ||
      !Number.isSafeInteger(validity.atMs) ||
      validity.atMs <= 0
    ) {
      throw new TransactionReviewError(
        'review_invalid_input',
        'Review expiry must be a positive Unix timestamp in milliseconds',
      );
    }
    if (Date.now() >= validity.atMs) {
      throw new TransactionReviewError('review_expired', 'This review has expired');
    }
  } else {
    throw new TransactionReviewError('review_invalid_input', 'Unknown review validity');
  }
  if (review.className !== undefined && typeof review.className !== 'string') {
    throw new TransactionReviewError('review_invalid_input', 'Review className must be a string');
  }
  return Object.freeze({
    title,
    validity:
      validity.kind === 'unbounded'
        ? Object.freeze({ kind: 'unbounded' as const })
        : Object.freeze({ kind: 'expires_at' as const, atMs: validity.atMs as number }),
    render: review.render as TransactionReview['render'],
    ...(typeof review.className === 'string' ? { className: review.className } : {}),
  });
}
