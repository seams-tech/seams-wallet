import React from 'react';
import {
  DeviceAuthenticationOptions,
  type DeviceAuthenticationChoice,
} from './DeviceAuthenticationOptions';
import { AccountMenuScreen } from './AccountMenuScreen';
import { AccountMenuDeviceDetails } from './AccountMenuDeviceDetails';
import { AuthenticationMethodRow } from './AuthenticationMethodRow';
import { QRCodeScannerCamera } from '../QRCodeScannerCamera';
import { MailIcon } from './icons/MailIcon';
import { AccountsSection } from './AccountsSection';
import type { AccountsSectionRow } from './types';

export type PreviewDeviceMethods = Record<
  'macbook' | 'iphone' | 'pixel',
  DeviceAuthenticationChoice
>;
type PreviewDevice = { id: keyof PreviewDeviceMethods; name: string; lastUsed: string };
export type AccountPreviewScreen =
  | { kind: 'overview' }
  | { kind: 'accounts' }
  | { kind: 'transactions' }
  | { kind: 'methods' }
  | { kind: 'linked' }
  | { kind: 'device'; device: PreviewDevice; parent: 'methods' | 'linked' }
  | { kind: 'scanner' }
  | { kind: 'recovery'; revealed: boolean };
const devices: readonly PreviewDevice[] = [
  { id: 'macbook', name: 'MacBook Pro', lastUsed: 'Now' },
  {
    id: 'iphone',
    name: 'iPhone',
    lastUsed: 'Today, 09:41',
  },
  {
    id: 'pixel',
    name: 'Pixel 9',
    lastUsed: 'Yesterday',
  },
];
function selectDevice(
  setScreen: (screen: AccountPreviewScreen) => void,
  parent: 'methods' | 'linked',
  device: PreviewDevice,
): void {
  setScreen({ kind: 'device', device, parent });
}
function methodLabel(choice: DeviceAuthenticationChoice): string {
  switch (choice) {
    case 'passkey':
      return 'Passkey';
    case 'email_otp':
      return 'Email OTP';
    case 'both':
      return 'Passkey + Email OTP';
    default:
      return assertNever(choice);
  }
}
function deviceRow(
  setScreen: (screen: AccountPreviewScreen) => void,
  parent: 'methods' | 'linked',
  deviceMethods: Readonly<PreviewDeviceMethods>,
  device: PreviewDevice,
): React.JSX.Element {
  return (
    <AuthenticationMethodRow
      key={device.id}
      kind={deviceMethods[device.id] === 'email_otp' ? 'email_otp' : 'passkey'}
      title={device.name}
      description={methodLabel(deviceMethods[device.id])}
      onSelect={selectDevice.bind(null, setScreen, parent, device)}
    />
  );
}
function recoverySlot(value: string, index: number): React.JSX.Element {
  return <span key={index}>{value}</span>;
}
function assertNever(value: never): never {
  throw new Error(`Unknown account preview screen: ${String(value)}`);
}

export function AccountMenuMockScreens({
  screen,
  setScreen,
  accounts,
  transactionSettings,
  deviceMethods,
  onDeviceMethodsChange,
}: {
  screen: AccountPreviewScreen;
  setScreen: (screen: AccountPreviewScreen) => void;
  accounts: AccountsSectionRow[];
  transactionSettings: React.ReactNode;
  deviceMethods: Readonly<PreviewDeviceMethods>;
  onDeviceMethodsChange: (
    deviceId: keyof PreviewDeviceMethods,
    choice: DeviceAuthenticationChoice,
  ) => void;
}): React.JSX.Element | null {
  const back = setScreen.bind(null, { kind: 'overview' });
  switch (screen.kind) {
    case 'overview':
      return null;
    case 'transactions':
      return (
        <AccountMenuScreen title="Transaction settings" onBack={back}>
          {transactionSettings}
        </AccountMenuScreen>
      );
    case 'accounts':
      return (
        <AccountMenuScreen title="Accounts" onBack={back}>
          <p className="seams-account-description">Your addresses across networks.</p>
          <AccountsSection rows={accounts} />
        </AccountMenuScreen>
      );
    case 'methods':
    case 'linked':
      return (
        <AccountMenuScreen
          title={screen.kind === 'methods' ? 'Authentication methods' : 'Linked devices'}
          onBack={back}
        >
          <p className="seams-account-description">Manage how your devices unlock your wallet.</p>
          <ul>{devices.map(deviceRow.bind(null, setScreen, screen.kind, deviceMethods))}</ul>
          <button
            type="button"
            className="seams-account-action primary"
            onClick={setScreen.bind(null, { kind: 'scanner' })}
          >
            Link a device
          </button>
        </AccountMenuScreen>
      );
    case 'device':
      return (
        <AccountMenuScreen
          title="Device details"
          onBack={setScreen.bind(null, { kind: screen.parent })}
        >
          <AccountMenuDeviceDetails
            icon={
              deviceMethods[screen.device.id] === 'email_otp' ? (
                <MailIcon size={30} strokeWidth={1.5} />
              ) : undefined
            }
            title={screen.device.name}
            description={methodLabel(deviceMethods[screen.device.id])}
            details={[
              { label: 'Status', value: 'Active' },
              { label: 'Last used', value: screen.device.lastUsed },
            ]}
          >
            <DeviceAuthenticationOptions
              value={deviceMethods[screen.device.id]}
              onChange={onDeviceMethodsChange.bind(null, screen.device.id)}
            />
          </AccountMenuDeviceDetails>
        </AccountMenuScreen>
      );
    case 'scanner':
      return (
        <AccountMenuScreen title="Link a device" onBack={back}>
          <p className="seams-account-description">
            Open your wallet on the other device, then scan its pairing code.
          </p>
          <QRCodeScannerCamera>
            <div
              className="qr-scanner-video is-ready"
              aria-hidden="true"
              style={{ background: 'radial-gradient(ellipse at 50% 48%, #3e403f, #222423 75%)' }}
            />
          </QRCodeScannerCamera>
          <p className="seams-account-note">Position the QR code inside the frame.</p>
        </AccountMenuScreen>
      );
    case 'recovery':
      return (
        <AccountMenuScreen
          title={screen.revealed ? 'Your recovery code' : 'Recovery codes'}
          onBack={
            screen.revealed ? setScreen.bind(null, { kind: 'recovery', revealed: false }) : back
          }
        >
          <p className="seams-account-description">
            {screen.revealed
              ? 'Save this code in your password manager or another secure place.'
              : 'Keep a recovery code somewhere safe. Use it to restore access to your wallet.'}
          </p>
          {screen.revealed ? (
            <div className="seams-account-recovery-slots" aria-label="Example recovery code">
              {'4821739620581643'.split('').map(recoverySlot)}
            </div>
          ) : null}
          <div className="seams-account-inset">
            Only you should have this code. Anyone with it can start recovering your wallet.
          </div>
          <button
            type="button"
            className="seams-account-action primary"
            onClick={
              screen.revealed ? back : setScreen.bind(null, { kind: 'recovery', revealed: true })
            }
          >
            {screen.revealed ? 'Done' : 'Reveal with passkey'}
          </button>
        </AccountMenuScreen>
      );
    default:
      return assertNever(screen);
  }
}
