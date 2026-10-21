/** @jsxImportSource preact */
import {
  WalletText,
  WalletLocaleContext,
} from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { walletText } from '@/core/ui/messages';
import type { WalletLocale } from '@/core/ui/locale';
import { Component, type RefObject } from 'preact';
import type { PasskeyRegistrationConfirmDisplay } from '@/core/types';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { PasskeyHaloLoading } from './PasskeyHaloLoading';
import { PasskeyRegistrationDetails } from './PasskeyRegistrationDetails';

export type PasskeyRegistrationDecision =
  | { kind: 'ready'; onConfirm: () => void }
  | { kind: 'creating'; onConfirm?: never };

export type PasskeyRegistrationContentProps = {
  display: PasskeyRegistrationConfirmDisplay;
  heading: string;
  body: string;
  cancelText: string;
  errorMessage?: string;
  decision: PasskeyRegistrationDecision;
  styles: CspStylesheetManager;
  onCancel: () => void;
  root?: RefObject<HTMLDivElement>;
};

export class PasskeyRegistrationContent extends Component<PasskeyRegistrationContentProps> {
  static contextType = WalletLocaleContext;
  declare context: WalletLocale;

  private confirm = (): void => {
    if (this.props.decision.kind === 'ready') this.props.decision.onConfirm();
  };

  private cancel = (): void => {
    this.props.onCancel();
  };

  render() {
    const creating = this.props.decision.kind === 'creating';
    return (
      <div ref={this.props.root} class="passkey-registration-confirm">
        <div class="hero passkey-registration-confirm__hero">
          <PasskeyHaloLoading
            animated={!this.props.errorMessage}
            icon="fingerprint"
            size={44}
            styles={this.props.styles}
          />
          <div class="hero-container passkey-registration-confirm__hero-copy">
            <h2 class="hero-heading">
              <WalletText copy={this.props.heading} />
            </h2>
            <p class="passkey-registration-confirm__body">
              <WalletText copy={this.props.body} />
            </p>
          </div>
        </div>
        {this.props.errorMessage && (
          <div class="error-banner">
            <WalletText copy={this.props.errorMessage} />
          </div>
        )}
        <PasskeyRegistrationDetails display={this.props.display} />
        <div class="passkey-registration-confirm__actions">
          <button type="button" class="btn btn-cancel" onClick={this.cancel}>
            <WalletText copy={this.props.cancelText} />
          </button>
          <button type="button" class="btn btn-confirm" disabled={creating} onClick={this.confirm}>
            {creating ? (
              <>
                <span
                  class="loading-indicator passkey-registration-confirm__spinner"
                  role="progressbar"
                  aria-label={walletText(this.context, 'Creating passkey')}
                />
                <span class="passkey-registration-confirm__busy-label">
                  <WalletText message="Creating passkey..." />
                </span>
              </>
            ) : (
              <WalletText message="Create passkey" />
            )}
          </button>
        </div>
      </div>
    );
  }
}
