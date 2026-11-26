/** @jsxImportSource preact */
import {
  WalletText,
  WalletLocaleContext,
  useWalletLocale,
} from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { walletText, walletDisplayText } from '@/core/ui/messages';
import type { WalletLocale } from '@/core/ui/locale';
import { Component, createRef } from 'preact';
import {
  receiptDescription,
  receiptHeading,
  receiptIsComplete,
  receiptIsPending,
  receiptCompletedStages,
  receiptTitle,
  type MessageReceiptState,
  type TransactionReceiptModel,
  type TransactionReceiptState,
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
  static contextType = WalletLocaleContext;
  declare context: WalletLocale;

  private readonly explorerRow = createRef<HTMLDivElement>();
  private readonly explorerRowId = `seams-receipt-explorer-row-${++nextExplorerRowId}`;
  private minimize = (): void => {
    this.props.receipt.onView('toast');
  };
  private expand = (): void => {
    this.props.receipt.onView('expanded');
  };
  private close = (): void => {
    if (receiptIsPending(this.props.receipt)) this.minimize();
    else this.props.receipt.onDismiss();
  };
  componentDidUpdate(previous: TransactionReceiptProps): void {
    const { receipt } = this.props;
    if (
      receipt.view === 'expanded' &&
      previous.receipt.view === 'expanded' &&
      receipt.subject === 'transaction' &&
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
  // to fit it, then bring the link in once the card has its new size; the link
  // stays hidden while the row opens. In a wallet iframe the parent eases the
  // box and drives the row from the room it makes, so the card never outgrows
  // the frame; elsewhere the row animates itself.
  private revealExplorerLink(): void {
    const row = this.explorerRow.current;
    const link = row?.firstElementChild;
    if (!row || !link) return;
    if (row.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const height = row.getBoundingClientRect().height;
    row.dataset.opening = '';
    const showLink = (): void => {
      this.releaseExplorerRow();
      link.animate(
        [
          { opacity: 0, filter: 'blur(4px)', transform: 'translateY(6px)' },
          { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
        ],
        { duration: EXPLORER_REVEAL_MS, easing: EXPLORER_REVEAL_EASING },
      );
    };
    const hosted = announceClampedSurfaceResize({
      reason: 'receipt-explorer',
      element: row,
      fromCssPx: 0,
      toCssPx: height,
      drivenClasses: ['seams-receipt-explorer-driven'],
      setHeightCssPx: this.setExplorerRowHeight,
      onSettled: showLink,
    });
    if (!hosted) {
      const opening = row.animate([{ height: '0px' }, { height: `${height}px` }], {
        duration: EXPLORER_REVEAL_MS,
        easing: EXPLORER_REVEAL_EASING,
      });
      opening.onfinish = showLink;
      opening.oncancel = this.releaseExplorerRow;
    }
  }
  render() {
    const { receipt, data } = this.props;
    const heading = receiptHeading(receipt);
    const complete = receiptIsComplete(receipt);
    const pending = receiptIsPending(receipt);
    const completedStages = receiptCompletedStages(receipt);
    const recipient = reviewRecipient(data.model);
    const transaction = receipt.subject === 'transaction' ? receipt.state : null;
    const explorerHref =
      transaction?.kind === 'confirmed' && transaction.hash
        ? transactionExplorerHref(data.model, this.props.explorers, transaction.hash)
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
            <strong role="status">
              <WalletText copy={heading} />
            </strong>
            <span>{reviewNetwork(data.model)}</span>
          </div>
          <button type="button" class="seams-receipt-open" onClick={this.expand}>
            <WalletText message="Open" /> <ReviewIcon kind="arrow" />
          </button>
          {!pending && (
            <button
              type="button"
              class="seams-receipt-dismiss"
              aria-label={walletText(this.context, 'Close transaction')}
              onClick={receipt.onDismiss}
            >
              <ReviewIcon kind="close" />
            </button>
          )}
        </div>
      );
    }
    return (
      <div class="seams-transaction-receipt">
        <div class="seams-review-toolbar">
          <span>
            <WalletText copy={receiptTitle(receipt)} />
          </span>
          <button
            type="button"
            aria-label={walletText(this.context, 'Minimize transaction')}
            onClick={this.minimize}
          >
            <ReviewIcon kind="minimize" />
          </button>
        </div>
        <div class="seams-receipt-heading">
          <span class="seams-receipt-symbol" data-pending={pending}>
            <ReviewIcon kind={pending ? 'loader' : complete ? 'check' : 'alert'} />
          </span>
          <div>
            <h2 role="status">
              <WalletText copy={heading} />
            </h2>
            <p>
              <WalletText copy={receiptDescription(receipt)} />
            </p>
          </div>
        </div>
        <ReviewAmount model={data.model} compact />
        <div class="seams-receipt-destination">
          {recipient && (
            <>
              <WalletText message="To" />{' '}
              <CopyReviewValue
                value={recipient}
                address
                label={walletDisplayText(this.context, `Copy recipient address ${recipient}`)}
              />
            </>
          )}
          {!recipient && reviewNetwork(data.model)}
        </div>
        {data.model?.totals?.estimatedFee && (
          <dl class="seams-review-fields">
            <div>
              <dt>
                <WalletText message="Estimated network fee" />
              </dt>
              <dd>
                {data.model.totals.estimatedFee} {data.model.totals.feeSymbol}
              </dd>
            </div>
          </dl>
        )}
        {transaction ? (
          <ReceiptSteps state={transaction} />
        ) : (
          receipt.subject === 'message' && <MessageReceiptSteps state={receipt.state} />
        )}
        <ReviewDisclosure label={walletText(this.context, 'Receipt details')}>
          <dl class="seams-review-fields">
            {transaction && data.model?.signerAccount && (
              <div>
                <dt>
                  <WalletText message="From" />
                </dt>
                <dd class="seams-review-recipient">
                  <CopyReviewValue
                    value={data.model.signerAccount}
                    address
                    label={walletDisplayText(
                      this.context,
                      `Copy signer address ${data.model.signerAccount}`,
                    )}
                  />
                </dd>
              </div>
            )}
            {recipient && (
              <div>
                <dt>
                  <WalletText message="To" />{' '}
                </dt>
                <dd class="seams-review-recipient">
                  <CopyReviewValue
                    value={recipient}
                    address
                    label={walletDisplayText(this.context, `Copy recipient address ${recipient}`)}
                  />
                </dd>
              </div>
            )}
            {transaction?.hash && (
              <div>
                <dt>
                  <WalletText message="Transaction" />
                </dt>
                <dd>
                  <ReviewMiddleTruncated value={transaction.hash} class="seams-review-hash" />
                  <CopyReviewValue value={transaction.hash} />
                </dd>
              </div>
            )}
            {receipt.subject === 'message' && <MessageReceiptFields model={data.model} />}
            <div>
              <dt>
                <WalletText message="Status" />
              </dt>
              <dd>
                <WalletText copy={heading} />
              </dd>
            </div>
          </dl>
        </ReviewDisclosure>
        <button type="button" class="seams-receipt-primary" onClick={this.close}>
          {pending ? (
            <WalletText message="Continue in background" />
          ) : (
            <WalletText message="Done" />
          )}
        </button>
        {explorerHref && (
          <div id={this.explorerRowId} class="seams-receipt-explorer-row" ref={this.explorerRow}>
            <a
              class="seams-receipt-explorer"
              href={explorerHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <WalletText message="View transaction" /> <ReviewIcon kind="arrow" />
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

function ReceiptSteps({ state }: { state: TransactionReceiptState }) {
  const locale = useWalletLocale();
  const completedStages = receiptCompletedStages({ subject: 'transaction', state });
  return (
    <div class="seams-receipt-steps" aria-label={walletText(locale, 'Transaction progress')}>
      <ReceiptStep
        stage="signing"
        label={walletText(locale, 'Signed')}
        activeLabel="Signing"
        complete={completedStages >= 1}
        active={state.kind === 'signing'}
      />
      <ReceiptStep
        stage="broadcast"
        label={walletText(locale, 'Broadcast')}
        activeLabel="Broadcasting"
        complete={completedStages >= 2}
        active={state.kind === 'broadcasting'}
      />
      <ReceiptStep
        stage="confirming"
        label={walletDisplayText(locale, state.kind === 'reverted' ? 'Reverted' : 'Confirmed')}
        activeLabel="Confirming"
        complete={completedStages === 3}
        active={state.kind === 'submitted'}
      />
    </div>
  );
}

/**
 * A message signature has one stage. It keeps the transaction's three tracks, so
 * the receipt has the same height, and fills them all once signed. Only the first
 * track has a label: there is no broadcast or confirmation.
 */
function MessageReceiptSteps({ state }: { state: MessageReceiptState }) {
  const locale = useWalletLocale();
  const complete = state.kind === 'signed';
  const active = state.kind === 'signing';
  return (
    <div class="seams-receipt-steps" aria-label={walletText(locale, 'Transaction progress')}>
      <ReceiptStep
        stage="signing"
        label={walletText(locale, 'Signed')}
        activeLabel="Signing"
        complete={complete}
        active={active}
      />
      <ReceiptStep stage="signed" label="" activeLabel="" complete={complete} active={false} />
      <ReceiptStep stage="signed" label="" activeLabel="" complete={complete} active={false} />
    </div>
  );
}

/** The signed message's own fields: signer, recipient and message text. */
function MessageReceiptFields({ model }: { model: TransactionReviewData['model'] }) {
  const locale = useWalletLocale();
  const operation = model?.operations.length === 1 ? model.operations[0] : null;
  if (operation?.kind !== 'near.message') return null;
  return (
    <>
      {operation.fields?.map((field) => (
        <div key={field.label}>
          <dt>
            <WalletText copy={field.label} />
          </dt>
          {field.renderAs === 'file-content' ? (
            <dd>
              <span class="seams-receipt-message">{field.value}</span>
              <CopyReviewValue value={field.copyValue ?? field.value} />
            </dd>
          ) : (
            <dd class="seams-review-recipient">
              <CopyReviewValue
                value={field.copyValue ?? field.value}
                address
                label={walletDisplayText(locale, `Copy ${field.label.toLowerCase()} address ${field.value}`)}
              />
            </dd>
          )}
        </div>
      ))}
    </>
  );
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
      <WalletText copy={props.active ? props.activeLabel : props.label} />
    </span>
  );
}
