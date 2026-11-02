import type { SeamsWeb } from '../../SeamsWeb';
import type {
  OwnerNearOperation,
  OwnerNearOutcome,
  OwnerNearReview,
  PrepareOwnerNearTransaction,
} from '../../SeamsWeb/publicApi/ownerNearOperation';
import {
  getTransactionReviewBridge,
  type TransactionReviewCapabilities,
} from '../../SeamsWeb/publicApi/transactionReview';
import { ownerNearOutcomeBeforeSigning } from '../../SeamsWeb/walletIframe/shared/transactionReview';
import { requireHost } from './boundCalls';
import { TransactionReviewError, validateTransactionReview, type TransactionReview } from './contract';
import type { ReviewHostController, ReviewOwner } from './controller';

type OwnerReviewEnvironment = {
  readonly seams: SeamsWeb;
  readonly host: ReviewHostController | null;
  readonly owner: ReviewOwner;
};

/** The operation's handle and recovery identity exist before the review opens. */
export function prepareReviewedOwnerTransaction(
  env: OwnerReviewEnvironment,
  input: PrepareOwnerNearTransaction,
  review: TransactionReview,
): OwnerNearOperation {
  const bridge = getTransactionReviewBridge(env.seams.near);
  if (!bridge) {
    throw new TransactionReviewError(
      'review_unsupported_mode',
      'Transaction review requires the hosted wallet iframe',
    );
  }
  return bridge.prepareOwnerTransaction(
    input,
    runOwnerReview.bind(null, env, String(input.authentication.walletId), validateTransactionReview(review)),
  );
}

async function runOwnerReview(
  env: OwnerReviewEnvironment,
  walletId: string,
  review: TransactionReview,
  ...args: Parameters<OwnerNearReview>
): Promise<OwnerNearOutcome> {
  const [signal, dispatch] = args;
  try {
    return await requireHost(env).run(
      env.owner,
      walletId,
      review,
      { uiMode: 'modal', behavior: 'requireClick' },
      dispatchOwnerOperation.bind(null, dispatch),
      signal,
    );
  } catch (error) {
    return ownerNearOutcomeBeforeSigning(error);
  }
}

function dispatchOwnerOperation(
  dispatch: Parameters<OwnerNearReview>[1],
  capabilities: TransactionReviewCapabilities,
): Promise<OwnerNearOutcome> {
  return dispatch(capabilities.ownerNear);
}
