import type {
  TransactionReview,
  TransactionReviewValidity,
} from '@/react/transactionReview/contract';

const render = () => null;

const unbounded: TransactionReview = {
  title: 'Review purchase',
  validity: { kind: 'unbounded' },
  render,
};

const expiring: TransactionReview = {
  title: 'Review purchase',
  validity: { kind: 'expires_at', atMs: 1 },
  render,
};

// @ts-expect-error An expiring review requires a deadline.
const missingDeadline: TransactionReviewValidity = { kind: 'expires_at' };

// @ts-expect-error An unbounded review cannot have a deadline.
const contradictoryValidity: TransactionReviewValidity = { kind: 'unbounded', atMs: 1 };

// @ts-expect-error Reviewed calls require explicit validity.
const missingValidity: TransactionReview = { title: 'Review purchase', render };

void unbounded;
void expiring;
void missingDeadline;
void contradictoryValidity;
void missingValidity;
