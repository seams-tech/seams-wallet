import type { ReactNode } from 'react';

import {
  assertTransactionReviewValid,
  parseTransactionReviewValidity,
  TransactionReviewError,
  type TransactionReviewRect,
  type TransactionReviewSurface,
  type TransactionReviewValidity,
} from '../../SeamsWeb/walletIframe/shared/transactionReview';
export { TransactionReviewError } from '../../SeamsWeb/walletIframe/shared/transactionReview';
export type {
  TransactionReviewRect,
  TransactionReviewSurface,
  TransactionReviewValidity,
  TransactionReviewErrorCode,
} from '../../SeamsWeb/walletIframe/shared/transactionReview';

export type TransactionReviewControls = {
  readonly continueToWallet: () => void;
  readonly cancel: () => void;
  readonly fail: (error: unknown) => void;
};

/** Ends the app step that follows the Wallet step, and with it the Wallet's modal. */
export type TransactionAfterControls = {
  readonly close: () => void;
};

/**
 * App steps around the Wallet step in the Wallet's own modal. `before` is the app step before the
 * Wallet's approval (the review). `after` is the app step that shows the call's result in the same
 * modal; without it, the modal closes when the call settles.
 */
export type TransactionSteps = Omit<TransactionReview, 'render'> & {
  readonly before: (controls: TransactionReviewControls) => ReactNode;
};

export type TransactionReview = {
  readonly title: string;
  readonly validity: TransactionReviewValidity;
  readonly render: (controls: TransactionReviewControls) => ReactNode;
  /**
   * Shows the call's signed result in the Wallet's modal, in place of closing it. The call's
   * promise settles first. It runs only after the Wallet signed.
   */
  readonly after?: (outcome: unknown, controls: TransactionAfterControls) => ReactNode;
  readonly className?: string;
  /** The application element the first review surface grows from, in viewport pixels. */
  readonly origin?: TransactionReviewRect;
  /** Runs when the review or the wallet approval becomes visible. */
  readonly onVisible?: (surface: TransactionReviewSurface) => void;
};

function validateReviewOrigin(input: unknown): TransactionReviewRect {
  const rect = (input ?? {}) as Record<string, unknown>;
  const { x, y, width, height } = rect;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new TransactionReviewError(
      'review_invalid_input',
      'Review origin requires a finite position and a positive size',
    );
  }
  return Object.freeze({ x, y, width, height });
}

/** `steps` and `review` are one contract: `steps.before` is the review's `render`. */
export function validateTransactionReview(input: unknown): TransactionReview {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TransactionReviewError('review_invalid_input', 'Review must be an object');
  }
  const record = input as Record<string, unknown>;
  const review =
    record.render === undefined && record.before !== undefined
      ? { ...record, render: record.before }
      : record;
  const title = typeof review.title === 'string' ? review.title.trim() : '';
  if (
    !title ||
    typeof review.render !== 'function' ||
    review.render.constructor.name === 'AsyncFunction'
  ) {
    throw new TransactionReviewError(
      'review_invalid_input',
      'Review requires a nonempty title and a render function',
    );
  }
  const validity = parseTransactionReviewValidity(review.validity);
  assertTransactionReviewValid(validity);
  if (review.className !== undefined && typeof review.className !== 'string') {
    throw new TransactionReviewError('review_invalid_input', 'Review className must be a string');
  }
  if (review.onVisible !== undefined && typeof review.onVisible !== 'function') {
    throw new TransactionReviewError('review_invalid_input', 'Review onVisible must be a function');
  }
  if (review.after !== undefined && typeof review.after !== 'function') {
    throw new TransactionReviewError('review_invalid_input', 'Steps after must be a function');
  }
  return Object.freeze({
    title,
    validity,
    render: review.render as TransactionReview['render'],
    ...(typeof review.className === 'string' ? { className: review.className } : {}),
    ...(review.origin !== undefined ? { origin: validateReviewOrigin(review.origin) } : {}),
    ...(typeof review.onVisible === 'function'
      ? { onVisible: review.onVisible as NonNullable<TransactionReview['onVisible']> }
      : {}),
    ...(typeof review.after === 'function'
      ? { after: review.after as NonNullable<TransactionReview['after']> }
      : {}),
  });
}

/** A reviewed call shows in the Wallet's own modal and requires an explicit approval. */
type ReviewedOptions<Options> = {
  readonly presentation?: never;
  readonly options?: Omit<NonNullable<Options>, 'confirmationConfig'> & {
    readonly confirmationConfig?: {
      readonly uiMode?: 'modal';
      readonly behavior?: 'requireClick';
      readonly autoProceedDelay?: never;
    };
  };
};

/**
 * Reviewed calls require an explicit wallet approval when an override is supplied. `review` is
 * the earlier name of `steps`, with `render` in place of `before`. A call with `steps` takes the
 * same settings: the SDK checks them when the call runs.
 */
export type ReviewedTransactionInput<T> = T extends { options?: infer Options }
  ?
      | (T & { readonly review?: never; readonly steps?: TransactionSteps })
      | (Omit<T, 'options' | 'presentation'> & {
          readonly review: TransactionReview;
        } & ReviewedOptions<Options>)
  : T & { readonly review?: TransactionReview; readonly steps?: TransactionSteps };
