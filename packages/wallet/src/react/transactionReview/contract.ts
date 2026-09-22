import type { ReactNode } from 'react';

import {
  assertTransactionReviewValid,
  parseTransactionReviewValidity,
  TransactionReviewError,
  type TransactionReviewValidity,
} from '../../SeamsWeb/walletIframe/shared/transactionReview';
export { TransactionReviewError } from '../../SeamsWeb/walletIframe/shared/transactionReview';
export type {
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
};

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
  return Object.freeze({
    title,
    validity,
    render: review.render as TransactionReview['render'],
    ...(typeof review.className === 'string' ? { className: review.className } : {}),
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
