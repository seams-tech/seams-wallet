import { lazy, useEffect, useState, type ComponentType } from 'react';
import { transfer, useWallet, type TransactionReviewControls } from '@seams/wallet/react';

type PurchaseState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'complete'; message: string };

type Outcome = 'YES' | 'NO';
type FixtureQuote = {
  outcome: Outcome;
  amount: number;
  positions: string;
  fee: string;
  minimumPositions: string;
  expiresAtMs: number;
};
type ReviewScenario = 'normal' | 'expired' | 'slow' | 'failing';
type PurchaseSummaryProps = { quote: FixtureQuote; controls: TransactionReviewControls };

function PurchaseSummary({ quote, controls }: PurchaseSummaryProps) {
  const [seconds, setSeconds] = useState(remainingSeconds(quote.expiresAtMs));
  useEffect(startQuoteClock.bind(null, quote.expiresAtMs, setSeconds), [quote.expiresAtMs]);
  return (
    <div className="prediction-review">
      <p className="prediction-caption">Testnet · fixture quote</p>
      <p className="prediction-market">Lot 542 · Otsuka Lotec No.7.5</p>
      <div className="prediction-summary">
        <strong>Buy {quote.outcome}</strong>
        <span className="prediction-amount">
          {quote.amount} <small>test units</small>
        </span>
      </div>
      <dl className="prediction-details">
        <dt>Positions quoted</dt>
        <dd>{quote.positions}</dd>
        <dt>Trading fee · included</dt>
        <dd>{quote.fee} test units</dd>
        <dt>Minimum positions</dt>
        <dd>{quote.minimumPositions}</dd>
        <dt>Network fee</dt>
        <dd>Shown in wallet</dd>
      </dl>
      <p className="prediction-caption">Quote expires in {seconds}s</p>
      <p className="prediction-disclosure">
        Demo only: the wallet will request a zero-value NEAR self-transfer. Testnet gas applies. No
        market position is purchased.
      </p>
      <button
        className="prediction-confirm"
        type="button"
        disabled={seconds === 0}
        onClick={controls.continueToWallet}
      >
        Confirm in wallet
      </button>
      <button className="prediction-cancel" type="button" onClick={controls.cancel}>
        Back to trade
      </button>
    </div>
  );
}

function remainingSeconds(expiresAtMs: number) {
  return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
}

function updateQuoteClock(expiresAtMs: number, setSeconds: (seconds: number) => void) {
  setSeconds(remainingSeconds(expiresAtMs));
}

function startQuoteClock(expiresAtMs: number, setSeconds: (seconds: number) => void) {
  const timer = window.setInterval(updateQuoteClock.bind(null, expiresAtMs, setSeconds), 1000);
  return window.clearInterval.bind(window, timer);
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

function fixtureQuote(outcome: Outcome, amount: number, expired: boolean): FixtureQuote {
  const positions = amount * (outcome === 'YES' ? 1.93333 : 2.02901);
  return {
    outcome,
    amount,
    positions: positions.toFixed(5),
    fee: (amount * 0.01).toFixed(3),
    minimumPositions: (positions * 0.99).toFixed(6),
    expiresAtMs: Date.now() + (expired ? -1 : 90_000),
  };
}

function openPreview(
  outcome: Outcome,
  amount: number,
  setPreview: (quote: FixtureQuote | null) => void,
  setPreviewMessage: (message: string) => void,
) {
  setPreviewMessage('');
  setPreview(fixtureQuote(outcome, amount, false));
}

function previewContinued(setMessage: (message: string) => void) {
  setMessage(
    'Component preview complete. Sign in and choose Review prediction trade to use the real wallet approval flow. Nothing was signed or sent.',
  );
}

function showPreview(quote: FixtureQuote | null) {
  if (quote)
    document.getElementById('prediction-review-preview')?.scrollIntoView({ block: 'center' });
}

function previewFailed(setMessage: (message: string) => void, error: unknown) {
  setMessage(error instanceof Error ? error.message : 'Preview failed.');
}

async function startPurchase(
  wallet: ReturnType<typeof useWallet>,
  setState: (state: PurchaseState) => void,
  scenario: ReviewScenario,
  outcome: Outcome,
  amount: number,
  onRequestSignIn: () => void,
) {
  if (wallet.status === 'signed_out') {
    onRequestSignIn();
    return;
  }
  if (wallet.status !== 'ready') return;
  const quote = fixtureQuote(outcome, amount, scenario === 'expired');
  setState({ kind: 'pending' });
  try {
    const result = await wallet.near.signAndSendTransaction({
      receiverId: wallet.near.accountId,
      actions: [transfer('0')],
      options: { confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' } },
      review: {
        title: 'Review purchase',
        validity: { kind: 'expires_at', atMs: quote.expiresAtMs },
        render: purchaseRenderer(scenario, quote),
      },
    });
    setState({
      kind: 'complete',
      message: result.success
        ? 'Demo self-transfer complete. No market position was purchased.'
        : result.error,
    });
  } catch (error) {
    setState({
      kind: 'complete',
      message: error instanceof Error ? error.message : 'Purchase failed.',
    });
  }
}

function reviewButtonLabel(state: PurchaseState, wallet: ReturnType<typeof useWallet>): string {
  if (state.kind === 'pending') return 'Review in progress…';
  if (wallet.status === 'signed_out') return 'Sign in to review trade';
  return 'Review prediction trade';
}

export function PurchaseReviewExample({ onRequestSignIn }: { onRequestSignIn: () => void }) {
  const wallet = useWallet();
  const [state, setState] = useState<PurchaseState>({ kind: 'idle' });
  const [outcome, setOutcome] = useState<Outcome>('YES');
  const [amount, setAmount] = useState(0.1);
  const [preview, setPreview] = useState<FixtureQuote | null>(null);
  const [previewMessage, setPreviewMessage] = useState('');
  useEffect(showPreview.bind(null, preview), [preview]);
  return (
    <section className="panel prediction-demo" id="prediction-market">
      <p className="eyebrow">Prediction market · R140 demo</p>
      <h2>Will Lot 542 sell above its estimate?</h2>
      <p className="section-description">Otsuka Lotec No.7.5 · Fixture market, test funds only</p>
      <fieldset disabled={state.kind === 'pending'}>
        <legend>Choose a position</legend>
        <div className="actions">
          <button
            type="button"
            aria-pressed={outcome === 'YES'}
            onClick={setOutcome.bind(null, 'YES')}
          >
            Buy YES
          </button>
          <button
            type="button"
            aria-pressed={outcome === 'NO'}
            onClick={setOutcome.bind(null, 'NO')}
          >
            Buy NO
          </button>
        </div>
        <p>Spend · test units</p>
        <div className="actions">
          <button type="button" aria-pressed={amount === 0.1} onClick={setAmount.bind(null, 0.1)}>
            0.1
          </button>
          <button type="button" aria-pressed={amount === 1} onClick={setAmount.bind(null, 1)}>
            1
          </button>
          <button type="button" aria-pressed={amount === 5} onClick={setAmount.bind(null, 5)}>
            5
          </button>
        </div>
      </fieldset>
      <p className="section-description">
        Review your quote inside the existing transaction confirmer, then continue to wallet
        approval for a zero-value NEAR self-transfer. No market position is purchased.
      </p>
      <button
        type="button"
        onClick={openPreview.bind(null, outcome, amount, setPreview, setPreviewMessage)}
      >
        Preview review component
      </button>
      {wallet.status === 'signed_out' ? (
        <p>Sign in to open the review. You can choose your position and amount first.</p>
      ) : null}
      {wallet.status === 'no_near_account' ? (
        <p>
          Your wallet is signed in, but its NEAR account is not ready. Refresh the wallet session
          above after account provisioning completes.
        </p>
      ) : null}
      <button
        className="primary"
        type="button"
        disabled={wallet.status === 'no_near_account' || state.kind === 'pending'}
        onClick={startPurchase.bind(
          null,
          wallet,
          setState,
          'normal',
          outcome,
          amount,
          onRequestSignIn,
        )}
      >
        {reviewButtonLabel(state, wallet)}
      </button>
      <button
        type="button"
        disabled={wallet.status === 'no_near_account' || state.kind === 'pending'}
        onClick={startPurchase.bind(
          null,
          wallet,
          setState,
          'expired',
          outcome,
          amount,
          onRequestSignIn,
        )}
      >
        Try expired quote
      </button>
      <button
        type="button"
        disabled={wallet.status === 'no_near_account' || state.kind === 'pending'}
        onClick={startPurchase.bind(
          null,
          wallet,
          setState,
          'slow',
          outcome,
          amount,
          onRequestSignIn,
        )}
      >
        Try slow review
      </button>
      <button
        type="button"
        disabled={wallet.status === 'no_near_account' || state.kind === 'pending'}
        onClick={startPurchase.bind(
          null,
          wallet,
          setState,
          'failing',
          outcome,
          amount,
          onRequestSignIn,
        )}
      >
        Try failing review
      </button>
      <p role="status">{state.kind === 'complete' ? state.message : ''}</p>
      {preview ? (
        <section
          id="prediction-review-preview"
          className="prediction-preview"
          aria-label="Review component preview"
        >
          <p className="prediction-caption">Component preview · no wallet or transaction</p>
          <h3>Review purchase</h3>
          <PurchaseSummary
            key={preview.expiresAtMs}
            quote={preview}
            controls={{
              continueToWallet: previewContinued.bind(null, setPreviewMessage),
              cancel: setPreview.bind(null, null),
              fail: previewFailed.bind(null, setPreviewMessage),
            }}
          />
          <p role="status" className="prediction-caption">
            {previewMessage}
          </p>
        </section>
      ) : null}
    </section>
  );
}
