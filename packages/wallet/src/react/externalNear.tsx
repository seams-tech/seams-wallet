import { Component, useSyncExternalStore } from 'react';
import {
  nearWalletName,
  type ExternalNearController,
  type ExternalNearSnapshot,
  type ExternalNearWalletId,
} from '../externalNear';
import './externalNear.css';

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
  private connect = async (wallet: ExternalNearWalletId): Promise<void> => {
    const result = await this.props.controller.connect(wallet);
    this.setState({
      message: result.ok ? `Connected to ${nearWalletName(wallet)}.` : result.message,
    });
  };
  private connectMeteor = (): void => {
    void this.connect('meteor');
  };
  private connectHot = (): void => {
    void this.connect('hot');
  };
  private connectIntear = (): void => {
    void this.connect('intear');
  };
  private disconnect = (): void => {
    this.props.controller.disconnect();
    this.setState({ message: 'Disconnected from Seams. Manage site permissions in your wallet.' });
  };
  render() {
    const { connection, busy } = this.state.snapshot;
    const hotUnavailable = this.props.controller.network !== 'mainnet';
    return (
      <section aria-label="Choose your NEAR wallet" className="seams-near-picker">
        <h2>Choose your NEAR wallet</h2>
        <p className="seams-near-network">NEAR {this.props.controller.network}</p>
        <div className="seams-near-wallets">
          <button type="button" disabled={busy} onClick={this.connectMeteor}>
            <span className="seams-near-icon seams-near-meteor" aria-hidden="true">
              M
            </span>
            <strong>Meteor Wallet</strong>
            <small>Browser extension</small>
          </button>
          <button type="button" disabled={busy || hotUnavailable} onClick={this.connectHot}>
            <span className="seams-near-icon" aria-hidden="true">
              🔥
            </span>
            <strong>HOT Wallet</strong>
            <small>{hotUnavailable ? 'Mainnet only' : 'Browser extension'}</small>
          </button>
          <button type="button" disabled={busy} onClick={this.connectIntear}>
            <span className="seams-near-icon seams-near-intear" aria-hidden="true">
              I
            </span>
            <strong>Intear Wallet</strong>
            <small>Opens wallet.intear.tech</small>
          </button>
        </div>
        {connection.kind === 'connected' && (
          <p>
            {nearWalletName(connection.wallet)} · {connection.accountId}
          </p>
        )}
        <button
          className="seams-near-disconnect"
          type="button"
          disabled={connection.kind === 'disconnected'}
          onClick={this.disconnect}
        >
          Disconnect
        </button>
        <p role="status">{busy ? 'Complete the request in your wallet.' : this.state.message}</p>
      </section>
    );
  }
}
