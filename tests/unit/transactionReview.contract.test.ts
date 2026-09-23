import { expect, test } from '@playwright/test';
import {
  TransactionReviewError,
  validateTransactionReview,
} from '@/react/transactionReview/contract';

const render = () => null;

test('review input is normalized once and expired quotes cannot open', () => {
  const review = validateTransactionReview({
    title: '  Review purchase  ',
    validity: { kind: 'expires_at', atMs: Date.now() + 60_000 },
    render,
  });
  expect(review.title).toBe('Review purchase');
  expect(Object.isFrozen(review.validity)).toBe(true);

  expect(() =>
    validateTransactionReview({
      title: 'Review purchase',
      validity: { kind: 'expires_at', atMs: Date.now() - 1 },
      render,
    }),
  ).toThrowError(TransactionReviewError);
  expect(() =>
    validateTransactionReview({
      title: 'Review purchase',
      validity: { kind: 'unbounded', atMs: Date.now() + 60_000 },
      render,
    }),
  ).toThrowError(TransactionReviewError);
});
