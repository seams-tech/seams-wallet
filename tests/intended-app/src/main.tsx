import React from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider, TransactionReviewHost, defineSeamsConfig } from '@seams/wallet/react';
import '@seams/wallet/react/styles';
import { IntendedBehaviourE2EPage } from './page';
import { EmailCodeUnlock } from './EmailCodeUnlock';
import { UnlockWallet } from './UnlockWallet';
import { AssetMenu } from './AssetMenu';
import { AccountMenu } from './AccountMenu';

function requiredEnvironmentValue(name: string): string {
  const environment = import.meta.env as Record<string, unknown>;
  const value = String(environment[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function signingSessionDefaultsFromUrl(): { ttlMs: number; remainingUses: number } | undefined {
  const params = new URL(window.location.href).searchParams;
  const ttl = params.get('signingSessionTtlMs');
  const uses = params.get('signingSessionUses');
  if (ttl === null && uses === null) return undefined;
  const ttlMs = Number(ttl);
  const remainingUses = Number(uses);
  if (
    ttl === null ||
    uses === null ||
    !Number.isSafeInteger(ttlMs) ||
    !Number.isSafeInteger(remainingUses) ||
    ttlMs < 0 ||
    remainingUses < 0
  ) {
    throw new Error('Signing session test defaults require nonnegative integers');
  }
  return { ttlMs, remainingUses };
}

const walletOrigin = requiredEnvironmentValue('VITE_WALLET_ORIGIN');
const config = defineSeamsConfig({
  walletOrigin,
  signingSessionDefaults: signingSessionDefaultsFromUrl(),
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
    <SeamsWebProvider config={config}>
      <TransactionReviewHost>
        <IntendedBehaviourE2EPage />
        <UnlockWallet />
        <EmailCodeUnlock />
        <AssetMenu />
        <AccountMenu />
      </TransactionReviewHost>
    </SeamsWebProvider>
  </React.StrictMode>,
);
