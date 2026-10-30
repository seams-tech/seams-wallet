/** @jsxImportSource preact */
import { WalletText } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { Component, type ComponentChildren } from 'preact';
import { SeamsWordmark } from '@/core/signingEngine/uiConfirm/ui/preact/SeamsWordmark';
import { alertIcon } from './icons';
import type { HostedAuthMenuFooterBrand } from '../../../shared/authMenuPresentation';
import type { WalletConnectionState } from '../../../shared/walletAlternatives';

type AuthMenuFooterProps = {
  /** The failure to show in place of the brand line, or null when there is none. */
  readonly notice: string | null;
  readonly onRetry: () => void;
  readonly brand: HostedAuthMenuFooterBrand;
  readonly connection: WalletConnectionState;
};

/**
 * The strip along the card's bottom edge. It names who secures the menu, and a
 * failure takes that line over, so reporting one never moves the controls.
 */
export class AuthMenuFooter extends Component<AuthMenuFooterProps> {
  // The last failure stays in the strip while it fades back to the brand line.
  private shownNotice = '';

  render(): ComponentChildren {
    const { onRetry, brand, connection } = this.props;
    const notice = footerNotice(connection, this.props.notice);
    if (notice) this.shownNotice = notice;
    return (
      <div class="seams-auth-footer" data-state={notice ? 'notice' : 'brand'}>
        <div class="seams-auth-footer-brand" aria-hidden={notice ? 'true' : undefined}>
          {renderBrand(brand, connection)}
        </div>
        <div class="seams-auth-footer-notice">
          {alertIcon()}
          <span class="seams-auth-footer-text" aria-hidden="true" title={this.shownNotice}>
            <WalletText copy={this.shownNotice} />
          </span>
          {connection.kind === 'idle' ? (
            <button
              class="seams-auth-footer-action"
              type="button"
              disabled={!notice}
              onClick={onRetry}
            >
              <WalletText message="Try again" />
            </button>
          ) : null}
        </div>
        {notice ? (
          <p class="sr-only" role="alert">
            <WalletText copy={notice} />
          </p>
        ) : null}
      </div>
    );
  }
}

function footerNotice(connection: WalletConnectionState, notice: string | null): string | null {
  switch (connection.kind) {
    case 'pending':
      return null;
    case 'failed':
      return connection.message;
    case 'idle':
      return notice;
    default:
      return assertNever(connection);
  }
}

function renderBrand(
  brand: HostedAuthMenuFooterBrand,
  connection: WalletConnectionState,
): ComponentChildren {
  if (connection.kind === 'pending') {
    return (
      <span role="status">
        <WalletText copy="Complete the request in your wallet." />
      </span>
    );
  }
  switch (brand.kind) {
    case 'custom':
      return <img class="seams-auth-footer-logo" src={brand.logo} alt={brand.name} />;
    case 'seams':
      return (
        <>
          <span>
            <WalletText message="Secured by" />
          </span>{' '}
          <SeamsWordmark />
        </>
      );
    default:
      return assertNever(brand);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown footer state: ${value}`);
}
