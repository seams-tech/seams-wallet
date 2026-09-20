/** @jsxImportSource preact */
import { Component, createRef, type ComponentChildren } from 'preact';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { ConfirmHeader, LoadingStatus, type ConfirmHeaderProps } from './ConfirmHeader';
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
    };

type TransactionConfirmationModel = Extract<ConfirmationContentModel, { kind: 'transaction' }>;
type TransactionConfirmationHeader = TransactionConfirmationModel['header'];

export class ConfirmationContent extends Component<{
  model: ConfirmationContentModel;
  styles: CspStylesheetManager;
  variant: 'modal' | 'drawer';
}> {
  private readonly root = createRef<HTMLDivElement>();
  private readonly otpFormId = `seams-confirmation-email-${++nextConfirmationId}`;

  private copyAccount = (accountId: string): void => {
    const root = this.root.current;
    if (root) void copySurfaceText(root, accountId).catch(ignoreCopyFailure);
  };

  render() {
    const model = this.props.model;
    switch (model.kind) {
      case 'registration':
        return <PasskeyRegistrationContent {...model.registration} styles={this.props.styles} />;
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
        {this.props.variant === 'drawer' ? (
          <>
            <div class="responsive-card">
              <div class="drawer-header">
                <h2 class="drawer-title">{model.header.heading}</h2>
              </div>
            </div>
            <div class="responsive-card">
              <DrawerSecurityDetails header={model.header} />
              <ConfirmationBody model={model.body} onCopyAccount={this.copyAccount} />
              {model.prompt.kind === 'email' && (
                <EmailOtpContent {...model.prompt.email} formId={this.otpFormId} />
              )}
            </div>
          </>
        ) : (
          <div class="responsive-card">
            <ConfirmHeader
              {...model.header}
              icon={model.prompt.kind === 'email' ? 'mail' : 'fingerprint'}
              styles={this.props.styles}
            />
            <ConfirmationBody model={model.body} onCopyAccount={this.copyAccount} />
            {model.prompt.kind === 'email' && (
              <EmailOtpContent {...model.prompt.email} formId={this.otpFormId} />
            )}
          </div>
        )}
        <div class="responsive-card responsive-card-center">
          <ConfirmContent {...model.transaction} styles={this.props.styles} decision={decision} />
        </div>
      </div>
    );
  }
}

function DrawerSecurityDetails({ header }: { header: TransactionConfirmationHeader }) {
  return (
    <div class="rpid-wrapper">
      <div class="rpid">
        <div class="secure-indicator">
          <PadlockIcon />
          <span role="status">
            {header.website.kind === 'ready' ? (
              <span class="domain-text">{header.website.text}</span>
            ) : (
              <LoadingStatus label="Loading website" />
            )}
          </span>
        </div>
        <span class="security-details">
          <BlockHeightIcon />
          <span role="status">
            {header.chainDetails.kind === 'ready' ? (
              header.chainDetails.text
            ) : (
              <LoadingStatus label="Loading chain details" />
            )}
          </span>
        </span>
      </div>
    </div>
  );
}

function BlockHeightIcon() {
  return (
    <svg
      class="block-height-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A 2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function ignoreCopyFailure(): void {}

function assertNever(value: never): never {
  throw new Error(`Unexpected confirmation content: ${String(value)}`);
}
