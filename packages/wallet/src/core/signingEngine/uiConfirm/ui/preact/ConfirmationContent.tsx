/** @jsxImportSource preact */
import { Component, createRef } from 'preact';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { ConfirmHeader, type ConfirmHeaderProps } from './ConfirmHeader';
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

export class ConfirmationContent extends Component<{
  model: ConfirmationContentModel;
  styles: CspStylesheetManager;
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
        return (
          <div ref={this.root} class="seams-confirmation-content">
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
            <div class="responsive-card">
              <ConfirmContent
                {...model.transaction}
                styles={this.props.styles}
                decision={
                  model.prompt.kind === 'email' && model.transaction.decision.kind === 'ready'
                    ? { kind: 'form', formId: this.otpFormId }
                    : model.transaction.decision
                }
              />
            </div>
          </div>
        );
      default:
        return assertNever(model);
    }
  }
}

function ignoreCopyFailure(): void {}

function assertNever(value: never): never {
  throw new Error(`Unexpected confirmation content: ${String(value)}`);
}
