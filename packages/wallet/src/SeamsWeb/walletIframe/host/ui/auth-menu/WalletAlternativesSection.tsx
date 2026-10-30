/** @jsxImportSource preact */
import { Component, type ComponentChildren } from 'preact';
import type {
  WalletAlternatives,
  WalletAlternativeDescriptor,
} from '../../../shared/walletAlternatives';
import type { AuthMenuIntent } from '../../auth-menu/domain';
import { WalletText } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';

export class WalletAlternativesSection extends Component<{
  alternatives: WalletAlternatives;
  onIntent: (intent: AuthMenuIntent) => void;
}> {
  private connect = (alternativeId: string): void => {
    this.props.onIntent({ kind: 'wallet_connection', alternativeId });
  };

  private renderWalletRows(wallets: readonly WalletAlternativeDescriptor[]): ComponentChildren {
    const rows: ComponentChildren[] = [];
    for (const wallet of wallets) {
      rows.push(
        <button
          key={wallet.id}
          type="button"
          class="seams-menu-option seams-wallet-alternative"
          onClick={this.connect.bind(this, wallet.id)}
        >
          <span class="seams-alternative-icon" aria-hidden="true">
            {wallet.icon ? <img src={wallet.icon} alt="" width="32" height="32" /> : '↗'}
          </span>
          <span class="seams-menu-option-text">
            {wallet.label}
            {wallet.description && <small>{wallet.description}</small>}
          </span>
          <span class="seams-alternative-arrow" aria-hidden="true">
            ↗
          </span>
        </button>,
      );
    }
    return <div class="seams-menu-options">{rows}</div>;
  }

  render(): ComponentChildren {
    const { primary, secondary } = this.props.alternatives;
    return (
      <>
        {primary.length > 0 && (
          <section aria-label="Or connect another wallet">
            <div class="seams-menu-options-label seams-alternatives-heading">
              <WalletText copy="Or connect another wallet" />
            </div>
            {this.renderWalletRows(primary)}
          </section>
        )}
        {secondary.length > 0 && (
          <details class="seams-menu-expander" data-wallet-alternatives-secondary>
            <summary>
              <WalletText copy="More wallets" />
              <span aria-hidden="true">⌄</span>
            </summary>
            {this.renderWalletRows(secondary)}
          </details>
        )}
      </>
    );
  }
}
