/** @jsxImportSource preact */
import { WalletText, useWalletLocale } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { walletText, walletDisplayText } from '@/core/ui/messages';
import type { PasskeyRegistrationConfirmDisplay } from '@/core/types';

export function PasskeyRegistrationDetails(props: { display: PasskeyRegistrationConfirmDisplay }) {
  const locale = useWalletLocale();
  return (
    <div
      class="passkey-registration-confirm__identity"
      aria-label={walletText(locale, 'Passkey registration details')}
    >
      <div class="passkey-registration-confirm__row">
        <span class="passkey-registration-confirm__label">
          <WalletText message="Account" />
        </span>
        <span
          class="passkey-registration-confirm__value"
          title={walletDisplayText(locale, props.display.intendedUserName)}
        >
          {props.display.intendedUserName}
        </span>
      </div>
      <div class="passkey-registration-confirm__row">
        <span class="passkey-registration-confirm__label">
          <WalletText message="Website" />
        </span>
        <span
          class="passkey-registration-confirm__value"
          title={walletDisplayText(locale, props.display.rpId)}
        >
          {props.display.rpId}
        </span>
      </div>
    </div>
  );
}
