import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { useState, type ReactElement } from 'react';
import { ExternalNearController } from '@seams/wallet/external-near';
import { ExternalNearWalletPicker } from '@seams/wallet/react/external-near';
import {
  ExternalEvmController,
  ExternalEvmWalletPicker,
  useExternalEvm,
  TouchIcon,
  QRCodeIcon,
  SunIcon,
  MoonIcon,
  SeamsAuthMenuMock,
  ShowQRCode,
  QRCodeScanner,
  SeamsContextProvider,
  WalletSettingsPage,
  AccountMenuButton,
  defineSeamsConfig,
} from '@seams/wallet/react';
import '@seams/wallet/react/styles';

const nearController = new ExternalNearController({
  network: 'testnet',
  rpcUrl: `${location.origin}/near-rpc`,
  wallets: ['meteor', 'hot', 'intear'],
});
const evmController = new ExternalEvmController([
  { chainId: 1, name: 'Ethereum', rpcUrl: `${location.origin}/evm-rpc` },
]);
const config = defineSeamsConfig({
  walletOrigin: location.origin,
  relayerUrl: `${location.origin}/relayer`,
  projectEnvironmentId: 'proj_local:test',
  publishableKey: 'pk_local',
  chains: [{ network: 'near-testnet' }],
});
function EvmPicker() {
  const snapshot = useExternalEvm(evmController);
  return <ExternalEvmWalletPicker controller={evmController} snapshot={snapshot} />;
}
function ignorePreviewEvent() {}

function LiveSettingsModal() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={setOpen.bind(null, true)}>
        Open live wallet settings
      </button>
      <AccountMenuButton
        nearAccountId={null}
        presentation="modal"
        isMenuOpen={open}
        onMenuOpenChange={setOpen}
      />
    </>
  );
}

function Catalog() {
  return (
    <div style={{ width: 420, maxWidth: '100%', display: 'grid', gap: 24 }}>
      <ExternalNearWalletPicker controller={nearController} />
      <EvmPicker />
      <section aria-label="Standalone icons" style={{ display: 'flex', gap: 12 }}>
        <TouchIcon width={19} height={23} />
        <QRCodeIcon width={26} height={30} />
        <SunIcon size="21" animate={false} />
        <MoonIcon size={25} stroke="#114499" animate={false} />
      </section>
      <SeamsAuthMenuMock />
    </div>
  );
}

const params = new URLSearchParams(location.search);
const view = params.get('view');
let walletSurface: ReactElement | null = null;
switch (view) {
  case 'account-settings-modal':
    walletSurface = <LiveSettingsModal />;
    break;
  case 'settings':
    walletSurface = <WalletSettingsPage />;
    break;
  case 'link':
    walletSurface = (
      <ShowQRCode
        isOpen
        onClose={ignorePreviewEvent}
        onEvent={ignorePreviewEvent}
        onError={ignorePreviewEvent}
      />
    );
    break;
  case 'scanner':
    walletSurface = <QRCodeScanner showCamera={false} onClose={ignorePreviewEvent} />;
    break;
}
const content =
  walletSurface === null ? (
    <Catalog />
  ) : (
    <SeamsContextProvider config={config}>{walletSurface}</SeamsContextProvider>
  );
const root = document.getElementById('root');
if (!root) throw new Error('Missing component CSS root.');
createRoot(root).render(params.has('portal') ? createPortal(content, document.body) : content);
