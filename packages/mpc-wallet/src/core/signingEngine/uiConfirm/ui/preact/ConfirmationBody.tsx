/** @jsxImportSource preact */
import {
  WalletText,
  WalletLocaleContext,
} from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { walletDisplayText } from '@/core/ui/messages';
import type { WalletLocale } from '@/core/ui/locale';
import { Component } from 'preact';
import type { ConfirmationBodyModel } from '../confirmation-body-model';

function assertNever(value: never): never {
  throw new Error(`Unexpected confirmation body: ${String(value)}`);
}

export class ConfirmationBody extends Component<{
  model: ConfirmationBodyModel;
  onCopyAccount: (accountId: string) => void;
}> {
  static contextType = WalletLocaleContext;
  declare context: WalletLocale;

  private copy = (): void => {
    if (this.props.model.kind === 'funding') this.props.onCopyAccount(this.props.model.accountId);
  };

  render() {
    const model = this.props.model;
    switch (model.kind) {
      case 'empty':
        return null;
      case 'text':
        return (
          <div class="confirmation-body">
            <WalletText copy={model.text} />
          </div>
        );
      case 'status':
        return (
          <div class="confirmation-body confirmation-body--status">
            <WalletText copy={model.text} />
          </div>
        );
      case 'funding':
        return (
          <div class="confirmation-body confirmation-body--funding">
            <WalletText message="NEAR account" />
            <button
              type="button"
              class="confirmation-body__copy-target"
              title={walletDisplayText(this.context, `Copy ${model.accountId}`)}
              aria-label={walletDisplayText(this.context, `Copy NEAR account ${model.accountId}`)}
              onClick={this.copy}
            >
              {model.shortAccountId}
            </button>
            <WalletText message="needs funding" />
          </div>
        );
      default:
        return assertNever(model);
    }
  }
}
