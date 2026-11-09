import { expect, test } from '@playwright/test';
import { seamsTestnetConfig } from '@/core/config/defineConfig';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';

const REQUIRED = {
  relayerUrl: 'https://staging.api.wallet.seams.sh',
  publishableKey: 'pk_dev_test',
  projectEnvironmentId: 'proj_test:dev',
};

function rpIdOverride(walletOrigin: string, override?: string): string | undefined {
  const input = seamsTestnetConfig({
    ...REQUIRED,
    walletOrigin,
    ...(override === undefined ? {} : { iframeWallet: { rpIdOverride: override } }),
  });
  const configs = buildConfigsFromEnv(input);
  if (configs.wallet.mode !== 'iframe') throw new Error('expected the hosted wallet');
  return configs.wallet.iframe.rpIdOverride;
}

test('a hosted wallet origin keeps no default RP ID, so its own host scopes passkeys', () => {
  expect(rpIdOverride('https://staging.sign.seams.sh')).toBeUndefined();
  expect(rpIdOverride('https://localhost:4002')).toBeUndefined();
});

test('the default RP ID still applies to a wallet origin under it', () => {
  expect(rpIdOverride('https://wallet.example.localhost')).toBe('example.localhost');
  expect(rpIdOverride('https://example.localhost')).toBe('example.localhost');
});

test('an app RP ID override always wins', () => {
  expect(rpIdOverride('https://staging.sign.seams.sh', 'seams.sh')).toBe('seams.sh');
  expect(rpIdOverride('https://wallet.example.localhost', 'wallet.example.localhost')).toBe(
    'wallet.example.localhost',
  );
});
