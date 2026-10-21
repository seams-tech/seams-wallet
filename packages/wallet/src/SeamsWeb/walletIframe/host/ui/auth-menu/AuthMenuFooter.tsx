/** @jsxImportSource preact */
import { WalletText } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { Component, type ComponentChildren } from 'preact';
import { SeamsWordmark } from '@/core/signingEngine/uiConfirm/ui/preact/SeamsWordmark';
import { alertIcon, shieldIcon } from './icons';

type AuthMenuFooterProps = {
  /** The failure to show in place of the brand line, or null when there is none. */
  readonly notice: string | null;
  readonly onRetry: () => void;
};

/**
 * The strip along the card's bottom edge. It names who secures the menu, and a
 * failure takes that line over, so reporting one never moves the controls.
 */
export class AuthMenuFooter extends Component<AuthMenuFooterProps> {
  // The last failure stays in the strip while it fades back to the brand line.
  private shownNotice = '';

  render(): ComponentChildren {
    const { notice, onRetry } = this.props;
    if (notice) this.shownNotice = notice;
    return (
      <div class="seams-auth-footer" data-state={notice ? 'notice' : 'brand'}>
        <div class="seams-auth-footer-brand" aria-hidden={notice ? 'true' : undefined}>
          {shieldIcon()}{' '}
          <span>
            <WalletText message="Secured by" />
          </span>{' '}
          <SeamsWordmark />
        </div>
        <div class="seams-auth-footer-notice">
          {alertIcon()}
          <span class="seams-auth-footer-text" aria-hidden="true">
            <WalletText copy={this.shownNotice} />
          </span>
          <button
            class="seams-auth-footer-action"
            type="button"
            disabled={!notice}
            onClick={onRetry}
          >
            <WalletText message="Try again" />
          </button>
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
