/** @jsxImportSource preact */
import { Component } from 'preact';
import type { ConfirmationBodyModel } from '../confirmation-body-model';

function assertNever(value: never): never {
  throw new Error(`Unexpected confirmation body: ${String(value)}`);
}

export class ConfirmationBody extends Component<{
  model: ConfirmationBodyModel;
  onCopyAccount: (accountId: string) => void;
}> {
  private copy = (): void => {
    if (this.props.model.kind === 'funding') this.props.onCopyAccount(this.props.model.accountId);
  };

  render() {
    const model = this.props.model;
    switch (model.kind) {
      case 'empty':
        return null;
      case 'text':
        return <div class="confirmation-body">{model.text}</div>;
      case 'status':
        return <div class="confirmation-body confirmation-body--status">{model.text}</div>;
      case 'funding':
        return (
          <div class="confirmation-body confirmation-body--funding">
            NEAR account
            <button
              type="button"
              class="confirmation-body__copy-target"
              title={`Copy ${model.accountId}`}
              aria-label={`Copy NEAR account ${model.accountId}`}
              onClick={this.copy}
            >
              {model.shortAccountId}
            </button>
            needs funding
          </div>
        );
      default:
        return assertNever(model);
    }
  }
}
