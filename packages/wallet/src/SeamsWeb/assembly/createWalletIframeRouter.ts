import { createWalletHostConfig } from '@/SeamsWeb/walletIframe/shared/configuration';
import type { AppearanceConfig, SeamsClientConfig } from '@/core/types/seams';
import type { WalletIframeRouter } from '@/SeamsWeb/walletIframe/client/router';
import { createWalletIframeOverlayState } from './createWalletIframeOverlayState';

let warnedAboutSameOriginWallet = false;

function warnIfSameOriginWallet(walletOrigin: string): void {
  if (warnedAboutSameOriginWallet) return;
  try {
    const parsed = new URL(walletOrigin);
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) {
      warnedAboutSameOriginWallet = true;
      console.warn(
        '[SeamsWeb] wallet.iframe.origin matches the host origin. Consider moving the wallet to a dedicated origin for stronger isolation.',
      );
    }
  } catch {}
}

export async function createWalletIframeRouter(args: {
  configs: SeamsClientConfig;
  walletOrigin: string;
  getAppearance: () => AppearanceConfig;
}): Promise<WalletIframeRouter> {
  warnIfSameOriginWallet(args.walletOrigin);

  const { WalletIframeRouter } = await import('@/SeamsWeb/walletIframe/client/router');
  return new WalletIframeRouter({
    walletOrigin: args.walletOrigin,
    servicePath: args.configs.wallet.iframe?.servicePath || '/wallet-service',
    connectTimeoutMs: 20_000,
    requestTimeoutMs: 60_000,
    hostConfig: createWalletHostConfig(args.configs),
    appearance: args.getAppearance(),
    getAppearance: args.getAppearance,
    sdkBasePath: args.configs.wallet.iframe?.sdkBasePath,
    createOverlayState: createWalletIframeOverlayState,
  });
}
