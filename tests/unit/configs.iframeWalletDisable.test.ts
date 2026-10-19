import { test, expect } from '@playwright/test';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';

test.describe('buildConfigsFromEnv hosted wallet origin semantics', () => {
  test('rejects omitted iframeWallet instead of selecting direct browser mode', async () => {
    expect(() =>
      buildConfigsFromEnv({
        relayer: { url: 'https://relay.example' },
      }),
    ).toThrow(/SEAMS_HOSTED_WALLET_ORIGIN_REQUIRED/);
  });
});
