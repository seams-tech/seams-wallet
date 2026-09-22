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
        <dd>No fee · preview only</dd>
      </dl>
      <p className="prediction-caption">Quote expires in {seconds}s</p>
      <p className="prediction-disclosure">
        Preview only: continue to inspect the wallet approval screen. Nothing will be signed or sent.
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
      <p className="eyebrow">Prediction market</p>
      <h2>Will Lot 542 sell above its estimate?</h2>
      <p className="section-description">Otsuka Lotec No.7.5 · Buy YES · 0.1 test units</p>
      <button className="primary" type="button" onClick={openPreview.bind(null, setPreview)}>
        Preview trade
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
