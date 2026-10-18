import { test, expect } from '@playwright/test';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';

test.describe('chain family naming', () => {
  test('explicit chain config is the authoritative active network set', async () => {
    const builtNetworks = buildConfigsFromEnv({
      relayer: { url: 'https://relay.example' },
      iframeWallet: { walletOrigin: 'https://wallet.example.test' },
      chains: [
        {
          network: 'near-testnet',
          rpcUrl: 'https://near-rpc.example',
          explorerUrl: 'https://near-explorer.example',
        },
        {
          network: 'arc-testnet',
          rpcUrl: 'https://arc-rpc.example',
          explorerUrl: 'https://arc-explorer.example',
          chainId: 5042002,
        },
      ],
    }).network.chains.map((chain) => chain.network);

    expect(builtNetworks).toEqual(['near-testnet', 'arc-testnet']);
  });
});
