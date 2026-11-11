/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';
import { PadlockIcon } from '@/core/signingEngine/uiConfirm/ui/preact/PadlockIcon';
import { useWalletLocale } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { walletDisplayText } from '@/core/ui/messages';
import { pressCardControl } from '@/core/signingEngine/uiConfirm/anchoredCard';
import {
  chromeHasBack,
  chromeHasClose,
  type DrawnWalletStepChrome,
  type WalletStepControl,
} from '@/SeamsWeb/walletIframe/shared/walletStep';
import { backIcon, closeIcon } from './icons';

/**
 * The site asking. It stays put in every view, so switching views never moves it. When the menu
 * is a step of an app's dialog, the row also holds the Back, Close or both that the app asked
 * for: Back before the site, Close after it.
 */
export function AuthMenuOrigin(props: {
  readonly hostname: string;
  readonly chrome: DrawnWalletStepChrome | undefined;
  readonly closeLabel: string;
  /** The menu's own back button shows in an in-progress view, so the step's Back waits. */
  readonly backHidden: boolean;
  readonly disabled: boolean;
  /** Runs after the press is reported to the app. */
  readonly onChrome: () => void;
}): ComponentChildren {
  const locale = useWalletLocale();
  const control = (kind: WalletStepControl): ComponentChildren => {
    const label = walletDisplayText(locale, kind === 'back' ? 'Back' : props.closeLabel);
    return (
      <button
        type="button"
        class={`seams-menu-chrome is-${kind}`}
        aria-label={label}
        title={label}
        hidden={kind === 'back' && props.backHidden}
        disabled={props.disabled}
        data-auth-menu-chrome={kind}
        onClick={() => {
          pressCardControl(kind);
          props.onChrome();
        }}
      >
        {kind === 'back' ? backIcon() : closeIcon()}
      </button>
    );
  };
  return (
    <div class="seams-menu-origin">
      {chromeHasBack(props.chrome) ? control('back') : null}
      <PadlockIcon /> <span>{props.hostname}</span>
      {chromeHasClose(props.chrome) ? control('close') : null}
    </div>
  );
}
