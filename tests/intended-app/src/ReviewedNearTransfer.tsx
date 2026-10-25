import React from 'react';
import {
  useSeams,
  type BoundNearSigner,
  type BoundWallet,
  type TransactionReviewControls,
} from '@seams/wallet/react';
import { ActionType } from '@seams/wallet';

type TransferState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'submitted'; transactionId: string; accountId: string }
  | { kind: 'failed'; message: string };

export function ReviewedNearTransfer({ walletId }: { walletId: string | null }): React.ReactNode {
  const { wallet } = useSeams();
  const [state, setState] = React.useState<TransferState>({ kind: 'idle' });
  const signer = wallet?.walletId === walletId ? wallet.near : null;
  const readiness = transferReadiness(walletId, wallet, state);
  return (
    <section>
      <button
        type="button"
        disabled={!signer || state.kind === 'pending'}
        onClick={signer ? transfer.bind(null, signer, setState) : undefined}
      >
        Review NEAR testnet transfer
      </button>
      <p role="status" data-testid="reviewed-near-readiness">{readiness}</p>
      <output data-testid="reviewed-near-result" role="status" data-state={state.kind}>
        {state.kind === 'idle' ? '' : JSON.stringify(state)}
      </output>
    </section>
  );
}

function transferReadiness(walletId: string | null, wallet: BoundWallet | null, state: TransferState): string {
  if (state.kind === 'pending') return 'Complete the current transfer review in the Wallet.';
  if (walletId === null) return 'Create a wallet before reviewing a transfer.';
  if (wallet === null) return 'Unlock this wallet to enable the transfer button.';
  if (wallet.walletId !== walletId) return 'The selected wallet differs from the active session. Select Refresh status.';
  if (wallet.near === null) return 'A NEAR signer is not available for this wallet. Select Refresh status.';
  return 'Ready to review a NEAR testnet transfer.';
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
