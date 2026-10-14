import React from 'react';

export type DeviceAuthenticationChoice = 'passkey' | 'email_otp' | 'both';
const options: readonly { value: DeviceAuthenticationChoice; label: string }[] = [
  { value: 'passkey', label: 'Passkey' },
  { value: 'email_otp', label: 'Email OTP' },
  { value: 'both', label: 'Both' },
];
type Props = {
  value: DeviceAuthenticationChoice;
  onChange: (value: DeviceAuthenticationChoice) => void;
  disabled?: boolean;
};
function optionButton(props: Props, option: (typeof options)[number]): React.JSX.Element {
  return (
    <button
      type="button"
      key={option.value}
      aria-pressed={props.value === option.value}
      disabled={props.disabled}
      onClick={props.onChange.bind(null, option.value)}
    >
      {option.label}
    </button>
  );
}
export function DeviceAuthenticationOptions(props: Props): React.JSX.Element {
  return (
    <fieldset className="seams-device-auth-options">
      <legend>Authentication methods</legend>
      <p>Choose how this device unlocks your wallet.</p>
      <div>{options.map(optionButton.bind(null, props))}</div>
    </fieldset>
  );
}
