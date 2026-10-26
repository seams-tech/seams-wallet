import { Component, useMemo } from 'react';
import { functionCall } from '@seams/wallet';
import {
  ExternalNearController,
  type ExternalNearState,
  type ExternalNearSubmission,
} from '@seams/wallet/external-near';
import { ExternalNearWalletPicker, useExternalNear } from '@seams/wallet/react/external-near';

function createController(): ExternalNearController {
  return new ExternalNearController('testnet', 'https://rpc.testnet.near.org');
}

type Operation =
  | { kind: 'ready' | 'sending' | 'unknown' }
  | {
      kind: 'submitted';
      submission: ExternalNearSubmission;
      status: 'checking' | 'confirmed' | 'failed' | 'unresolved';
    };

type GreetingProps = {
  controller: ExternalNearController;
  connection: ExternalNearState;
  busy: boolean;
};

class GreetingTransaction extends Component<
  GreetingProps,
  { operation: Operation; message: string }
> {
  state: { operation: Operation; message: string } = {
    operation: { kind: 'ready' },
    message: '',
  };

  private send = async (): Promise<void> => {
    const { controller, connection, busy } = this.props;
    if (connection.kind !== 'connected' || busy || this.state.operation.kind !== 'ready') return;
    this.setState({ operation: { kind: 'sending' }, message: 'Approve in your wallet.' });
    const result = await controller.sendTransaction(connection, {
      receiverId: 'seams-v1.testnet', // Replace with your testnet contract.
      actions: [
        functionCall({ method: 'set_greeting', args: { greeting: 'Hello from my wallet' } }),
      ],
    });
    if (!result.ok) {
      const operation: Operation =
        result.code === 'submission_unknown' ? { kind: 'unknown' } : { kind: 'ready' };
      this.setState({ operation, message: result.message });
      return;
    }
    this.setState(
      {
        operation: { kind: 'submitted', submission: result.value, status: 'unresolved' },
        message: `Submitted ${result.value.hash} from ${result.value.accountId}.`,
      },
      this.checkStatus,
    );
  };

  private checkStatus = async (): Promise<void> => {
    const { operation } = this.state;
    if (operation.kind !== 'submitted' || operation.status === 'checking') return;
    const { submission } = operation;
    this.setState({ operation: { kind: 'submitted', submission, status: 'checking' } });
    const result = await this.props.controller.checkOutcome(submission);
    this.setState({
      operation: { kind: 'submitted', submission, status: result.kind },
      message: `${submission.accountId}: ${result.kind}. Transaction: ${submission.hash}`,
    });
  };

  render() {
    const { operation, message } = this.state;
    return (
      <>
        <button
          type="button"
          onClick={this.send}
          disabled={
            this.props.busy ||
            this.props.connection.kind !== 'connected' ||
            operation.kind !== 'ready'
          }
        >
          Send testnet greeting
        </button>
        {operation.kind === 'submitted' && operation.status === 'unresolved' && (
          <button type="button" onClick={this.checkStatus}>
            Check transaction status
          </button>
        )}
        {operation.kind === 'unknown' && (
          <p>Check wallet activity before preparing another transaction.</p>
        )}
        <p role="status">{message}</p>
      </>
    );
  }
}

export function ExternalNearExample() {
  const controller = useMemo(createController, []);
  const { connection, busy } = useExternalNear(controller);
  return (
    <>
      <ExternalNearWalletPicker controller={controller} />
      <GreetingTransaction controller={controller} connection={connection} busy={busy} />
    </>
  );
}
