import React from 'react';
import { useWallet, type TransactionReviewControls } from '@seams/wallet/react';

type EvmSigner = NonNullable<ReturnType<typeof useWallet>['evm']>;
type SigningInput = Pick<Parameters<EvmSigner['signTransaction']>[0], 'chainTarget' | 'request'>;
type SigningState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'signed'; rawTxHex: string; txHashHex: string }
  | { kind: 'failed'; message: string };

export function ReviewedSigning({ input }: { input: SigningInput }): React.ReactNode {
  const wallet = useWallet();
  const [state, setState] = React.useState<SigningState>({ kind: 'idle' });
  return (
    <section>
      <button
        type="button"
        disabled={!wallet.evm || state.kind === 'pending'}
        onClick={wallet.evm ? signReviewed.bind(null, wallet.evm, input, setState) : undefined}
      >
        Review Arc testnet signature
      </button>
      <output data-testid="reviewed-signing-result" role="status" data-state={state.kind}>
        {state.kind === 'idle' ? '' : JSON.stringify(state)}
      </output>
    </section>
  );
}

function renderReview(controls: TransactionReviewControls): React.ReactNode {
  return (
    <>
      <p>Sign a zero-value Arc testnet transaction. This check does not broadcast it.</p>
      <label>
        Review note <input name="review-note" />
      </label>
      <button type="button" onClick={controls.continueToWallet}>
        Continue to wallet
      </button>
      <button type="button" onClick={controls.cancel}>
        Cancel review
      </button>
    </>
  );
}

async function signReviewed(
  signer: EvmSigner,
  input: SigningInput,
  setState: React.Dispatch<React.SetStateAction<SigningState>>,
): Promise<void> {
  setState({ kind: 'pending' });
  try {
    const result = await signer.signTransaction({
      chainTarget: input.chainTarget,
      request: input.request,
      options: { confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' } },
      review: {
        title: 'Review testnet signature',
        validity: { kind: 'unbounded' },
        render: renderReview,
      },
    });
    if (result.chain !== 'evm' || result.kind !== 'eip1559') {
      throw new Error('Expected an EIP-1559 signature');
    }
    setState({ kind: 'signed', rawTxHex: result.rawTxHex, txHashHex: result.txHashHex });
  } catch (error) {
    setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}
