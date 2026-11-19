/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';
import { WalletText } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import type { AuthMenuLoginViewModel } from '../../auth-menu/domain';
import { AUTH_MENU_TITLE_ID } from './presentation';
import { RecoveryOptionList } from './RecoveryOptions';

type DeviceFactorMissingViewProps = {
  readonly account: NonNullable<AuthMenuLoginViewModel['deviceFactorMissing']>;
  readonly onLinkDevice: () => void;
  readonly onRecovery: () => void;
  readonly onBack: () => void;
};

/**
 * After a sign-in that found a wallet whose Email OTP key this device does not hold. No email
 * code was sent: an email code alone never opens a wallet here, so the view offers device
 * linking and the recovery code, whatever the app chose for the recovery options.
 */
export function DeviceFactorMissingView({
  account,
  onLinkDevice,
  onRecovery,
  onBack,
}: DeviceFactorMissingViewProps): ComponentChildren {
  return (
    <div class="seams-otp-prompt seams-device-factor-missing" aria-live="polite">
      <div class="seams-otp-prompt-copy">
        <p class="seams-device-factor-missing-account">
          <WalletText message="Signed in as {value}" values={{ value: account.emailHint }} />
        </p>
        <div class="seams-otp-title" id={AUTH_MENU_TITLE_ID}>
          <WalletText message="Use your wallet on this device" />
        </div>
        <p class="seams-otp-description">
          <WalletText message="This device has no key for this wallet yet, so no email code was sent. Link it from a device that has the wallet, or use a recovery code." />
        </p>
        <div class="seams-otp-account" title={account.walletId}>
          <span class="seams-otp-account-label">
            <WalletText message="Wallet" />
          </span>
          <span class="seams-otp-account-value">{account.walletId}</span>
        </div>
      </div>
      <RecoveryOptionList onLinkDevice={onLinkDevice} onRecovery={onRecovery} />
      <button class="seams-otp-resend" type="button" onClick={onBack}>
        <WalletText message="Use another sign-in method" />
      </button>
    </div>
  );
}
