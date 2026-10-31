import type {
  WalletAuthMethodHostPlugin,
  AuthMethodActivationResult,
  Variant,
  VoiceIdActivationPreparation,
  VoiceIdTranscriptionModel,
} from '@seams/wallet/voiceid-host';
import type { VoiceCaptureObserver } from '../browser/microphone';
import type { SpokenPhrase } from '../browser/phrase';
import type { PreparedVoiceCapture } from '../capture/surface';
import { captureVoiceIdActivation } from '../capture/deviceBridge';
import { manageVoiceEnrollment } from './manageEnrollment';

type Activated = Variant<AuthMethodActivationResult, 'kind', 'activated'>;

export async function prepareActivationSurface(
  input: Parameters<WalletAuthMethodHostPlugin['activate']>[0],
  signal: AbortSignal,
  model: VoiceIdTranscriptionModel,
): Promise<PreparedVoiceCapture<Activated>> {
  signal.throwIfAborted();
  const prepared = await input.prepareActivation();
  signal.throwIfAborted();
  if (prepared.kind === 'enroll_existing') {
    return { kind: 'management', action: managePreparedVoiceId.bind(null, model, prepared) };
  }
  return {
    kind: 'recording',
    action: activatePreparedVoiceId.bind(null, model, prepared),
    expiresAtMs: null,
  };
}

async function managePreparedVoiceId(
  model: VoiceIdTranscriptionModel,
  prepared: Variant<VoiceIdActivationPreparation, 'kind', 'enroll_existing'>,
  signal: AbortSignal,
): Promise<Activated> {
  await manageVoiceEnrollment(prepared.confirmChange, prepared.scope, signal, model);
  signal.throwIfAborted();
  return {
    kind: 'activated',
    walletId: prepared.scope.walletId,
    walletAuthMethodId: prepared.scope.walletAuthMethodId,
  };
}

function activatePreparedVoiceId(
  model: VoiceIdTranscriptionModel,
  prepared: Variant<VoiceIdActivationPreparation, 'kind', 'activate'>,
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
): Promise<Activated> {
  return prepared.activate(
    captureVoiceIdActivation.bind(null, model, { onCapture, phrase }),
    signal,
  );
}
