import { TransactionReviewAdmission } from '@/core/signingEngine/uiConfirm/transactionReviewAdmission';
import {
  parseTransactionReviewWire,
  TransactionReviewError,
} from '@/SeamsWeb/walletIframe/shared/transactionReview';
import { mountConfirmUI } from '@/core/signingEngine/uiConfirm/ui/confirm-ui';
import { walletIframeRequestIdFromBoundary } from '@/core/types/walletIframeIdentity';
import type { ChildToParentEnvelope } from '@/SeamsWeb/walletIframe/shared/messages';

export function prepareReview(
  rawMetadata: unknown,
  post: (message: ChildToParentEnvelope) => void,
): TransactionReviewAdmission {
  const metadata = parseTransactionReviewWire(rawMetadata);
  const admission = new TransactionReviewAdmission(
    metadata,
    'mpc',
    postState.bind(null, post),
    postError.bind(null, post, metadata.requestId),
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

function postError(
  post: (message: ChildToParentEnvelope) => void,
  requestId: string,
  error: Error,
): void {
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
      payload: { ok: true, result: { success: true, transactionId: 'review-transaction' } },
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
