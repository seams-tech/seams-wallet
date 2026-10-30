/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';
import { WalletText } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import type { HostedAuthMenuRecoveryOptions } from '../../../shared/authMenuPresentation';
import { chevronIcon, linkDeviceIcon, recoveryIcon } from './icons';

type RecoveryOptionsProps = {
  readonly display: HostedAuthMenuRecoveryOptions;
  readonly onLinkDevice: () => void;
  readonly onRecovery: () => void;
};

export function RecoveryOptions({
  display,
  onLinkDevice,
  onRecovery,
}: RecoveryOptionsProps): ComponentChildren {
  if (display === 'hidden') return null;
  const options = (
    <div class="seams-menu-options">
      <button class="seams-menu-option" type="button" onClick={onLinkDevice}>
        <span class="seams-menu-option-icon">{linkDeviceIcon()}</span>
        <span class="seams-menu-option-text">
          <WalletText message="Link this device" />
          <small>
            <WalletText message="Scan a code with your other device" />
          </small>
        </span>
        {chevronIcon()}
      </button>
      <button class="seams-menu-option" type="button" data-recovery-action onClick={onRecovery}>
        <span class="seams-menu-option-icon">{recoveryIcon()}</span>
        <span class="seams-menu-option-text">
          <WalletText message="Recover wallet" />
          <small>
            <WalletText message="Use your recovery code" />
          </small>
        </span>
        {chevronIcon()}
      </button>
    </div>
  );
  switch (display) {
    case 'expanded':
      return (
        <section>
          <div class="seams-menu-options-label">
            <WalletText copy="Recover or link wallet" />
          </div>
          {options}
        </section>
      );
    case 'collapsible':
      return (
        <details class="seams-menu-expander">
          <summary>
            <WalletText copy="Recover or link wallet" />
            {chevronIcon()}
          </summary>
          {options}
        </details>
      );
    default:
      return assertNever(display);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown recovery display: ${value}`);
}
