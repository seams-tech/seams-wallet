import { test, expect } from '@playwright/test';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';

test.describe('buildConfigsFromEnv hosted wallet origin semantics', () => {
  test('rejects explicit empty walletOrigin instead of selecting direct browser mode', async () => {
    expect(() =>
      buildConfigsFromEnv({
        relayer: { url: 'https://relay.example' },
        iframeWallet: { walletOrigin: '' },
      }),
    ).toThrow(/SEAMS_HOSTED_WALLET_ORIGIN_REQUIRED/);
  });

  test('rejects undefined walletOrigin when iframeWallet is configured', async () => {
    expect(() =>
      buildConfigsFromEnv({
        relayer: { url: 'https://relay.example' },
        iframeWallet: { walletOrigin: undefined },
      }),
    ).toThrow(/SEAMS_HOSTED_WALLET_ORIGIN_REQUIRED/);
  });

  test('rejects omitted iframeWallet instead of selecting direct browser mode', async () => {
    expect(() =>
      buildConfigsFromEnv({
        relayer: { url: 'https://relay.example' },
      }),
    ).toThrow(/SEAMS_HOSTED_WALLET_ORIGIN_REQUIRED/);
  });
});
