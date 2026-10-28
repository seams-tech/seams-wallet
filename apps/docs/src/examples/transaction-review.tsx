import { useState } from 'react';
import {
  transfer,
  useSeams,
  type BoundNearSigner,
  type TransactionReviewControls,
} from '@seams/wallet/react';

type TransferState =
  | { kind: 'ready'; message: string }
  | { kind: 'pending' }
  | { kind: 'blocked'; message: string };

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

async function submitTransfer(signer: BoundNearSigner, setState: (state: TransferState) => void) {
  setState({ kind: 'pending' });
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
    if (result.success) {
      setState({ kind: 'ready', message: `Transfer submitted: ${result.transactionId}` });
      return;
    }
    switch (result.kind) {
      case 'not_submitted':
        setState({ kind: 'ready', message: `${result.error} You can review a new attempt.` });
        return;
      case 'unresolved':
        setState({
          kind: 'blocked',
          message: `Check transaction ${result.transactionId} before another send.`,
        });
        return;
      case 'submission_unknown':
        setState({ kind: 'blocked', message: 'Check wallet activity before another send.' });
        return;
      default:
        return assertNeverTransferResult(result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The wallet response was interrupted.';
    setState({
      kind: 'blocked',
      message: `${message} Check wallet activity before another send.`,
    });
  }
}

function assertNeverTransferResult(value: never): never {
  throw new Error(`Unsupported transfer state: ${String(value)}`);
}

export function ReviewedTransferButton() {
  const { wallet } = useSeams();
  const [state, setState] = useState<TransferState>({ kind: 'ready', message: '' });
  if (!wallet?.near) return <p>Sign in with a NEAR account to try this example.</p>;

  return (
    <>
      <button
        type="button"
        disabled={state.kind !== 'ready'}
        onClick={submitTransfer.bind(null, wallet.near, setState)}
      >
        Review transfer
      </button>
      <p role="status">
        {state.kind === 'pending' ? 'Waiting for review and wallet approval…' : state.message}
      </p>
    </>
  );
}
