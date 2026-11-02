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

export type TransactionReview = {
  readonly title: string;
  readonly validity: TransactionReviewValidity;
  readonly render: (controls: TransactionReviewControls) => ReactNode;
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

export function validateTransactionReview(input: unknown): TransactionReview {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TransactionReviewError('review_invalid_input', 'Review must be an object');
  }
  const review = input as Record<string, unknown>;
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
  return Object.freeze({
    title,
    validity,
    render: review.render as TransactionReview['render'],
    ...(typeof review.className === 'string' ? { className: review.className } : {}),
    ...(review.origin !== undefined ? { origin: validateReviewOrigin(review.origin) } : {}),
    ...(typeof review.onVisible === 'function'
      ? { onVisible: review.onVisible as NonNullable<TransactionReview['onVisible']> }
      : {}),
  });
}

/** Reviewed calls require an explicit wallet approval when an override is supplied. */
export type ReviewedTransactionInput<T> = T extends { options?: infer Options }
  ?
      | (T & { readonly review?: never })
      | (Omit<T, 'options'> & {
          readonly review: TransactionReview;
          readonly options?: Omit<NonNullable<Options>, 'confirmationConfig'> & {
            readonly confirmationConfig?: {
              readonly uiMode?: 'modal';
              readonly behavior?: 'requireClick';
              readonly autoProceedDelay?: never;
            };
          };
        })
  : T & { readonly review?: TransactionReview };
