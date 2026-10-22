import React from 'react';
import {
  useSeams,
  type BoundNearSigner,
  type TransactionReviewControls,
} from '@seams/wallet/react';
import { ActionType } from '@seams/wallet';

type TransferState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'submitted'; transactionId: string; accountId: string }
  | { kind: 'failed'; message: string };

export function ReviewedNearTransfer(): React.ReactNode {
  const { wallet } = useSeams();
  const [state, setState] = React.useState<TransferState>({ kind: 'idle' });
  const signer = wallet?.near ?? null;
  return (
    <section>
      <button
        type="button"
        disabled={!signer || state.kind === 'pending'}
        onClick={signer ? transfer.bind(null, signer, setState) : undefined}
      >
        Review NEAR testnet transfer
      </button>
      <output data-testid="reviewed-near-result" role="status" data-state={state.kind}>
        {state.kind === 'idle' ? '' : JSON.stringify(state)}
      </output>
    </section>
  );
}

function renderTransferReview(controls: TransactionReviewControls): React.ReactNode {
  return (
    <>
      <p>Send one yoctoNEAR to this wallet's own NEAR testnet account.</p>
      <button type="button" onClick={controls.continueToWallet}>
        Continue to wallet
      </button>
      <button type="button" onClick={controls.cancel}>
        Cancel review
      </button>
    </>
  );
}

async function transfer(
  signer: BoundNearSigner,
  setState: React.Dispatch<React.SetStateAction<TransferState>>,
): Promise<void> {
  setState({ kind: 'pending' });
  try {
    const result = await signer.signAndSendTransaction({
      receiverId: signer.accountId,
      actions: [{ type: ActionType.Transfer, amount: '1' }],
      options: {
        confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' },
        waitUntil: 'FINAL',
      },
      review: {
        title: 'Review NEAR testnet transfer',
        validity: { kind: 'expires_at', atMs: Date.now() + 60_000 },
        render: renderTransferReview,
      },
    });
    if (!result.success) throw new Error(result.error);
    if (!result.transactionId) throw new Error('The transfer returned no transaction ID.');
    setState({
      kind: 'submitted',
      transactionId: result.transactionId,
      accountId: signer.accountId,
    });
  } catch (error) {
    setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}
