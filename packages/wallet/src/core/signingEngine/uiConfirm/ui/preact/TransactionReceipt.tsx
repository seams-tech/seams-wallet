/** @jsxImportSource preact */
import { Component, createRef } from 'preact';
import {
  receiptDescription,
  receiptHeading,
  receiptIsPending,
  receiptCompletedStages,
  type TransactionReceiptModel,
} from '../transaction-receipt';
import { announceClampedSurfaceResize } from '../confirm-surface-resize';
import { confirmationDocumentStyles } from './confirmation-styles';
import { ReviewDisclosure } from './ReviewDisclosure';
import type { ExplorerUrls } from './TransactionLabel';
import {
  CopyReviewValue,
  ReviewIcon,
  ReviewMiddleTruncated,
  ReviewAmount,
  reviewNetwork,
  reviewRecipient,
  WalletReceiptFooter,
  type TransactionReviewData,
} from './TransactionReview';

type TransactionReceiptProps = {
  receipt: TransactionReceiptModel;
  data: TransactionReviewData;
  explorers: ExplorerUrls;
};

const EXPLORER_REVEAL_MS = 240;
const EXPLORER_REVEAL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
let nextExplorerRowId = 0;

export class TransactionReceipt extends Component<TransactionReceiptProps> {
  private readonly explorerRow = createRef<HTMLDivElement>();
  private readonly explorerRowId = `seams-receipt-explorer-row-${++nextExplorerRowId}`;
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
  componentDidUpdate(previous: TransactionReceiptProps): void {
    const { receipt } = this.props;
    if (
      receipt.view === 'expanded' &&
      previous.receipt.view === 'expanded' &&
      receipt.state.kind === 'confirmed' &&
      previous.receipt.state.kind !== 'confirmed'
    ) {
      this.revealExplorerLink();
    }
  }
  componentWillUnmount(): void {
    this.releaseExplorerRow();
  }
  private setExplorerRowHeight = (height: number): void => {
    const row = this.explorerRow.current;
    if (!row) return;
    confirmationDocumentStyles(row.ownerDocument).setDynamicDeclarations(
      this.explorerRowId,
      `#${this.explorerRowId}`,
      { '--seams-receipt-explorer-height': `${height}px` },
    );
  };
  private releaseExplorerRow = (): void => {
    const row = this.explorerRow.current;
    if (!row) return;
    delete row.dataset.opening;
    confirmationDocumentStyles(row.ownerDocument).deleteDynamicRule(this.explorerRowId);
  };
  // The explorer link arrives with confirmation. Open its row so the card grows
  // to fit it, and bring the link in as the row opens. In a wallet iframe the
  // parent eases the box and drives the row from the room it makes, so the
  // card never outgrows the frame; elsewhere the row animates itself.
  private revealExplorerLink(): void {
    const row = this.explorerRow.current;
    const link = row?.firstElementChild;
    if (!row || !link) return;
    if (row.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const height = row.getBoundingClientRect().height;
    row.dataset.opening = '';
    const hosted = announceClampedSurfaceResize({
      reason: 'receipt-explorer',
      element: row,
      fromCssPx: 0,
      toCssPx: height,
      drivenClasses: ['seams-receipt-explorer-driven'],
      setHeightCssPx: this.setExplorerRowHeight,
      onSettled: this.releaseExplorerRow,
    });
    if (!hosted) {
      const opening = row.animate([{ height: '0px' }, { height: `${height}px` }], {
        duration: EXPLORER_REVEAL_MS,
        easing: EXPLORER_REVEAL_EASING,
      });
      opening.onfinish = opening.oncancel = this.releaseExplorerRow;
    }
    link.animate(
      [
        { opacity: 0, filter: 'blur(4px)', transform: 'translateY(6px)' },
        { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
      ],
      {
        duration: EXPLORER_REVEAL_MS,
        delay: 60,
        easing: EXPLORER_REVEAL_EASING,
        fill: 'backwards',
      },
    );
  }
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
          data-stage={receipt.state.kind}
          data-pending={pending}
        >
          <div class="seams-toast-progress" aria-hidden="true">
            <span class="seams-toast-progress-fill">
              {pending && <span class="seams-toast-progress-active" />}
            </span>
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
          <button type="button" aria-label="Minimize transaction" onClick={this.minimize}>
            <ReviewIcon kind="minimize" />
          </button>
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
                  <ReviewMiddleTruncated value={receipt.state.hash} class="seams-review-hash" />
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
        <button type="button" class="seams-receipt-primary" onClick={this.close}>
          {receiptIsPending(receipt.state) ? 'Continue in background' : 'Done'}
        </button>
        {explorerHref && (
          <div id={this.explorerRowId} class="seams-receipt-explorer-row" ref={this.explorerRow}>
            <a
              class="seams-receipt-explorer"
              href={explorerHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              View transaction <ReviewIcon kind="arrow" />
            </a>
          </div>
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
