import type { WalletAuthMethodHostPlugin } from '@/core/authMethods/hostPlugin';
import { showVoiceIdCaptureSurface, VoiceIdCaptureCancelledError } from './capture/surface';

type UnlockInput = Parameters<WalletAuthMethodHostPlugin['unlock']>[0];
type ActivationInput = Parameters<WalletAuthMethodHostPlugin['activate']>[0];

export const voiceIdHostPlugin: WalletAuthMethodHostPlugin = {
  unlock,
  activate,
  review,
};

function unlock(input: UnlockInput): ReturnType<WalletAuthMethodHostPlugin['unlock']> {
  return showVoiceIdCaptureSurface({
    purpose: 'unlock',
    measurement: input.surfaceMeasurementBinding,
    mountCapture: input.mountCapture,
    prepare: prepareUnlock.bind(null, input),
  });
}

async function prepareUnlock(input: UnlockInput, signal: AbortSignal, parent: HTMLElement) {
  const implementation = await import('./session/unlock');
  signal.throwIfAborted();
  return implementation.prepareUnlockSurface(input, signal, parent);
}

async function activate(
  input: ActivationInput,
): ReturnType<WalletAuthMethodHostPlugin['activate']> {
  try {
    return await showVoiceIdCaptureSurface({
      purpose: 'activation',
      measurement: input.context.signingEngine.getWalletIframeSurfaceMeasurementBinding(),
      prepare: prepareActivation.bind(null, input),
    });
  } catch (error) {
    if (error instanceof VoiceIdCaptureCancelledError) return { kind: 'cancelled' };
    throw error;
  }
}

async function prepareActivation(input: ActivationInput, signal: AbortSignal) {
  const implementation = await import('./activation/addVoiceId');
  signal.throwIfAborted();
  return implementation.prepareActivationSurface(input, signal);
}

async function review(
  request: Parameters<WalletAuthMethodHostPlugin['review']>[0],
  configuration: Parameters<WalletAuthMethodHostPlugin['review']>[1],
): ReturnType<WalletAuthMethodHostPlugin['review']> {
  const implementation = await import('./capture/approval');
  return implementation.voiceIdPolicyForRequest(request, configuration);
}
