import { test, expect } from '@playwright/test';
import {
  chainFamilyFromNetwork,
  isEvmChainNetwork,
  isNearChainNetwork,
  isTempoChainNetwork,
  resolveExplorerUrlForChainFamily,
  resolvePrimaryExplorerUrl,
} from '@/core/config/chains';
import { PASSKEY_MANAGER_DEFAULT_CONFIGS, buildConfigsFromEnv } from '@/core/config/defaultConfigs';

test.describe('chain family naming', () => {
  test('maps concrete networks to canonical families and predicates', async () => {
    const expectedFamilies = [
      ['near-mainnet', 'near'],
      ['near-testnet', 'near'],
      ['tempo-mainnet', 'tempo'],
      ['tempo-testnet', 'tempo'],
      ['arc-mainnet', 'evm'],
      ['arc-testnet', 'evm'],
      ['ethereum-mainnet', 'evm'],
      ['ethereum-sepolia', 'evm'],
    ] as const;

    for (const [network, family] of expectedFamilies) {
      expect({
        network,
        family: chainFamilyFromNetwork(network),
        isNear: isNearChainNetwork(network),
        isTempo: isTempoChainNetwork(network),
        isEvm: isEvmChainNetwork(network),
      }).toEqual({
        network,
        family,
        isNear: family === 'near',
        isTempo: family === 'tempo',
        isEvm: family === 'evm',
      });
    }

    const configuredChains = [
      {
        network: 'near-testnet',
        rpcUrl: 'https://near-rpc.example',
        explorerUrl: 'https://near-explorer.example',
      },
      {
        network: 'arc-mainnet',
        rpcUrl: 'https://arc-rpc.example',
        explorerUrl: 'https://arc-explorer.example',
        chainId: 2415,
      },
      {
        network: 'ethereum-sepolia',
        rpcUrl: 'https://sepolia-rpc.example',
        explorerUrl: 'https://sepolia-explorer.example',
        chainId: 11155111,
      },
    ] as const;

    expect(resolvePrimaryExplorerUrl(configuredChains, 'evm')).toBe('https://arc-explorer.example');
    expect(
      resolveExplorerUrlForChainFamily({
        chains: configuredChains,
        family: 'evm',
        chainId: 11155111,
      }),
    ).toBe('https://sepolia-explorer.example');
    expect(
      resolveExplorerUrlForChainFamily({
        chains: configuredChains,
        family: 'evm',
        chainId: 2415,
      }),
    ).toBe('https://arc-explorer.example');
    expect(
      resolveExplorerUrlForChainFamily({
        chains: configuredChains,
        family: 'evm',
      }),
    ).toBe('https://arc-explorer.example');
  });

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

    expect(PASSKEY_MANAGER_DEFAULT_CONFIGS.network.chains.length).toBeGreaterThan(0);
    expect(builtNetworks).toEqual(['near-testnet', 'arc-testnet']);
  });
});
