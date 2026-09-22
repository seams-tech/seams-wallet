/** @jsxImportSource preact */
import type { PasskeyRegistrationConfirmDisplay } from '@/core/types';

export function PasskeyRegistrationDetails(props: { display: PasskeyRegistrationConfirmDisplay }) {
  return (
    <div class="passkey-registration-confirm__identity" aria-label="Passkey registration details">
      <div class="passkey-registration-confirm__row">
        <span class="passkey-registration-confirm__label">Account</span>
        <span class="passkey-registration-confirm__value" title={props.display.intendedUserName}>
          {props.display.intendedUserName}
        </span>
      </div>
      <div class="passkey-registration-confirm__row">
        <span class="passkey-registration-confirm__label">Website</span>
        <span class="passkey-registration-confirm__value" title={props.display.rpId}>
          {props.display.rpId}
        </span>
      </div>
    </div>
  );
}
