import { expect, test } from '@playwright/test';
import { seamsTestnetConfig } from '@/core/config/defineConfig';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';
import {
  createWalletHostConfig,
  parseWalletConfigurationUpdate,
} from '@/SeamsWeb/walletIframe/shared/configuration';
import type { SeamsConfigsInput } from '@/core/types/seams';

const INPUT = seamsTestnetConfig({
  relayerUrl: 'https://staging.api.wallet.seams.sh',
  publishableKey: 'pk_dev_test',
  projectEnvironmentId: 'proj_test:dev',
  walletOrigin: 'https://staging.sign.seams.sh',
});

function provisioning(provisioningDefaults?: unknown) {
  const input = {
    ...INPUT,
    ...(provisioningDefaults === undefined ? {} : { provisioningDefaults }),
  } as SeamsConfigsInput;
  return buildConfigsFromEnv(input).signing.thresholdEcdsa.provisioningDefaults;
}

test('registration provisions an ECDSA signer for tempo and evm by default', () => {
  expect(provisioning()).toEqual({ tempo: { enabled: true }, evm: { enabled: true } });
});

test('the provisioning defaults hold only enabled; the budget is signingSessionDefaults', () => {
  const legacy = { enabled: false, signingSession: { kind: 'jwt', ttlMs: 1, remainingUses: 1 } };
  expect(provisioning({ tempo: legacy, evm: { enabled: true } })).toEqual({
    tempo: { enabled: false },
    evm: { enabled: true },
  });
});

test('a provisioning policy without a boolean enabled is an error', () => {
  expect(() => provisioning({ tempo: { enabled: 'yes' }, evm: { enabled: true } })).toThrow(
    /provisioningDefaults\.tempo\.enabled must be a boolean/,
  );
});

test('the wallet host accepts the provisioning defaults of an older app SDK', () => {
  const config = createWalletHostConfig(buildConfigsFromEnv(INPUT));
  const legacyPolicy = {
    enabled: true,
    signingSession: { kind: 'jwt', ttlMs: 86_400_000, remainingUses: 5 },
  };
  const olderConfig = {
    ...config,
    signing: {
      ...config.signing,
      thresholdEcdsa: { provisioningDefaults: { tempo: legacyPolicy, evm: legacyPolicy } },
    },
  };
  for (const sent of [config, olderConfig]) {
    expect(
      parseWalletConfigurationUpdate({
        kind: 'configure',
        config: sent,
        assetsBaseUrl: 'https://staging.sign.seams.sh/sdk/',
      }).kind,
    ).toBe('configure');
  }
});
