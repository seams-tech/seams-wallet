import { walletAuthMethodPluginEnabled, type WalletAuthMethodPlugin } from './plugins';
import type { WalletAuthMethodHostPlugin } from './hostPlugin';
import { isPlainObject } from '@shared/utils/validation';

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
      return await loadVoiceIdHost();
  }
  kind satisfies never;
  throw new Error('Authentication method plugin is unavailable in this Wallet host.');
}

async function loadVoiceIdHost(): Promise<WalletAuthMethodHostPlugin> {
  let module: unknown;
  try {
    // This runtime URL is supplied by the host deployment, outside this npm package.
    module = await import(/* @vite-ignore */ '/sdk/voiceid/host.js' as string);
  } catch (cause) {
    throw new Error('VoiceID could not load. Install @seams/voiceid on this Wallet host.', {
      cause,
    });
  }
  if (
    !isPlainObject(module) ||
    module.hostApiVersion !== 1 ||
    !isHostPlugin(module.voiceIdHostPlugin)
  ) {
    throw new Error(
      'VoiceID is incompatible with this Wallet host. Install matching package versions.',
    );
  }
  return module.voiceIdHostPlugin;
}

function isHostPlugin(value: unknown): value is WalletAuthMethodHostPlugin {
  return (
    isPlainObject(value) &&
    typeof value.unlock === 'function' &&
    typeof value.activate === 'function' &&
    typeof value.review === 'function'
  );
}
