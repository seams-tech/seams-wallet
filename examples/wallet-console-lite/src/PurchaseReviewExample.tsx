import { lazy, useState, type ComponentType } from 'react';
import { transfer, useWallet, type TransactionReviewControls } from '@seams/wallet/react';

type PurchaseState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'complete'; message: string };

type FixtureQuote = { item: string; amount: string; expiresAtMs: number };
type ReviewScenario = 'normal' | 'expired' | 'slow' | 'failing';
type PurchaseSummaryProps = { quote: FixtureQuote; controls: TransactionReviewControls };

function PurchaseSummary({ quote, controls }: PurchaseSummaryProps) {
  return (
    <>
      <p>NEAR testnet · fixture quote</p>
      <p>
        {quote.item}: {quote.amount} NEAR
      </p>
      <p>This demo sends a zero-value transfer to your own account. Testnet gas applies.</p>
      <button type="button" onClick={controls.continueToWallet}>
        Continue to wallet
      </button>
      <button type="button" onClick={controls.cancel}>
        Cancel
      </button>
    </>
  );
}

function renderPurchase(quote: FixtureQuote, controls: TransactionReviewControls) {
  return <PurchaseSummary quote={quote} controls={controls} />;
}

function loadSlowPurchase(): Promise<{ default: typeof PurchaseSummary }> {
  return new Promise(delayPurchase);
}

function delayPurchase(resolve: (module: { default: typeof PurchaseSummary }) => void): void {
  setTimeout(resolve.bind(null, { default: PurchaseSummary }), 1_500);
}

function renderSlowPurchase(
  Summary: ComponentType<PurchaseSummaryProps>,
  quote: FixtureQuote,
  controls: TransactionReviewControls,
) {
  return <Summary quote={quote} controls={controls} />;
}

function renderFailedPurchase(): never {
  throw new Error('Demo quote could not be loaded. Start a new review to retry.');
}

function purchaseRenderer(scenario: ReviewScenario, quote: FixtureQuote) {
  switch (scenario) {
    case 'normal':
    case 'expired':
      return renderPurchase.bind(null, quote);
    case 'slow':
      return renderSlowPurchase.bind(null, lazy(loadSlowPurchase), quote);
    case 'failing':
      return renderFailedPurchase;
  }
}

async function startPurchase(
  wallet: ReturnType<typeof useWallet>,
  setState: (state: PurchaseState) => void,
  scenario: ReviewScenario,
) {
  if (wallet.status !== 'ready') return;
  const quote: FixtureQuote = {
    item: 'Demo purchase',
    amount: '0',
    expiresAtMs: Date.now() + (scenario === 'expired' ? -1 : 120_000),
  };
  setState({ kind: 'pending' });
  try {
    const result = await wallet.near.signAndSendTransaction({
      receiverId: wallet.near.accountId,
      actions: [transfer('0')],
      options: { confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' } },
      review: {
        title: 'Review testnet purchase',
        validity: { kind: 'expires_at', atMs: quote.expiresAtMs },
        render: purchaseRenderer(scenario, quote),
      },
    });
    setState({
      kind: 'complete',
      message: result.success ? 'Testnet transfer complete.' : result.error,
    });
  } catch (error) {
    setState({
      kind: 'complete',
      message: error instanceof Error ? error.message : 'Purchase failed.',
    });
  }
}

export function PurchaseReviewExample() {
  const wallet = useWallet();
  const [state, setState] = useState<PurchaseState>({ kind: 'idle' });
  return (
    <section className="panel">
      <h2>Custom purchase review</h2>
      <p>NEAR testnet demo. Review the fixture quote, then approve in the wallet.</p>
      <button
        type="button"
        disabled={wallet.status !== 'ready' || state.kind === 'pending'}
        onClick={startPurchase.bind(null, wallet, setState, 'normal')}
      >
        Review testnet purchase
      </button>
      <button
        type="button"
        disabled={wallet.status !== 'ready' || state.kind === 'pending'}
        onClick={startPurchase.bind(null, wallet, setState, 'expired')}
      >
        Try expired quote
      </button>
      <button
        type="button"
        disabled={wallet.status !== 'ready' || state.kind === 'pending'}
        onClick={startPurchase.bind(null, wallet, setState, 'slow')}
      >
        Try slow review
      </button>
      <button
        type="button"
        disabled={wallet.status !== 'ready' || state.kind === 'pending'}
        onClick={startPurchase.bind(null, wallet, setState, 'failing')}
      >
        Try failing review
      </button>
      <p role="status">{state.kind === 'complete' ? state.message : ''}</p>
    </section>
  );
}
