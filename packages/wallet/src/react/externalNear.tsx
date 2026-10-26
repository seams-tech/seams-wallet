import { Component, useSyncExternalStore } from 'react';
import type { ExternalNearController, ExternalNearSnapshot } from '../externalNear';

export function useExternalNear(controller: ExternalNearController): ExternalNearSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

export class ExternalNearWalletPicker extends Component<
  { controller: ExternalNearController },
  { snapshot: ExternalNearSnapshot; message: string }
> {
  state = { snapshot: this.props.controller.getSnapshot(), message: '' };
  private unsubscribe: (() => void) | null = null;
  componentDidMount(): void {
    this.unsubscribe = this.props.controller.subscribe(this.updateSnapshot);
  }
  componentWillUnmount(): void {
    this.unsubscribe?.();
    this.props.controller.disconnect();
  }
  private updateSnapshot = (): void => {
    this.setState({ snapshot: this.props.controller.getSnapshot() });
  };
  private connect = async (): Promise<void> => {
    const result = await this.props.controller.connect();
    this.setState({ message: result.ok ? 'Connected to Meteor.' : result.message });
  };
  private disconnect = (): void => {
    this.props.controller.disconnect();
    this.setState({ message: 'Disconnected from Seams. Manage site permissions in Meteor.' });
  };
  render() {
    const { connection, busy } = this.state.snapshot;
    return (
      <section aria-label="External NEAR wallet">
        <p>Meteor · {this.props.controller.network}</p>
        {connection.kind === 'connected' && <p>{connection.accountId}</p>}
        <button type="button" disabled={busy} onClick={this.connect}>
          Connect Meteor extension
        </button>
        <button
          type="button"
          disabled={connection.kind === 'disconnected'}
          onClick={this.disconnect}
        >
          Disconnect
        </button>
        <p role="status">{busy ? 'Complete the request in Meteor.' : this.state.message}</p>
      </section>
    );
  }
}
