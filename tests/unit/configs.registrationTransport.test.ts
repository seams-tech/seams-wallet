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

  test('accepts managed registration with only a publishable key', async () => {
    // The publishable key identifies the environment on its own: its record
    // carries the environment it belongs to, and the Router API builds the
    // runtime policy scope from the authenticated key. `projectEnvironmentId`
    // is an optional cross-check, not a second required credential.
    const cfg = buildConfigsFromEnv({
      relayer: { url: 'https://relay.example' },
      iframeWallet,
      registration: {
        mode: 'managed',
        publishableKey: 'pk_publishable',
      },
    });

    expect(cfg.registration.mode).toBe('managed');
    if (cfg.registration.mode !== 'managed') {
      throw new Error('Expected managed registration mode');
    }
    expect(cfg.registration.publishableKey).toBe('pk_publishable');
    expect(cfg.registration.projectEnvironmentId).toBe('');
  });
});
