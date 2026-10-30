import { exampleConfig } from './exampleConfig';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider, HostedSeamsAuthMenu } from '@seams/wallet/react';
import { type HostedAuthMenuOutcome } from '@seams/wallet/react/hosted-seams-auth-menu';
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

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <SeamsWebProvider config={exampleConfig}>
      <main>
        <h1>Wallet authentication</h1>
        <HostedSeamsAuthMenu
          onOutcome={handleOutcome}
          walletAlternatives={{
            primary: [
              {
                kind: 'near',
                wallet: 'meteor',
                controller: externalNear,
                onConnected: handleExternalConnection,
              },
            ],
            secondary: [],
          }}
        />
      </main>
    </SeamsWebProvider>
  </StrictMode>,
);
