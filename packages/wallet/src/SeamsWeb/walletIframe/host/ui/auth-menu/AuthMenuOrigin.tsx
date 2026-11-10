/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';
import { PadlockIcon } from '@/core/signingEngine/uiConfirm/ui/preact/PadlockIcon';
import { useWalletLocale } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { walletDisplayText } from '@/core/ui/messages';
import { backIcon, closeIcon } from './icons';

/**
 * The site asking. It stays put in every view, so switching views never moves it. When the menu
 * is a step of an app's dialog, the row also holds the Back or Close that the app asked for.
 */
export function AuthMenuOrigin(props: {
  readonly hostname: string;
  readonly chrome: 'back' | 'close' | undefined;
  readonly closeLabel: string;
  /** The menu's own back button shows in an in-progress view, so the step's Back waits. */
  readonly hidden: boolean;
  readonly disabled: boolean;
  readonly onChrome: () => void;
}): ComponentChildren {
  const label = walletDisplayText(
    useWalletLocale(),
    props.chrome === 'back' ? 'Back' : props.closeLabel,
  );
  const control = props.chrome ? (
    <button
      type="button"
      class={`seams-menu-chrome is-${props.chrome}`}
      aria-label={label}
      title={label}
      hidden={props.hidden}
      disabled={props.disabled}
      data-auth-menu-chrome={props.chrome}
      onClick={props.onChrome}
    >
      {props.chrome === 'back' ? backIcon() : closeIcon()}
    </button>
  ) : null;
  return (
    <div class="seams-menu-origin">
      {props.chrome === 'back' ? control : null}
      <PadlockIcon /> <span>{props.hostname}</span>
      {props.chrome === 'close' ? control : null}
    </div>
  );
}
