import React from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider, defineSeamsConfig } from '@seams/wallet/react';
import '@seams/wallet/react/styles';
import { IntendedBehaviourE2EPage } from './page';

function requiredEnvironmentValue(name: string): string {
  const environment = import.meta.env as Record<string, unknown>;
  const value = String(environment[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const walletOrigin = requiredEnvironmentValue('VITE_WALLET_ORIGIN');
const config = defineSeamsConfig({
  walletOrigin,
  relayerUrl: requiredEnvironmentValue('VITE_RELAYER_URL'),
  projectEnvironmentId: requiredEnvironmentValue('VITE_SEAMS_PROJECT_ENVIRONMENT_ID'),
  publishableKey: requiredEnvironmentValue('VITE_SEAMS_PUBLISHABLE_KEY'),
  iframeWallet: {
    rpIdOverride: new URL(walletOrigin).hostname,
  },
  chains: [
    { network: 'near-testnet' },
    { network: 'tempo-testnet', chainId: 42_431 },
    {
      network: 'arc-testnet',
      chainId: 5_042_002,
      rpcUrl: 'https://rpc.drpc.testnet.arc.network',
      explorerUrl: 'https://testnet.arcscan.app',
    },
  ],
  signingSessionPersistenceMode:
    import.meta.env.VITE_SIGNING_SESSION_PERSISTENCE_MODE === 'sealed_refresh_v1'
      ? 'sealed_refresh_v1'
      : 'none',
  routerAb: {
    normalSigning: {
      mode: 'enabled',
      signingWorkerId: requiredEnvironmentValue('VITE_ROUTER_AB_NORMAL_SIGNING_WORKER_ID'),
    },
  },
  routerAbEcdsaDerivationPresignaturePool: {
    enabled: true,
    targetDepth: 1,
    lowWatermark: 0,
    maxRefillInFlight: 1,
    refillAttemptTimeoutMs: 30_000,
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <React.StrictMode>
    <SeamsWebProvider eager config={config}>
      <IntendedBehaviourE2EPage />
    </SeamsWebProvider>
  </React.StrictMode>,
);
