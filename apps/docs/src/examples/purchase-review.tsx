import { useEffect, useState, type MouseEvent } from 'react';
import {
  TransactionReviewError,
  useSeams,
  type BoundEvmSigner,
  type TransactionReviewControls,
  type TransactionReviewRect,
} from '@seams/wallet/react';

// Your backend prices the trade and builds the call to your market contract.
// `expiresAtMs` is the quote deadline as a Unix timestamp in milliseconds.
export type PurchaseQuote = {
  claim: string;
  pay: string;
  payout: string;
  minimumPayout: string;
  fee: string;
  expiresAtMs: number;
  tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  };
};

type PurchaseState =
  | { kind: 'ready'; message: string }
  | { kind: 'pending' }
  | { kind: 'blocked'; message: string };

function secondsUntil(deadlineMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
}

function startCountdown(deadlineMs: number, setSeconds: (seconds: number) => void) {
  const tick = () => setSeconds(secondsUntil(deadlineMs));
  const timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
}

// The SDK draws the dialog, the `review.title` heading, and the backdrop.
// This component supplies only the content and the two buttons.
function PurchaseReview({
  quote,
  controls,
}: {
  quote: PurchaseQuote;
  controls: TransactionReviewControls;
}) {
  const [seconds, setSeconds] = useState(secondsUntil(quote.expiresAtMs));
  useEffect(() => startCountdown(quote.expiresAtMs, setSeconds), [quote.expiresAtMs]);
  return (
    <>
      <p>{quote.claim}</p>
      <dl>
        <dt>You pay</dt>
        <dd>{quote.pay}</dd>
        <dt>Payout if Yes</dt>
        <dd>{quote.payout}</dd>
        <dt>Minimum payout</dt>
        <dd>{quote.minimumPayout}</dd>
        <dt>Trading fee</dt>
        <dd>{quote.fee} (included)</dd>
      </dl>
      <p>{seconds === 0 ? 'Quote expired' : `Quote expires in ${seconds}s`}</p>
      <button type="button" disabled={seconds === 0} onClick={controls.continueToWallet}>
        Confirm in wallet
      </button>
      <button type="button" onClick={controls.cancel}>
        Back to market
      </button>
    </>
  );
}

function reviewMessage(error: TransactionReviewError): string {
  switch (error.code) {
    case 'cancelled':
      return '';
    case 'review_expired':
      return 'The quote expired. Get a new quote to buy.';
    default:
      return `${error.message} You can review a new attempt.`;
  }
}

async function buy(
  signer: BoundEvmSigner,
  quote: PurchaseQuote,
  origin: TransactionReviewRect,
  setState: (state: PurchaseState) => void,
) {
  setState({ kind: 'pending' });
  try {
    const { txHash } = await signer.signAndSendTransaction({
      chainTarget: 'ethereum-sepolia',
      request: {
        chain: 'evm',
        kind: 'eip1559',
        senderSignatureAlgorithm: 'secp256k1',
        tx: quote.tx,
      },
      options: {
        confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' },
      },
      review: {
        title: 'Review purchase',
        validity: { kind: 'expires_at', atMs: quote.expiresAtMs },
        origin,
        render: (controls) => <PurchaseReview quote={quote} controls={controls} />,
      },
    });
    setState({ kind: 'ready', message: `Purchase submitted: ${txHash}` });
  } catch (error) {
    // A review error means that nothing was signed or sent.
    if (error instanceof TransactionReviewError) {
      setState({ kind: 'ready', message: reviewMessage(error) });
      return;
    }
    const message = error instanceof Error ? error.message : 'The wallet response was interrupted.';
    setState({ kind: 'blocked', message: `${message} Check wallet activity before another buy.` });
  }
}

export function BuyButton({ quote }: { quote: PurchaseQuote }) {
  const { wallet } = useSeams();
  const [state, setState] = useState<PurchaseState>({ kind: 'ready', message: '' });
  if (wallet?.access !== 'wallet') return <p>Sign in to buy.</p>;

  // The review grows from this button. The SDK reads the rectangle once, at the call.
  const onClick = (event: MouseEvent<HTMLButtonElement>) =>
    void buy(wallet.evm, quote, event.currentTarget.getBoundingClientRect(), setState);

  return (
    <>
      <button type="button" disabled={state.kind !== 'ready'} onClick={onClick}>
        Buy Yes
      </button>
      <p role="status">
        {state.kind === 'pending' ? 'Waiting for review and wallet approval…' : state.message}
      </p>
    </>
  );
}
