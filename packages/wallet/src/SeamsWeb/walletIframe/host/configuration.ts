import type { SeamsConfigsInput, SeamsConfigsReadonly } from '@/core/types/seams';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';

export type WalletHostConfig = Omit<SeamsConfigsReadonly, 'wallet'> & {
  readonly wallet: {
    readonly mode: 'direct';
    readonly iframe: Omit<SeamsConfigsReadonly['wallet']['iframe'], 'origin'> & {
      readonly origin?: never;
    };
  };
};

export function resolveWalletHostConfig(input: SeamsConfigsInput): WalletHostConfig {
  const { iframeWallet, ...hostInput } = input;
  const config = buildConfigsFromEnv(
    { ...hostInput, iframeWallet: { rpIdOverride: iframeWallet?.rpIdOverride } },
    { allowDirectWalletMode: 'wallet_host' },
  );
  return {
    network: config.network,
    registration: config.registration,
    signing: config.signing,
    webauthn: config.webauthn,
    wallet: {
      mode: 'direct',
      iframe: {
        servicePath: config.wallet.iframe.servicePath,
        sdkBasePath: config.wallet.iframe.sdkBasePath,
        walletHostVariant: config.wallet.iframe.walletHostVariant,
        rpIdOverride: config.wallet.iframe.rpIdOverride,
      },
    },
    ui: config.ui,
  };
}
