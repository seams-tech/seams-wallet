import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider, defineSeamsConfig, WalletConnectorMenu } from '@seams/wallet/react';
import {
  type HostedAuthMenuOutcome,
} from '@seams/wallet/react/hosted-seams-auth-menu';
import '@seams/wallet/react/styles';
import { ExternalNearController, type ExternalNearConnection } from '@seams/wallet/external-near';
import './styles.css';

function handleOutcome(outcome: HostedAuthMenuOutcome): void {
  console.info('Wallet authentication:', outcome);
}

function handleExternalConnection(connection: ExternalNearConnection): void {
  console.info('External wallet connected:', connection);
}

const externalNear = new ExternalNearController({
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  wallets: ['meteor'],
});

function requiredEnvironmentVariable(name: string): string {
  const value = import.meta.env[name];
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Set ${name} to run this example`);
  return value.trim();
}

const config = defineSeamsConfig({
  walletOrigin: requiredEnvironmentVariable('VITE_WALLET_ORIGIN'),
  relayerUrl: requiredEnvironmentVariable('VITE_RELAYER_URL'),
  projectEnvironmentId: requiredEnvironmentVariable('VITE_PROJECT_ENVIRONMENT_ID'),
  publishableKey: requiredEnvironmentVariable('VITE_PUBLISHABLE_KEY'),
  chains: [{ network: 'near-testnet' }],
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <SeamsWebProvider config={config}>
      <main>
        <h1>Wallet authentication</h1>
        <WalletConnectorMenu
          onOutcome={handleOutcome}
          externalNear={{ controller: externalNear, onConnected: handleExternalConnection }}
        />
      </main>
    </SeamsWebProvider>
  </StrictMode>,
);
