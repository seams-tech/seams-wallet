import { defineSeamsConfig } from '@seams/wallet/react';

function requiredEnvironmentVariable(name: string): string {
  const value = import.meta.env[name];
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Set ${name} to run this example`);
  return value.trim();
}

export const walletOrigin = requiredEnvironmentVariable('VITE_WALLET_ORIGIN');
export const exampleConfig = defineSeamsConfig({
  walletOrigin,
  relayerUrl: requiredEnvironmentVariable('VITE_RELAYER_URL'),
  projectEnvironmentId: requiredEnvironmentVariable('VITE_PROJECT_ENVIRONMENT_ID'),
  publishableKey: requiredEnvironmentVariable('VITE_PUBLISHABLE_KEY'),
  chains: [{ network: 'near-testnet' }],
});
