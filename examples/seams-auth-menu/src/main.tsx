import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider, defineSeamsConfig } from '@seams/wallet/react';
import {
  HostedSeamsAuthMenu,
  type HostedAuthMenuOutcome,
} from '@seams/wallet/react/hosted-seams-auth-menu';
import '@seams/wallet/react/styles';
import './styles.css';

function handleOutcome(outcome: HostedAuthMenuOutcome): void {
  console.info('Wallet authentication:', outcome);
}

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
        <HostedSeamsAuthMenu onOutcome={handleOutcome} />
      </main>
    </SeamsWebProvider>
  </StrictMode>,
);
