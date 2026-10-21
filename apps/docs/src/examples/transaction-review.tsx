import { useState } from 'react';
import {
  TransactionReviewError,
  transfer,
  useSeams,
  type BoundNearSigner,
  type TransactionReviewControls,
} from '@seams/wallet/react';

function TransferReview({ controls }: { controls: TransactionReviewControls }) {
  return (
    <>
      <p>This example sends a zero-value transfer to your own NEAR account. Gas fees apply.</p>
      <button type="button" onClick={controls.continueToWallet}>
        Continue to wallet
      </button>
      <button type="button" onClick={controls.cancel}>
        Cancel
      </button>
    </>
  );
}

function renderReview(controls: TransactionReviewControls) {
  return <TransferReview controls={controls} />;
}

async function submitTransfer(signer: BoundNearSigner, setMessage: (message: string) => void) {
  setMessage('Waiting for review and wallet approval…');
  try {
    const result = await signer.signAndSendTransaction({
      receiverId: signer.accountId,
      actions: [transfer('0 NEAR')],
      options: {
        confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' },
      },
      review: {
        title: 'Review transfer',
        validity: { kind: 'unbounded' },
        render: renderReview,
      },
    });
    setMessage(result.success ? 'Transfer submitted.' : result.error);
  } catch (error) {
    if (error instanceof TransactionReviewError && error.code === 'cancelled') {
      setMessage('Review cancelled.');
      return;
    }
    setMessage(error instanceof Error ? error.message : 'Transfer failed.');
  }
}

export function ReviewedTransferButton() {
  const { wallet } = useSeams();
  const [message, setMessage] = useState('');
  if (!wallet?.near) return <p>Sign in with a NEAR account to try this example.</p>;

  return (
    <>
      <button type="button" onClick={submitTransfer.bind(null, wallet.near, setMessage)}>
        Review transfer
      </button>
      <p role="status">{message}</p>
    </>
  );
}
