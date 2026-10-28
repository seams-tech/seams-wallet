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
    throw await voiceIdLoadFailure(cause);
  }
  if (
    !isPlainObject(module) ||
    module.hostApiVersion !== 2 ||
    !isHostPlugin(module.voiceIdHostPlugin)
  ) {
    throw new Error(
      'VoiceID is incompatible with this Wallet host. Install matching package versions.',
    );
  }
  return module.voiceIdHostPlugin;
}

async function voiceIdLoadFailure(cause: unknown): Promise<Error> {
  const interrupted = new Error(
    'VoiceID could not load. Check your connection and retry. If it still fails, reload the page or use a passkey.',
    { cause },
  );
  let response: Response;
  try {
    response = await fetch('/sdk/voiceid/host.js', {
      cache: 'no-cache',
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
  } catch {
    return interrupted;
  }
  if (response.status === 404 || response.status === 410) {
    return new Error(
      'VoiceID is missing from this Wallet host. Install @seams/voiceid on this Wallet host, or use a passkey.',
      { cause },
    );
  }
  return interrupted;
}

function isHostPlugin(value: unknown): value is WalletAuthMethodHostPlugin {
  return (
    isPlainObject(value) &&
    typeof value.unlock === 'function' &&
    typeof value.activate === 'function' &&
    typeof value.review === 'function'
  );
}
