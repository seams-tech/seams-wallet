import {
  Component,
  useEffect,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { ExternalEvmController } from '../externalEvm/controller';
import type { ExternalEvmResult, ExternalEvmSnapshot } from '../externalEvm/types';

/** Subscribe to a host-owned controller and mount its browser discovery lifecycle. */
export function useExternalEvm(controller: ExternalEvmController): ExternalEvmSnapshot {
  useEffect(controller.mount, [controller]);
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
}

export function ExternalEvmWalletPicker({
  controller,
  snapshot,
}: {
  controller: ExternalEvmController;
  snapshot: ExternalEvmSnapshot;
}) {
  return <WalletPicker controller={controller} snapshot={snapshot} />;
}

class WalletPicker extends Component<
  {
    controller: ExternalEvmController;
    snapshot: ExternalEvmSnapshot;
  },
  { message: string }
> {
  state = { message: '' };

  private showResult(result: ExternalEvmResult<unknown>): void {
    this.setState({ message: result.ok ? 'Wallet connection updated.' : result.message });
  }

  private connect = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const walletId = new FormData(event.currentTarget).get('wallet');
    if (typeof walletId !== 'string') return;
    this.showResult(await this.props.controller.connect(walletId));
  };

  private accountChanged = (event: ChangeEvent<HTMLSelectElement>): void => {
    const connection = this.props.snapshot.connection;
    if (connection.kind === 'connected') {
      this.showResult(
        this.props.controller.selectAccount(connection, event.currentTarget.value),
      );
    }
  };

  private switchChain = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const connection = this.props.snapshot.connection;
    if (connection.kind !== 'connected') return;
    const chainId = Number(new FormData(event.currentTarget).get('chain'));
    this.showResult(await this.props.controller.switchChain(connection, chainId));
  };

  private disconnect = (): void => {
    this.props.controller.disconnect();
    this.setState({
      message: 'Disconnected from this app. Manage site permissions in your wallet.',
    });
  };

  render() {
    const { controller, snapshot } = this.props;
    const { connection, busy, wallets } = snapshot;
    const choices = [];
    for (const wallet of wallets) {
      choices.push(<option key={wallet.id} value={wallet.id}>{wallet.name}</option>);
    }
    const accounts = [];
    if (connection.kind === 'connected') {
      for (const account of connection.accounts) {
        accounts.push(<option key={account} value={account}>{account}</option>);
      }
    }
    const chains = [];
    for (const chain of controller.chains) {
      chains.push(<option key={chain.chainId} value={chain.chainId}>{chain.name}</option>);
    }
    const selectedChainId =
      connection.kind === 'connected' && connection.network.kind === 'configured'
        ? connection.chainId
        : controller.chains[0]?.chainId;
    return (
      <section aria-label="External EVM wallet" className="seams-external-evm">
        <form onSubmit={this.connect}>
          <label>
            Wallet{' '}
            <select name="wallet" disabled={busy || wallets.length === 0} required>
              {choices}
            </select>
          </label>
          <button type="submit" disabled={busy || wallets.length === 0}>
            Connect wallet
          </button>
        </form>
        {wallets.length === 0 && (
          <p>Install MetaMask, Rabby, or Phantom, then reload this page.</p>
        )}
        {connection.kind === 'connected' && (
          <>
            <p>Connected to {connection.wallet.name}</p>
            <label>
              Account{' '}
              <select
                value={connection.account}
                onChange={this.accountChanged}
                disabled={busy}
              >
                {accounts}
              </select>
            </label>
            <p>
              Network:{' '}
              {connection.network.kind === 'configured'
                ? connection.network.chain.name
                : `Unsupported network (${connection.chainId})`}
            </p>
            {connection.network.kind === 'unsupported' && (
              <p>Switch to a configured network to send transactions.</p>
            )}
            <form onSubmit={this.switchChain}>
              <label>
                Network{' '}
                <select
                  key={connection.chainId}
                  name="chain"
                  defaultValue={selectedChainId}
                  disabled={busy || chains.length === 0}
                >
                  {chains}
                </select>
              </label>
              <button type="submit" disabled={busy || chains.length === 0}>
                Switch network
              </button>
            </form>
          </>
        )}
        <button
          type="button"
          onClick={this.disconnect}
          disabled={connection.kind === 'disconnected'}
        >
          Disconnect wallet
        </button>
        <p role="status">
          {busy ? 'Complete the request in your wallet.' : this.state.message}
        </p>
      </section>
    );
  }
}
