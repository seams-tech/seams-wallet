import { buildConfigsFromEnv } from '../../packages/wallet/src/core/config/defaultConfigs';
import {
  createWalletHostConfig,
  type WalletHostConfig,
} from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/configuration';
import type { PasskeyTestConfig } from './types';

export function createTestWalletHostConfig(config: PasskeyTestConfig): WalletHostConfig {
  return createWalletHostConfig(
    buildConfigsFromEnv({
      relayer: { url: config.frontendUrl },
      registration: { projectEnvironmentId: 'proj_local:test', publishableKey: 'pk_local' },
      iframeWallet: { walletOrigin: config.walletOrigin, rpIdOverride: config.rpId },
    }),
  );
}

export function installTestWalletHostConfig(config: WalletHostConfig): void {
  Object.defineProperty(window, '__SEAMS_TEST_HOST_CONFIG__', { value: config });
}
