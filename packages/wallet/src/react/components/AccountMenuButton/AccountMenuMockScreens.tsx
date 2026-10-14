import React from 'react';
import { AuthenticationMethodsView } from './AuthenticationMethodsView';
import { AccountMenuScreen } from './AccountMenuScreen';
import { AccountMenuDeviceDetails } from './AccountMenuDeviceDetails';
import { AuthenticationMethodRow } from './AuthenticationMethodRow';
import { QRCodeScannerCamera } from '../QRCodeScannerCamera';
import { MailIcon } from './icons/MailIcon';
import { ExportKeysScreen } from './ExportKeysScreen';
import { AccountsSection } from './AccountsSection';
import type { AccountsSectionRow, ExportChain } from './types';

type DeviceMethods = 'passkey' | 'email_otp' | 'both';
type PreviewDevice = { id: string; name: string; lastUsed: string; methods: DeviceMethods };
export type AccountPreviewScreen =
  | { kind: 'overview' }
  | { kind: 'accounts' }
  | { kind: 'export-keys' }
  | { kind: 'export-key'; chain: ExportChain }
  | { kind: 'transactions' }
  | { kind: 'methods' }
  | { kind: 'linked' }
  | { kind: 'device'; device: PreviewDevice; parent: 'linked' }
  | { kind: 'scanner' }
  | { kind: 'recovery'; revealed: boolean };
const devices: readonly PreviewDevice[] = [
  { id: 'macbook', name: 'MacBook Pro', lastUsed: 'Now', methods: 'both' },
  {
    id: 'iphone',
    name: 'iPhone',
    lastUsed: 'Today, 09:41',
    methods: 'passkey',
  },
  {
    id: 'pixel',
    name: 'Pixel 9',
    lastUsed: 'Yesterday',
    methods: 'email_otp',
  },
];
function selectDevice(
  setScreen: (screen: AccountPreviewScreen) => void,
  parent: 'linked',
  device: PreviewDevice,
): void {
  setScreen({ kind: 'device', device, parent });
}
function methodLabel(choice: DeviceMethods): string {
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
  parent: 'linked',
  device: PreviewDevice,
): React.JSX.Element {
  return (
    <AuthenticationMethodRow
      key={device.id}
      kind={device.methods === 'email_otp' ? 'email_otp' : 'passkey'}
      title={device.name}
      description={methodLabel(device.methods)}
      onSelect={selectDevice.bind(null, setScreen, parent, device)}
    />
  );
}
function MethodTiles({ methods }: { methods: DeviceMethods }): React.JSX.Element {
  return (
    <ul className="seams-account-method-tiles" aria-label="Authentication methods">
      {methods !== 'email_otp' ? (
        <AuthenticationMethodRow
          kind="passkey"
          title="Passkey"
          description="Touch ID · This device"
        />
      ) : null}
      {methods !== 'passkey' ? (
        <AuthenticationMethodRow
          kind="email_otp"
          title="Email OTP"
          description="alex@example.com"
        />
      ) : null}
    </ul>
  );
}
function selectExportKey(
  setScreen: (screen: AccountPreviewScreen) => void,
  chain: ExportChain,
): void {
  setScreen({ kind: 'export-key', chain });
}
const recoveryCodes = [
  '4821–7396–2058–1643',
  '9164–3082–7541–6290',
  '3579–1468–8023–5916',
  '6208–9531–4672–1805',
];
function recoveryCodeRow(code: string, index: number): React.JSX.Element {
  return (
    <li key={code} aria-label={`Recovery code ${index + 1}`}>
      <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <code>{code}</code>
    </li>
  );
}
function assertNever(value: never): never {
  throw new Error(`Unknown account preview screen: ${String(value)}`);
}

export function AccountMenuMockScreens({
  screen,
  setScreen,
  accounts,
  transactionSettings,
  walletId,
}: {
  screen: AccountPreviewScreen;
  setScreen: (screen: AccountPreviewScreen) => void;
  accounts: AccountsSectionRow[];
  transactionSettings: React.ReactNode;
  walletId: string;
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
    case 'export-keys':
      return (
        <ExportKeysScreen
          onBack={back}
          loadingChain={null}
          canExportNearKey
          canExportEvmKeys
          onSelectChain={selectExportKey.bind(null, setScreen)}
        />
      );
    case 'export-key':
      return (
        <AccountMenuScreen
          title={screen.chain === 'near' ? 'Export NEAR key' : 'Export EVM keys'}
          onBack={setScreen.bind(null, { kind: 'export-keys' })}
        >
          <p className="seams-account-description">
            Your wallet requires authentication before revealing this signing key.
          </p>
          <dl className="seams-account-inset">
            <div className="seams-account-detail-row">
              <dt>Wallet</dt>
              <dd>{walletId}</dd>
            </div>
            <div className="seams-account-detail-row">
              <dt>Key type</dt>
              <dd>{screen.chain === 'near' ? 'Ed25519' : 'ECDSA'}</dd>
            </div>
            <div className="seams-account-detail-row">
              <dt>Protection</dt>
              <dd>Authentication required</dd>
            </div>
          </dl>
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
      return (
        <AccountMenuScreen title="Authentication methods" onBack={back}>
          <AuthenticationMethodsView walletLabel={walletId} status="Active">
            <MethodTiles methods="both" />
          </AuthenticationMethodsView>
        </AccountMenuScreen>
      );
    case 'linked':
      return (
        <AccountMenuScreen title="Linked devices" onBack={back}>
          <p className="seams-account-description">Manage how your devices unlock your wallet.</p>
          <ul>{devices.map(deviceRow.bind(null, setScreen, screen.kind))}</ul>
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
              screen.device.methods === 'email_otp' ? (
                <MailIcon size={30} strokeWidth={1.5} />
              ) : undefined
            }
            title={screen.device.name}
            description={methodLabel(screen.device.methods)}
            details={[
              { label: 'Status', value: 'Active' },
              { label: 'Last used', value: screen.device.lastUsed },
            ]}
          >
            <MethodTiles methods={screen.device.methods} />
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
          title={screen.revealed ? 'Your recovery codes' : 'Recovery codes'}
          onBack={
            screen.revealed ? setScreen.bind(null, { kind: 'recovery', revealed: false }) : back
          }
        >
          <p className="seams-account-description">
            {screen.revealed
              ? 'Save these codes in your password manager or another secure place.'
              : 'Keep your recovery codes somewhere safe. Use a code to restore access to your wallet.'}
          </p>
          {screen.revealed ? (
            <ol className="seams-account-recovery-codes" aria-label="Recovery codes">
              {recoveryCodes.map(recoveryCodeRow)}
            </ol>
          ) : null}
          <div className="seams-account-inset">
            Keep these codes private. Anyone with a code can start recovering your wallet.
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
