import { expect, test } from '@playwright/test';
import { seamsTestnetConfig } from '@/core/config/defineConfig';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';
import type { SeamsConfigsInput } from '@/core/types/seams';

const REQUIRED = {
  relayerUrl: 'https://staging.api.wallet.seams.sh',
  publishableKey: 'pk_dev_test',
  projectEnvironmentId: 'proj_test:dev',
};

function normalSigning(walletOrigin: string, routerAb?: SeamsConfigsInput['routerAb']) {
  const input = seamsTestnetConfig({
    ...REQUIRED,
    walletOrigin,
    ...(routerAb === undefined ? {} : { routerAb }),
  });
  return buildConfigsFromEnv(input).signing.routerAb.normalSigning;
}

test('a Seams-hosted wallet origin signs NEAR through its own SigningWorker', () => {
  expect(normalSigning('https://staging.sign.seams.sh')).toEqual({
    mode: 'enabled',
    signingWorkerId: 'router-ab-signing-worker-staging',
  });
  expect(normalSigning('https://test.sign.seams.sh/')).toEqual({
    mode: 'enabled',
    signingWorkerId: 'router-ab-signing-worker-testnet',
  });
  expect(normalSigning('https://sign.seams.sh')).toEqual({
    mode: 'enabled',
    signingWorkerId: 'router-ab-signing-worker',
  });
});

test('any other wallet origin keeps normal signing off until the app configures it', () => {
  expect(normalSigning('https://wallet.example.com')).toEqual({ mode: 'disabled' });
  expect(normalSigning('https://wallet.example.localhost')).toEqual({ mode: 'disabled' });
  expect(normalSigning('http://staging.sign.seams.sh')).toEqual({ mode: 'disabled' });
});

test('an app routerAb setting always wins', () => {
  expect(
    normalSigning('https://staging.sign.seams.sh', { normalSigning: { mode: 'disabled' } }),
  ).toEqual({ mode: 'disabled' });
  expect(
    normalSigning('https://staging.sign.seams.sh', {
      normalSigning: { mode: 'enabled', signingWorkerId: 'router-ab-signing-worker-local' },
    }),
  ).toEqual({ mode: 'enabled', signingWorkerId: 'router-ab-signing-worker-local' });
  expect(
    normalSigning('https://wallet.example.com', {
      normalSigning: { mode: 'enabled', signingWorkerId: 'self-hosted-worker' },
    }),
  ).toEqual({ mode: 'enabled', signingWorkerId: 'self-hosted-worker' });
});
