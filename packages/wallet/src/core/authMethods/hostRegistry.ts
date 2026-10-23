import { walletAuthMethodPluginEnabled, type WalletAuthMethodPlugin } from './plugins';
import type { WalletAuthMethodHostPlugin } from './hostPlugin';

/** One trusted loader per installed implementation. Configuration cannot supply executable code. */
export async function loadWalletAuthMethodHostPlugin(
  enabled: readonly WalletAuthMethodPlugin[],
  kind: WalletAuthMethodPlugin['kind'],
): Promise<WalletAuthMethodHostPlugin> {
  if (!walletAuthMethodPluginEnabled(enabled, kind)) {
    throw new Error('Enable the authentication method plugin before using it.');
  }
  switch (kind) {
    case 'voiceid':
      return (await import('@/plugins/voiceid/host')).voiceIdHostPlugin;
  }
  kind satisfies never;
  throw new Error('Authentication method plugin is unavailable in this Wallet host.');
}
