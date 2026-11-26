import { useMemo } from 'react';
import { ExternalNearController } from '@seams/wallet-connect/client';
import { ExternalNearWalletPicker } from '@seams/wallet-connect/react';

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
