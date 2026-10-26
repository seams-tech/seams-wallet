import { Component, useSyncExternalStore } from 'react';
import {
  nearWalletName,
  type ExternalNearController,
  type ExternalNearSnapshot,
  type ExternalNearWalletId,
  type ExternalNearNetwork,
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
  private disconnect = (): void => {
    this.props.controller.disconnect();
    this.setState({ message: 'Disconnected from Seams. Manage site permissions in your wallet.' });
  };
  render() {
    const { connection, busy, wallets } = this.state.snapshot;
    const choices = [];
    for (const wallet of wallets) {
      choices.push(
        <NearWalletButton
          key={wallet}
          wallet={wallet}
          network={this.props.controller.network}
          busy={busy}
          onConnect={this.connect}
        />,
      );
    }
    return (
      <section aria-label="Choose your NEAR wallet" className="seams-near-picker">
        <h2>Choose your NEAR wallet</h2>
        <p className="seams-near-network">NEAR {this.props.controller.network}</p>
        <div className="seams-near-wallets">{choices}</div>
        {wallets.length === 0 && <p>No NEAR wallets are enabled.</p>}
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

const walletIcons: Record<ExternalNearWalletId, string> = { meteor: 'M', hot: '🔥', intear: 'I' };

function NearWalletButton({
  wallet,
  network,
  busy,
  onConnect,
}: {
  wallet: ExternalNearWalletId;
  network: ExternalNearNetwork;
  busy: boolean;
  onConnect: (wallet: ExternalNearWalletId) => Promise<void>;
}) {
  const unavailable = wallet === 'hot' && network !== 'mainnet';
  let description = 'Browser extension';
  if (wallet === 'intear') description = 'Opens wallet.intear.tech';
  if (unavailable) description = 'Mainnet only';
  return (
    <button type="button" disabled={busy || unavailable} onClick={onConnect.bind(null, wallet)}>
      <span className={`seams-near-icon seams-near-${wallet}`} aria-hidden="true">
        {walletIcons[wallet]}
      </span>
      <strong>{nearWalletName(wallet)}</strong>
      <small>{description}</small>
    </button>
  );
}
