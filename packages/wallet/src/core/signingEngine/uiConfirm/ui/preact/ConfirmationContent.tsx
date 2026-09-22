/** @jsxImportSource preact */
import { Component, createRef, type ComponentChildren } from 'preact';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import {
  CONFIRM_SURFACE_HEIGHT_DRIVEN_VAR,
  createSurfaceHeightReflow,
  type SurfaceHeightReflow,
} from '../confirm-surface-resize';
import { LoadingStatus, type ConfirmHeaderProps } from './ConfirmHeader';
import {
  ConfirmContent,
  type ConfirmContentProps,
  type ConfirmContentDecision,
} from './ConfirmContent';
import { ConfirmationBody } from './ConfirmationBody';
import type { ConfirmationBodyModel } from '../confirmation-body-model';
import {
  PasskeyRegistrationContent,
  type PasskeyRegistrationContentProps,
} from './PasskeyRegistrationContent';
import { EmailOtpContent, type EmailOtpContentProps } from './EmailOtpContent';
import { PadlockIcon } from './PadlockIcon';
import { copySurfaceText } from './clipboard';
import {
  TransactionReview,
  WalletReceiptFooter,
  ReviewIcon,
  type TransactionReviewData,
} from './TransactionReview';

type TransactionPrompt =
  | { kind: 'passkey' | 'session'; email?: never }
  | { kind: 'email'; email: EmailOtpContentProps };

type TransactionContentProps = Omit<ConfirmContentProps, 'styles' | 'decision'> & {
  decision: Exclude<ConfirmContentDecision, { kind: 'form' }>;
};

let nextConfirmationId = 0;

export type ConfirmationContentModel =
  | {
      kind: 'registration';
      registration: Omit<PasskeyRegistrationContentProps, 'styles'>;
      header?: never;
      body?: never;
      prompt?: never;
      transaction?: never;
    }
  | {
      kind: 'transaction';
      registration?: never;
      header: Omit<ConfirmHeaderProps, 'styles' | 'icon'>;
      body: ConfirmationBodyModel;
      prompt: TransactionPrompt;
      transaction: TransactionContentProps;
      review: TransactionReviewData;
    };

export class ConfirmationContent extends Component<{
  model: ConfirmationContentModel;
  styles: CspStylesheetManager;
  variant: 'modal' | 'drawer';
}> {
  private readonly root = createRef<HTMLDivElement>();
  private readonly otpFormId = `seams-confirmation-email-${++nextConfirmationId}`;
  private readonly reflowId = `seams-confirmation-content-surface-${nextConfirmationId}`;

  private getReflowElement = (): HTMLElement | null => {
    const root = this.root.current;
    return root?.closest<HTMLElement>('.modal-container-root, .seams-confirmation-drawer') ?? null;
  };

  private setHeight = (height: number): void => {
    const element = this.getReflowElement();
    if (!element?.id) return;
    this.props.styles.setDynamicDeclarations(this.reflowId, `#${element.id}`, {
      [CONFIRM_SURFACE_HEIGHT_DRIVEN_VAR]: `${height}px`,
    });
  };

  private readonly reflow: SurfaceHeightReflow = createSurfaceHeightReflow({
    reason: 'confirm-body',
    element: this.getReflowElement,
    setHeightCssPx: this.setHeight,
  });

  private copyAccount = (accountId: string): void => {
    const root = this.root.current;
    if (root) void copySurfaceText(root, accountId).catch(ignoreCopyFailure);
  };

  componentWillReceiveProps(): void {
    this.reflow.capture();
  }

  componentDidUpdate(previous: { styles: CspStylesheetManager }): void {
    if (previous.styles !== this.props.styles) {
      previous.styles.deleteDynamicRule(this.reflowId);
    }
    this.reflow.commit();
  }

  componentWillUnmount(): void {
    this.reflow.dispose();
    this.props.styles.deleteDynamicRule(this.reflowId);
  }

  render() {
    const model = this.props.model;
    switch (model.kind) {
      case 'registration':
        return (
          <PasskeyRegistrationContent
            {...model.registration}
            root={this.root}
            styles={this.props.styles}
          />
        );
      case 'transaction':
        return this.renderTransaction(model);
      default:
        return assertNever(model);
    }
  }

  private renderTransaction(
    model: Extract<ConfirmationContentModel, { kind: 'transaction' }>,
  ): ComponentChildren {
    const contentClass =
      this.props.variant === 'drawer'
        ? 'seams-confirmation-content seams-confirmation-content--drawer'
        : 'seams-confirmation-content';
    const decision =
      model.prompt.kind === 'email' && model.transaction.decision.kind === 'ready'
        ? { kind: 'form' as const, formId: this.otpFormId }
        : model.transaction.decision;
    return (
      <div ref={this.root} class={contentClass}>
        <div class="seams-review-content">
          {this.props.variant !== 'drawer' && <div class="seams-review-toolbar">
            <div class="seams-review-origin">
              <PadlockIcon />
              {model.header.website.kind === 'ready' ? (
                model.header.website.text
              ) : (
                <LoadingStatus label="Loading website" />
              )}
            </div>
            <button
              type="button"
              aria-label={model.transaction.cancelText}
              onClick={model.transaction.onCancel}
            >
              <ReviewIcon kind="close" />
            </button>
          </div>}
          {model.review.model && (
            <div class="seams-review-eyebrow">
              {model.review.model.operations.length === 1
                ? model.review.model.operations[0].label.replace(/\s+using\s+[\d,.]+\s+gas$/i, '')
                : 'Transaction'}
            </div>
          )}
          <h2 class="seams-review-title">{model.header.heading}</h2>
          <TransactionReview data={model.review} />
          <div class="seams-review-context">
            <ConfirmationBody model={model.body} onCopyAccount={this.copyAccount} />
            {model.prompt.kind === 'email' && (
              <EmailOtpContent {...model.prompt.email} formId={this.otpFormId} />
            )}
          </div>
          <ConfirmContent
            {...model.transaction}
            tree={null}
            styles={this.props.styles}
            decision={decision}
            cancelInHeader
            confirmIcon={
              model.prompt.kind === 'passkey' ? <ReviewIcon kind="fingerprint" /> : undefined
            }
          />
          <WalletReceiptFooter />
        </div>
      </div>
    );
  }
}

function ignoreCopyFailure(): void {}

function assertNever(value: never): never {
  throw new Error(`Unexpected confirmation content: ${String(value)}`);
}
