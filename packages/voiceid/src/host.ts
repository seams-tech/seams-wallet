import type { WalletAuthMethodHostPlugin } from '@seams/wallet/voiceid-host';
import { showVoiceIdCaptureSurface, VoiceIdCaptureCancelledError } from './capture/surface';
import { VOICE_ID_HOST_API_VERSION } from '@seams/wallet/voiceid-host';
import type { VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';

export const hostApiVersion = 4;
if (VOICE_ID_HOST_API_VERSION !== hostApiVersion) {
  throw new Error('VoiceID requires a matching Wallet host API.');
}

type UnlockInput = Parameters<WalletAuthMethodHostPlugin['unlock']>[0];
type ActivationInput = Parameters<WalletAuthMethodHostPlugin['activate']>[0];

export function createVoiceIdHostPlugin(
  model: VoiceIdTranscriptionModel,
): WalletAuthMethodHostPlugin {
  return {
    unlock: unlock.bind(null, model),
    activate: activate.bind(null, model),
    review: review.bind(null, model),
  };
}

function unlock(
  model: VoiceIdTranscriptionModel,
  input: UnlockInput,
): ReturnType<WalletAuthMethodHostPlugin['unlock']> {
  return showVoiceIdCaptureSurface({
    purpose: 'unlock',
    measurement: input.surfaceMeasurementBinding,
    mountCapture: input.mountCapture,
    prepare: prepareUnlock.bind(null, model, input),
  });
}

async function prepareUnlock(
  model: VoiceIdTranscriptionModel,
  input: UnlockInput,
  signal: AbortSignal,
  parent: HTMLElement,
) {
  const implementation = await import('./session/unlock');
  signal.throwIfAborted();
  return implementation.prepareUnlockSurface(input, signal, parent, model);
}

async function activate(
  model: VoiceIdTranscriptionModel,
  input: ActivationInput,
): ReturnType<WalletAuthMethodHostPlugin['activate']> {
  try {
    return await showVoiceIdCaptureSurface({
      purpose: 'activation',
      measurement: input.surfaceMeasurementBinding,
      prepare: prepareActivation.bind(null, model, input),
    });
  } catch (error) {
    if (error instanceof VoiceIdCaptureCancelledError) return { kind: 'cancelled' };
    throw error;
  }
}

async function prepareActivation(
  model: VoiceIdTranscriptionModel,
  input: ActivationInput,
  signal: AbortSignal,
) {
  const implementation = await import('./activation/addVoiceId');
  signal.throwIfAborted();
  return implementation.prepareActivationSurface(input, signal, model);
}

async function review(
  model: VoiceIdTranscriptionModel,
  request: Parameters<WalletAuthMethodHostPlugin['review']>[0],
): ReturnType<WalletAuthMethodHostPlugin['review']> {
  const implementation = await import('./capture/approval');
  return implementation.VoiceIdApproval.forReview(request, model);
}
