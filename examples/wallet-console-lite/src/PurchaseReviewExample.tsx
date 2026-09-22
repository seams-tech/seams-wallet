import { useCallback, useEffect, useState } from 'react';
import type { TransactionReviewControls } from '@seams/wallet/react';
import { ConfirmationPreview } from './ConfirmationPreview';

type FixtureQuote = {
  outcome: 'YES';
  amount: number;
  positions: string;
  fee: string;
  minimumPositions: string;
  expiresAtMs: number;
};
type PurchaseSummaryProps = {
  quote: FixtureQuote;
  controls: TransactionReviewControls;
};

function PurchaseSummary({ quote, controls }: PurchaseSummaryProps) {
  const [seconds, setSeconds] = useState(remainingSeconds(quote.expiresAtMs));
  useEffect(startQuoteClock.bind(null, quote.expiresAtMs, setSeconds), [quote.expiresAtMs]);
  return (
    <div className="prediction-review">
      <div className="prediction-market">
        <span className="prediction-lot">LOT 542 · OTSUKA LOTEC NO.7.5</span>
        <h3>Will it sell above its estimate?</h3>
      </div>
      <div className="prediction-summary">
        <div className="prediction-summary-top">
          <span className="prediction-outcome">
            Buy {quote.outcome} <span aria-hidden="true">↗</span>
          </span>
          <span className="prediction-summary-label">Prediction market</span>
        </div>
        <div className="prediction-summary-values">
          <div>
            <span className="prediction-summary-label">You pay</span>
            <strong className="prediction-amount">{quote.amount}</strong>
            <span className="prediction-summary-label">test units</span>
          </div>
          <div>
            <span className="prediction-summary-label">You receive</span>
            <strong className="prediction-position-count">{quote.positions}</strong>
            <span className="prediction-summary-label">YES positions</span>
          </div>
        </div>
      </div>
      <dl className="prediction-details">
        <dt>Minimum positions</dt>
        <dd>{quote.minimumPositions}</dd>
        <dt>
          Trading fee <span className="prediction-included">Included</span>
        </dt>
        <dd>{quote.fee} test units</dd>
        <dt>Network fee</dt>
        <dd>
          No fee <span className="prediction-detail-note">· preview</span>
        </dd>
      </dl>
      <div className="prediction-expiry">
        <div>
          <span>{seconds === 0 ? 'Quote expired' : 'Quote expires in'}</span>
          <strong>{seconds}s</strong>
        </div>
        <progress aria-label="Quote time remaining" max={90} value={seconds} />
      </div>
      <button
        className="prediction-confirm"
        type="button"
        disabled={seconds === 0}
        onClick={controls.continueToWallet}
      >
        <span>Confirm in wallet</span>
        <span aria-hidden="true">→</span>
      </button>
      <button className="prediction-cancel" type="button" onClick={controls.cancel}>
        Back to trade
      </button>
      <p className="prediction-disclosure">Demo only. Nothing will be signed or sent.</p>
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

function openPreview(setPreview: (quote: FixtureQuote | null) => void): void {
  setPreview({
    outcome: 'YES',
    amount: 0.1,
    positions: '0.19333',
    fee: '0.001',
    minimumPositions: '0.191400',
    expiresAtMs: Date.now() + 90_000,
  });
}

function closePreview(setPreview: (quote: FixtureQuote | null) => void): void {
  setPreview(null);
}

export function PurchaseReviewExample() {
  const [preview, setPreview] = useState<FixtureQuote | null>(null);
  const onPreviewFinished = useCallback(closePreview.bind(null, setPreview), []);
  return (
    <section className="panel prediction-demo" id="prediction-market">
      <h2>Test tenant-supplied custom components</h2>
      <p className="section-description">
        Preview a custom review panel inside the transaction confirmation flow.
      </p>
      <button className="primary" type="button" onClick={openPreview.bind(null, setPreview)}>
        Preview component
      </button>
      <p className="prediction-caption">Interactive demo · nothing is signed or sent.</p>
      {preview ? (
        <ConfirmationPreview
          render={renderPurchase.bind(null, preview)}
          onFinish={onPreviewFinished}
        />
      ) : null}
    </section>
  );
}
