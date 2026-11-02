import { TransactionReviewAdmission } from '@/core/signingEngine/uiConfirm/transactionReviewAdmission';
import {
  parseTransactionReviewWire,
  TransactionReviewError,
} from '@/SeamsWeb/walletIframe/shared/transactionReview';
import { nearTransactionFailure } from '@/core/signingEngine/nearTransactionSubmission';
import { mountConfirmUI } from '@/core/signingEngine/uiConfirm/ui/confirm-ui';
import { walletIframeRequestIdFromBoundary } from '@/core/types/walletIframeIdentity';
import type { ChildToParentEnvelope } from '@/SeamsWeb/walletIframe/shared/messages';

const nearOutcomeStatus = { SuccessValue: '' };
const reviewedNearResult = {
  success: true,
  transactionId: 'review-transaction',
  result: {
    final_execution_status: 'FINAL',
    status: nearOutcomeStatus,
    transaction: { hash: 'review-transaction' },
    transaction_outcome: {
      id: 'review-transaction',
      outcome: {
        logs: [],
        receipt_ids: [],
        gas_burnt: 1,
        tokens_burnt: '1',
        executor_id: 'review.testnet',
        status: nearOutcomeStatus,
      },
    },
    receipts_outcome: [],
  },
};

export function prepareReview(
  rawMetadata: unknown,
  post: (message: ChildToParentEnvelope) => void,
  requestType: string,
): TransactionReviewAdmission {
  const metadata = parseTransactionReviewWire(rawMetadata);
  const admission = new TransactionReviewAdmission(
    metadata,
    'mpc',
    postState.bind(null, post),
    postError.bind(null, post, requestType, metadata.requestId),
    { kind: 'disabled' },
  );
  void approve(post, admission);
  return admission;
}

function postState(
  post: (message: ChildToParentEnvelope) => void,
  payload: Parameters<ConstructorParameters<typeof TransactionReviewAdmission>[2]>[0],
): void {
  post({ type: 'TRANSACTION_REVIEW_STATE', requestId: payload.requestId, payload });
}

// Matches the wallet host: a NEAR review that ends before signing is a typed outcome.
function postError(
  post: (message: ChildToParentEnvelope) => void,
  requestType: string,
  requestId: string,
  error: Error,
): void {
  if (requestType === 'PM_SIGN_AND_SEND_TX') {
    post({
      type: 'PM_RESULT',
      requestId,
      payload: { ok: true, result: nearTransactionFailure(error, 'not_submitted') },
    });
    return;
  }
  post({
    type: 'ERROR',
    requestId,
    payload: { code: 'code' in error ? String(error.code) : 'cancelled', message: error.message },
  });
}

async function approve(
  post: (message: ChildToParentEnvelope) => void,
  admission: TransactionReviewAdmission,
): Promise<void> {
  const requestId = walletIframeRequestIdFromBoundary(admission.metadata.requestId);
  const handle = await mountConfirmUI({
    ctx: {
      surfaceMeasurementBinding: {
        kind: 'wallet_iframe',
        requestId,
        transactionReview: admission,
        postMeasurement: postMeasurement.bind(null, post),
      },
    },
    summary: { title: 'Wallet approval', body: 'Authorize the actual transaction' },
    model: {
      chain: 'evm',
      chainId: 1,
      operations: [
        {
          id: 'purchase',
          kind: 'generic.contractCall',
          label: 'Purchase',
          fields: [{ label: 'Recipient', value: 'receiver.testnet' }],
        },
      ],
    },
    securityContext: { rpId: 'wallet.example.localhost' },
    loading: false,
    theme: 'light',
    uiMode: 'modal',
  });
  const decision = await handle.takeDecision();
  if (decision.kind === 'confirmed') {
    admission.beforeSigning();
    window.parent.postMessage({ type: 'TEST_REVIEW_SIGNED' }, '*');
    await Reflect.get(window, 'reviewResultGate');
    post({
      type: 'PM_RESULT',
      requestId,
      payload: { ok: true, result: reviewedNearResult },
    });
  } else {
    admission.cancel(new TransactionReviewError('cancelled', 'Wallet approval cancelled'));
  }
  admission.finish();
  handle.close(decision.kind === 'confirmed');
}

function postMeasurement(
  post: (message: ChildToParentEnvelope) => void,
  payload: Parameters<
    Extract<
      Parameters<typeof mountConfirmUI>[0]['ctx']['surfaceMeasurementBinding'],
      { kind: 'wallet_iframe' }
    >['postMeasurement']
  >[0],
): void {
  post({ type: 'SURFACE_MEASUREMENT', payload });
}

export { TransactionReviewAdmission };
