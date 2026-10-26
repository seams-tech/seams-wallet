import { useMemo } from 'react';
import { ExternalNearController } from '@seams/wallet/external-near';
import { ExternalNearWalletPicker } from '@seams/wallet/react/external-near';

function createController() {
  return new ExternalNearController({
    network: 'testnet',
    rpcUrl: 'https://rpc.testnet.near.org',
    wallets: ['meteor'],
  });
}

export function ConnectNearWallet() {
  const controller = useMemo(createController, []);

  return <ExternalNearWalletPicker controller={controller} />;
}
