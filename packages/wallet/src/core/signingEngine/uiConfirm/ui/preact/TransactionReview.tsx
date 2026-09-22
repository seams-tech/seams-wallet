/** @jsxImportSource preact */
import { Component, createRef } from 'preact';
import type { TreeNode } from '../transaction-display/tree';
import type { TxDisplayModel } from '@/core/signingEngine/interfaces/display';
import { copySurfaceText } from './clipboard';
import { CopyStatusIcon } from './CopyStatusIcon';
import { ReviewDisclosure } from './ReviewDisclosure';
import { SeamsWordmark } from './SeamsWordmark';
import { transactionLabelTitle } from './TransactionLabel';

export type TransactionReviewData = {
  detailsInitiallyOpen?: boolean;
  model: TxDisplayModel | null;
  tree: TreeNode | null;
};

export function ReviewIcon({
  kind,
}: {
  kind:
    | 'back'
    | 'close'
    | 'minimize'
    | 'check'
    | 'arrow'
    | 'shield'
    | 'copy'
    | 'loader'
    | 'alert'
    | 'fingerprint';
}) {
  const paths = {
    back: 'm15 6-6 6 6 6',
    close: 'M6 6l12 12M6 18L18 6',
    minimize: 'M5 12h14',
    check: 'm5 12 4 4L19 6',
    arrow: 'M7 17 17 7M7 7h10v10',
    shield: 'M12 3 4.5 6v5.5c0 4.2 2.7 7.4 7.5 9.5 4.8-2.1 7.5-5.3 7.5-9.5V6L12 3Z M8.5 11.5l2.5 2.5 4.5-5',
    copy: 'M8 8h12v12H8ZM4 16V4h12',
    loader: 'M12 3a9 9 0 1 1-9 9',
    alert: 'M12 8v5m0 3v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    fingerprint:
      'M6.405 19.048c.184-.443.353-.894.507-1.351M14.343 20.693c.266-.751.502-1.516.707-2.294.186-.706.346-1.422.478-2.147M19.448 17.058c.364-1.964.555-3.989.555-6.058 0-4.418-3.582-8-8-8-1.255 0-2.443.289-3.501.805M3.523 15.025c.314-1.29.48-2.638.48-4.025 0-1.74.556-3.351 1.499-4.664M12.003 11c0 2.76-.447 5.416-1.273 7.899-.213.639-.451 1.266-.712 1.881M7.712 14.5c.191-1.138.291-2.308.291-3.5 0-2.209 1.791-4 4-4s4 1.791 4 4c0 .617-.02 1.229-.058 1.836',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

export function reviewNetwork(model: TxDisplayModel | null): string {
  if (!model) return 'Wallet transaction';
  if (model.chain === 'evm' && model.chainId === 8453) return 'Base';
  if (model.chain === 'evm' && model.chainId === 84532) return 'Base Sepolia';
  if (model.chain === 'evm' && model.chainId === 1) return 'Ethereum';
  if (model.chain === 'evm' && model.chainId === 11155111) return 'Ethereum Sepolia';
  return `${model.chain.toUpperCase()}${model.chainId ? ` · ${model.chainId}` : ''}`;
}

export function reviewRecipient(model: TxDisplayModel | null): string | null {
  if (model?.operations.length !== 1) return null;
  const operation = model.operations[0];
  return operation.kind === 'generic.contractCall' || operation.kind === 'tempo.eip2718'
    ? (operation.to ?? null)
    : null;
}

export class ReviewAddress extends Component<{ value: string }> {
  private readonly root = createRef<HTMLSpanElement>();
  private motion: Animation | null = null;
  private observer: ResizeObserver | null = null;

  private measure = (): void => {
    const root = this.root.current;
    if (!root) return;
    this.clear();
    const overflowing = (root.firstElementChild?.scrollWidth ?? 0) > root.clientWidth + 1;
    root.dataset.overflowing = String(overflowing);
    root.tabIndex = overflowing ? 0 : -1;
  };

  componentDidMount(): void {
    this.measure();
    this.observer = new ResizeObserver(this.measure);
    if (this.root.current) this.observer.observe(this.root.current);
  }

  reveal = (): void => {
    const root = this.root.current;
    const text = root?.firstElementChild;
    if (!root || !(text instanceof HTMLElement)) return;
    const overflow = text.scrollWidth - root.clientWidth;
    if (overflow <= 1 || this.motion) return;
    root.dataset.revealing = 'true';
    const reduced = root.ownerDocument.defaultView?.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    this.motion = text.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(-${overflow}px)` }],
      {
        duration: reduced ? 0 : 200,
        easing: 'linear',
        fill: 'forwards',
      },
    );
    this.motion.onfinish = this.reachedEnd;
  };

  private reachedEnd = (): void => {
    if (this.root.current) this.root.current.dataset.revealEnd = 'true';
  };

  reset = (): void => {
    const root = this.root.current;
    if (root?.matches(':hover, :focus')) return;
    this.clear();
  };

  private clear(): void {
    if (this.motion) this.motion.onfinish = null;
    this.motion?.cancel();
    this.motion = null;
    if (this.root.current) {
      delete this.root.current.dataset.revealing;
      delete this.root.current.dataset.revealEnd;
    }
  }

  componentDidUpdate(previous: { value: string }): void {
    if (previous.value !== this.props.value) this.measure();
  }

  componentWillUnmount(): void {
    this.observer?.disconnect();
    this.clear();
  }

  render() {
    return (
      <span
        ref={this.root}
        class="seams-review-address"
        dir="ltr"
        title={this.props.value}
        aria-label={this.props.value}
        onMouseEnter={this.reveal}
        onMouseLeave={this.reset}
        onFocus={this.reveal}
        onBlur={this.reset}
      >
        <span>{this.props.value}</span>
      </span>
    );
  }
}

function TokenIcon({ symbol }: { symbol: string }) {
  if (symbol === 'ETH')
    return (
      <svg class="seams-review-token" viewBox="0 0 42 42" aria-hidden="true">
        <circle cx="21" cy="21" r="21" fill="#eef0fb" />
        <path d="m21 6-9 15 9 5 9-5Z" fill="#627eea" />
        <path d="m21 6 9 15-9 5Z" fill="#465da9" />
        <path d="m12 23 9 13 9-13-9 5Z" fill="#627eea" />
      </svg>
    );
  if (symbol === 'USDC')
    return (
      <svg class="seams-review-token" viewBox="0 0 42 42" aria-hidden="true">
        <circle cx="21" cy="21" r="21" fill="#2775ca" />
        <path
          d="M17 8a14 14 0 0 0 0 26M25 8a14 14 0 0 1 0 26M26 15c-1-4-10-4-10 1 0 5 10 3 10 8 0 5-9 5-11 1M21 10v4m0 14v4"
          fill="none"
          stroke="white"
          stroke-width="2"
        />
      </svg>
    );
  return (
    <span class="seams-review-token seams-review-token-fallback" aria-hidden="true">
      {symbol.slice(0, 1)}
    </span>
  );
}

export function ReviewAmount({
  model,
  compact = false,
}: {
  model: TxDisplayModel | null;
  compact?: boolean;
}) {
  const amount = reviewAmount(model);
  if (!amount) return null;
  return (
    <div class={`seams-review-amount${compact ? ' seams-review-amount--compact' : ''}`}>
      {!compact && <TokenIcon symbol={amount.symbol} />}
      <div>
        <span>{amount.value}</span> <small>{amount.symbol}</small>
      </div>
    </div>
  );
}

export function WalletReceiptFooter() {
  return (
    <div class="seams-receipt-footer">
      <ReviewIcon kind="shield" /> <span>Secured by</span> <SeamsWordmark />
    </div>
  );
}

function decimalUnits(value: string, decimals: number): string {
  if (!/^\d+$/.test(value)) return value;
  const padded = value.padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`;
}

export function reviewAmount(
  model: TxDisplayModel | null,
): { value: string; symbol: string } | null {
  const total = model?.totals;
  if (!total?.nativeValue) return null;
  if (total.nativeSymbol === 'yoctoNEAR')
    return { value: decimalUnits(total.nativeValue, 24), symbol: 'NEAR' };
  // A chain's native denomination cannot be inferred from EVM compatibility alone.
  return { value: total.nativeValue, symbol: total.nativeSymbol ?? '' };
}

export class CopyReviewValue extends Component<{ value: string; address?: boolean; label?: string }, { copied: boolean }> {
  state = { copied: false };
  private lifetime = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;

  private resetCopied = (): void => { this.setState({ copied: false }); };

  componentWillUnmount(): void {
    this.lifetime.abort();
    if (this.timer !== null) clearTimeout(this.timer);
  }

  componentDidUpdate(previous: { value: string }): void {
    if (previous.value === this.props.value) return;
    this.lifetime.abort();
    this.lifetime = new AbortController();
    if (this.timer !== null) clearTimeout(this.timer);
    this.resetCopied();
  }

  private copy = async (event: MouseEvent): Promise<void> => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const signal = this.lifetime.signal;
    try {
      const copied = await copySurfaceText(target, this.props.value, signal);
      if (!copied || signal.aborted) return;
      this.setState({ copied: true });
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(this.resetCopied, 3000);
    } catch {
      if (!signal.aborted) this.setState({ copied: false });
    }
  };
  render() {
    return (
      <button
        type="button"
        class={`seams-review-copy${this.props.address ? ' seams-review-copy-address' : ''}${this.state.copied ? ' copied' : ''}`}
        onClick={this.copy}
        aria-label={this.state.copied ? 'Copied' : this.props.label ?? 'Copy value'}
      >
        {this.props.address && <bdi class="seams-review-full-address" dir="ltr">{this.props.value}</bdi>}
        <CopyStatusIcon />
      </button>
    );
  }
}

function ReviewDetailLabel({ node }: { node: TreeNode }) {
  if (node.action || node.transaction) {
    return <>{transactionLabelTitle(node)}</>;
  }
  if (node.fieldLabel) {
    const value = node.label.slice(node.fieldLabel.length);
    return <>{node.fieldLabel}{node.fieldLabel === 'Method:' ? <span class="seams-review-function">{value}</span> : value}</>;
  }
  const call = /^(Call(?:ing)? )([^\s]+)(.*)$/.exec(node.label);
  if (call) {
    return <>{call[1]}<span class="seams-review-function">{call[2]}</span>{call[3]}</>;
  }
  return <>{node.label}</>;
}

function ReviewDetail({ node }: { node: TreeNode }) {
  const content = node.contentVariants?.decoded ?? node.content;
  const block = Boolean(node.contentVariants || content?.includes('\n'));
  return (
    <div class="seams-review-detail">
      <div class={content ? `seams-review-detail-row${block ? ' seams-review-detail-row--block' : ''}` : 'seams-review-detail-label'}>
        <span><ReviewDetailLabel node={node} /></span>
        {content && <pre>{content}</pre>}
        {node.copyValue && <CopyReviewValue value={node.copyValue} />}
      </div>
      {node.contentVariants && (
        <details class="seams-review-raw">
          <summary>Raw data</summary>
          <pre>{node.contentVariants.raw}</pre>
        </details>
      )}
      {Boolean(node.children?.length) && (
        <div class="seams-review-detail-children">
          {node.children?.map((child) => (
            <ReviewDetail key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TransactionReview({
  data,
  details = true,
}: {
  data: TransactionReviewData;
  details?: boolean;
}) {
  const model = data.model;
  const operation = model?.operations[0];
  const recipient = reviewRecipient(model);
  return (
    <div class="seams-transaction-review">
      <ReviewAmount model={model} />
      {model?.warnings?.map((warning) => (
        <div key={warning.code} class="seams-review-warning" role="alert">
          {warning.message}
        </div>
      ))}
      <dl class="seams-review-fields">
        {recipient && (
          <div>
            <dt>To</dt>
            <dd class="seams-review-recipient">
              <CopyReviewValue value={recipient} address label={`Copy recipient address ${recipient}`} />
            </dd>
          </div>
        )}
        {model && (
          <div>
            <dt>Network</dt>
            <dd>
              <span class="seams-review-network-dot" />
              {reviewNetwork(model)}
            </dd>
          </div>
        )}
        {model?.totals?.estimatedFee && (
          <div>
            <dt>Estimated network fee</dt>
            <dd>
              {model.totals.estimatedFee} {model.totals.feeSymbol}
            </dd>
          </div>
        )}
      </dl>
      {details && data.tree && (
        <ReviewDisclosure
          initiallyOpen={data.detailsInitiallyOpen}
          label={operation?.kind === 'near.message' ? 'Message details' : 'Transaction details'}
        >
          <ReviewDetail node={data.tree} />
        </ReviewDisclosure>
      )}
      {model?.signerAccount && (
        <div class="seams-review-account">
          <span class="seams-review-avatar" aria-hidden="true">
            S
          </span>
          <div>
            Signing account
            <small>
              <CopyReviewValue
                value={model.signerAccount}
                address
                label={`Copy signing account address ${model.signerAccount}`}
              />
            </small>
          </div>
        </div>
      )}
    </div>
  );
}
