import { isFunction, isPlainObject } from '@shared/utils/validation';
import { hostPluginUrl } from '@/core/walletRuntimePaths/base';
import { SPEAK_TO_SIGN_HOST_API_VERSION, type SpeakToSignHostPlugin } from './hostPlugin';
import { findWalletTransactionFeature, type WalletTransactionFeaturePlugin } from './plugins';

const SPEAK_TO_SIGN_HOST_PATH = '/sdk/speak-to-sign/host.js';

/**
 * Loads the trusted Speak-to-Sign host plugin on first use. A Wallet that does not
 * enable the feature never requests it. Configuration cannot supply executable code.
 */
export async function loadSpeakToSignHost(
  enabled: readonly WalletTransactionFeaturePlugin[],
): Promise<SpeakToSignHostPlugin> {
  if (!findWalletTransactionFeature(enabled, 'speak_to_sign')) {
    throw new Error('Enable Speak-to-Sign in the SDK configuration before using it.');
  }
  let module: unknown;
  try {
    // This runtime URL is supplied by the host deployment, outside this npm package.
    module = await import(
      /* @vite-ignore */ hostPluginUrl(SPEAK_TO_SIGN_HOST_PATH, SPEAK_TO_SIGN_HOST_API_VERSION)
    );
  } catch (cause) {
    throw await speakToSignLoadFailure(cause);
  }
  if (
    !isPlainObject(module) ||
    module.hostApiVersion !== SPEAK_TO_SIGN_HOST_API_VERSION ||
    !isFunction(module.createSpeakToSignHostPlugin)
  ) {
    throw new Error(
      'Speak-to-Sign is incompatible with this Wallet host. Install matching package versions.',
    );
  }
  const plugin: unknown = module.createSpeakToSignHostPlugin();
  if (!isHostPlugin(plugin)) throw new Error('Speak-to-Sign host implementation is invalid.');
  return plugin;
}

function isHostPlugin(value: unknown): value is SpeakToSignHostPlugin {
  return (
    isPlainObject(value) &&
    isFunction(value.requestTransfer) &&
    isFunction(value.requestNoteAction) &&
    isFunction(value.requestMessage) &&
    isFunction(value.enroll)
  );
}

async function speakToSignLoadFailure(cause: unknown): Promise<Error> {
  const status = await probeStatus();
  return status === 404 || status === 410
    ? new Error(
        'Speak-to-Sign is missing from this Wallet host. Install @seams/wallet-voice-sign on this Wallet host.',
        { cause },
      )
    : new Error('Speak-to-Sign could not load. Check your connection and retry.', { cause });
}

async function probeStatus(): Promise<number | null> {
  try {
    const url = hostPluginUrl(SPEAK_TO_SIGN_HOST_PATH, SPEAK_TO_SIGN_HOST_API_VERSION);
    const response = await fetch(url, {
      cache: 'no-cache',
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}
