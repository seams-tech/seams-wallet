import { useRef } from 'react';
import type { ExternalWalletSettings } from '@shared/auth/externalAuth';
import { AccountMenuDialogFrame } from './AccountMenuDialog';
import { AccountMenuDeviceDetails } from './AccountMenuDeviceDetails';
import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletText } from '@/core/ui/messages';
import type { WalletLocale } from '@/core/ui/locale';

type Props = {
  settings: ExternalWalletSettings;
  view: 'methods' | 'devices';
  presentation: 'page' | 'embedded';
  onClose: () => void;
};

export function ExternalWalletSettingsView(props: Props) {
  const locale = useWalletLocale();
  const ref = useRef<HTMLDivElement>(null);
  const title = props.view === 'methods' ? 'Authentication methods' : 'Linked devices';
  const details =
    props.view === 'methods'
      ? props.settings.methods.map(methodDetail.bind(null, locale))
      : props.settings.devices.map(deviceDetail.bind(null, locale));
  return (
    <AccountMenuDialogFrame
      presentation={props.presentation}
      onClose={props.onClose}
      dialogRef={ref}
      contentClassName=""
      titleId={`external-wallet-${props.view}`}
      title={title}
    >
      <AccountMenuDeviceDetails
        title="Wallet access"
        description="Connected to your wallet"
        details={details}
      />
      <p>
        <WalletText message="Confirm with a wallet authentication method to make security changes." />
      </p>
    </AccountMenuDialogFrame>
  );
}

function methodDetail(
  locale: WalletLocale,
  method: ExternalWalletSettings['methods'][number],
  index: number,
) {
  const names = { passkey: 'Passkey', email_otp: 'Email code', voiceid: 'VoiceID' };
  return {
    label: walletText(locale, 'Method {value0}', { value0: index + 1 }),
    value: names[method.kind],
  };
}

function deviceDetail(
  locale: WalletLocale,
  _device: ExternalWalletSettings['devices'][number],
  index: number,
) {
  return { label: walletText(locale, 'Device {value0}', { value0: index + 1 }), value: 'Active' };
}
