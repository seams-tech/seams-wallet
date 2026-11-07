import type { WalletAuthMethodHostPlugin } from '@seams/wallet/voiceid-host';
import { showVoiceIdCaptureSurface, VoiceIdCaptureCancelledError } from './capture/surface';
import type { VoiceCaptureElements } from './capture/surface';
import { VOICE_ID_HOST_API_VERSION } from '@seams/wallet/voiceid-host';
import type { VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';

export const hostApiVersion = 9;
if (VOICE_ID_HOST_API_VERSION !== hostApiVersion) {
  throw new Error('VoiceID requires a matching Wallet host API.');
}

type UnlockInput = Parameters<WalletAuthMethodHostPlugin['unlock']>[0];
type ActivationInput = Parameters<WalletAuthMethodHostPlugin['activate']>[0];
type OperationInput = Parameters<WalletAuthMethodHostPlugin['confirmOperation']>[0];

export function createVoiceIdHostPlugin(
  model: VoiceIdTranscriptionModel,
): WalletAuthMethodHostPlugin {
  return {
    unlock: unlock.bind(null, model),
    activate: activate.bind(null, model),
    confirmOperation: confirmOperation.bind(null, model),
    recordPhrase,
  };
}

/** Records one shown sentence for a transaction feature. It loads no speaker or text model. */
async function recordPhrase(
  input: Parameters<WalletAuthMethodHostPlugin['recordPhrase']>[0],
): ReturnType<WalletAuthMethodHostPlugin['recordPhrase']> {
  const implementation = await import('./capture/phrase');
  input.signal.throwIfAborted();
  return await implementation.recordPhrase(input);
}

function confirmOperation(
  model: VoiceIdTranscriptionModel,
  input: OperationInput,
): ReturnType<WalletAuthMethodHostPlugin['confirmOperation']> {
  return showVoiceIdCaptureSurface({
    purpose: 'export',
    measurement: input.surfaceMeasurementBinding,
    prepare: prepareOperation.bind(null, model, input),
  });
}

async function prepareOperation(
  model: VoiceIdTranscriptionModel,
  input: OperationInput,
  signal: AbortSignal,
  elements: VoiceCaptureElements,
) {
  const implementation = await import('./session/operation');
  signal.throwIfAborted();
  return implementation.prepareOperationSurface(input, signal, elements.progress, model);
}

function unlock(
  model: VoiceIdTranscriptionModel,
  input: UnlockInput,
): ReturnType<WalletAuthMethodHostPlugin['unlock']> {
  return showVoiceIdCaptureSurface({
    purpose: 'unlock',
    // A step-up returns to the operation; only a wallet unlock plays the success.
    unlockSuccess: input.purpose === 'step_up' ? 'skip' : 'show',
    measurement: input.surfaceMeasurementBinding,
    mountCapture: input.mountCapture,
    prepare: prepareUnlock.bind(null, model, input),
  });
}

async function prepareUnlock(
  model: VoiceIdTranscriptionModel,
  input: UnlockInput,
  signal: AbortSignal,
  elements: VoiceCaptureElements,
) {
  const implementation = await import('./session/unlock');
  signal.throwIfAborted();
  return implementation.prepareUnlockSurface(input, signal, elements.progress, model);
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
  elements: VoiceCaptureElements,
) {
  const implementation = await import('./activation/addVoiceId');
  signal.throwIfAborted();
  return implementation.prepareActivationSurface(input, signal, elements.parent, model);
}
