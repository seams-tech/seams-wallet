/** @jsxImportSource preact */
import { Component } from 'preact';
import {
  receiptDescription,
  receiptHeading,
  receiptIsPending,
  receiptCompletedStages,
  type TransactionReceiptModel,
} from '../transaction-receipt';
import { ReviewDisclosure } from './ReviewDisclosure';
import type { ExplorerUrls } from './TransactionLabel';
import {
  CopyReviewValue,
  ReviewIcon,
  ReviewAddress,
  ReviewAmount,
  reviewNetwork,
  reviewRecipient,
  WalletReceiptFooter,
  type TransactionReviewData,
} from './TransactionReview';

export class TransactionReceipt extends Component<{
  receipt: TransactionReceiptModel;
  data: TransactionReviewData;
  explorers: ExplorerUrls;
}> {
  private minimize = (): void => {
    this.props.receipt.onView('toast');
  };
  private expand = (): void => {
    this.props.receipt.onView('expanded');
  };
  private close = (): void => {
    if (receiptIsPending(this.props.receipt.state)) this.minimize();
    else this.props.receipt.onDismiss();
  };
  render() {
    const { receipt, data } = this.props;
    const heading = receiptHeading(receipt.state);
    const complete = receipt.state.kind === 'confirmed' || receipt.state.kind === 'signed';
    const pending = receiptIsPending(receipt.state);
    const completedStages = receiptCompletedStages(receipt.state);
    const recipient = reviewRecipient(data.model);
    const explorerHref = receipt.state.kind === 'confirmed' && receipt.state.hash
      ? transactionExplorerHref(data.model, this.props.explorers, receipt.state.hash)
      : null;
    if (receipt.view === 'toast') {
      return (
        <div
          class="seams-transaction-toast"
          data-completed-stages={completedStages}
          data-pending={pending}
        >
          <div class="seams-toast-progress" aria-hidden="true">
            <span />
          </div>
          <span class="seams-receipt-symbol" data-pending={pending}>
            <ReviewIcon kind={pending ? 'loader' : complete ? 'check' : 'alert'} />
          </span>
          <div class="seams-transaction-toast-text">
            <strong role="status">{heading}</strong>
            <span>{reviewNetwork(data.model)}</span>
          </div>
          <button type="button" class="seams-receipt-open" onClick={this.expand}>
            Open <ReviewIcon kind="arrow" />
          </button>
        </div>
      );
    }
    return (
      <div class="seams-transaction-receipt">
        <div class="seams-review-toolbar">
          <span>Transaction receipt</span>
          <div>
            <button type="button" aria-label="Minimize transaction" onClick={this.minimize}>
              <ReviewIcon kind="minimize" />
            </button>
            <button
              type="button"
              aria-label={
                receiptIsPending(receipt.state) ? 'Minimize transaction' : 'Close receipt'
              }
              onClick={this.close}
            >
              <ReviewIcon kind="close" />
            </button>
          </div>
        </div>
        <div class="seams-receipt-heading">
          <span class="seams-receipt-symbol" data-pending={pending}>
            <ReviewIcon kind={pending ? 'loader' : complete ? 'check' : 'alert'} />
          </span>
          <div>
            <h2 role="status">{heading}</h2>
            <p>{receiptDescription(receipt.state)}</p>
          </div>
        </div>
        <ReviewAmount model={data.model} compact />
        <div class="seams-receipt-destination">
          {recipient && (
            <>
              To <CopyReviewValue value={recipient} address label={`Copy recipient address ${recipient}`} />
            </>
          )}
          {!recipient && reviewNetwork(data.model)}
        </div>
        {data.model?.totals?.estimatedFee && (
          <dl class="seams-review-fields">
            <div>
              <dt>Estimated network fee</dt>
              <dd>
                {data.model.totals.estimatedFee} {data.model.totals.feeSymbol}
              </dd>
            </div>
          </dl>
        )}
        <div class="seams-receipt-steps" aria-label="Transaction progress">
          <ReceiptStep
            stage="signing"
            label="Signed"
            activeLabel="Signing"
            complete={completedStages >= 1}
            active={receipt.state.kind === 'signing'}
          />
          <ReceiptStep
            stage="broadcast"
            label="Broadcast"
            activeLabel="Broadcasting"
            complete={completedStages >= 2}
            active={receipt.state.kind === 'broadcasting'}
          />
          <ReceiptStep
            stage="confirming"
            label={receipt.state.kind === 'reverted' ? 'Reverted' : 'Confirmed'}
            activeLabel="Confirming"
            complete={completedStages === 3}
            active={receipt.state.kind === 'submitted'}
          />
        </div>
        <div class="seams-receipt-box">
          <ReviewDisclosure label="Receipt details">
            <dl class="seams-review-fields">
              {data.model?.signerAccount && (
                <div>
                  <dt>From</dt>
                  <dd class="seams-review-recipient">
                    <CopyReviewValue
                      value={data.model.signerAccount}
                      address
                      label={`Copy signer address ${data.model.signerAccount}`}
                    />
                  </dd>
                </div>
              )}
              {recipient && (
                <div>
                  <dt>To</dt>
                  <dd class="seams-review-recipient">
                    <CopyReviewValue value={recipient} address label={`Copy recipient address ${recipient}`} />
                  </dd>
                </div>
              )}
              {receipt.state.hash && (
                <div>
                  <dt>Transaction</dt>
                  <dd>
                    <ReviewAddress value={receipt.state.hash} />
                    <CopyReviewValue value={receipt.state.hash} />
                  </dd>
                </div>
              )}
              <div>
                <dt>Status</dt>
                <dd>{heading}</dd>
              </div>
            </dl>
          </ReviewDisclosure>
        </div>
        <button type="button" class="seams-receipt-primary" onClick={this.close}>
          {receiptIsPending(receipt.state) ? 'Continue in background' : 'Done'}
        </button>
        {explorerHref && (
          <a
            class="seams-receipt-explorer"
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            View transaction <ReviewIcon kind="arrow" />
          </a>
        )}
        <WalletReceiptFooter />
      </div>
    );
  }
}

function transactionExplorerHref(
  model: TransactionReviewData['model'],
  explorers: ExplorerUrls,
  hash: string,
): string | null {
  if (!model) return null;
  let base: string | undefined;
  switch (model.chain) {
    case 'near':
      base = explorers.near;
      break;
    case 'evm':
      base = explorers.evm;
      break;
    case 'tempo':
      base = explorers.tempo;
      break;
    case 'unknown':
      return null;
    default:
      return assertNeverDisplayChain(model.chain);
  }
  if (!base) return null;
  const path = model.chain === 'near' ? 'txns' : 'tx';
  return `${base.trim().replace(/\/$/, '')}/${path}/${encodeURIComponent(hash)}`;
}

function assertNeverDisplayChain(chain: never): never {
  throw new Error(`Unexpected display chain: ${String(chain)}`);
}

function ReceiptStep(props: {
  stage: string;
  label: string;
  activeLabel: string;
  complete: boolean;
  active: boolean;
}) {
  const state = props.complete ? 'complete' : props.active ? 'active' : 'waiting';
  return (
    <span
      class="seams-receipt-step"
      data-stage={props.stage}
      data-state={state}
      aria-current={props.active ? 'step' : undefined}
    >
      <span class="seams-receipt-track" aria-hidden="true" />
      {props.active ? props.activeLabel : props.label}
    </span>
  );
}
