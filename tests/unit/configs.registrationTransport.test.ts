import { test, expect } from '@playwright/test';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';

const iframeWallet = { walletOrigin: 'https://wallet.example.test' } as const;

test.describe('buildConfigsFromEnv registration transport defaults', () => {
  test('declaring registration config and leaving it incomplete throws', async () => {
    expect(() =>
      buildConfigsFromEnv({
        relayer: { url: 'https://relay.example' },
        iframeWallet,
        // @ts-expect-error managed registration requires publishableKey.
        registration: { mode: 'managed', projectEnvironmentId: 'env_prod' },
      }),
    ).toThrow(/registration\.publishableKey/i);
  });
});
