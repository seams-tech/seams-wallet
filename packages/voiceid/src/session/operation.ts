import type { VoiceCaptureObserver } from '@seams/voice-capture';
import type { SpokenPhrase } from '../browser/phrase';
import type {
  VoiceIdTranscriptionModel,
  VoiceIdOperationChallenge,
  VoiceIdOperationProof,
  WalletAuthMethodHostPlugin,
} from '@seams/wallet/voiceid-host';
import { prepareVoiceModelWithProgress } from '../browser/progress';
import { readVoiceEnrollment } from '../browser/enrollmentStore';
import { captureVoiceIdOperation } from '../capture/deviceBridge';
import type { PreparedVoiceCapture } from '../capture/surface';

export async function prepareOperationSurface(
  input: Parameters<WalletAuthMethodHostPlugin['confirmOperation']>[0],
  signal: AbortSignal,
  parent: HTMLElement,
  model: VoiceIdTranscriptionModel,
): Promise<PreparedVoiceCapture<VoiceIdOperationProof>> {
  const preparation = await input.prepareOperation(signal);
  if (!(await readVoiceEnrollment(preparation.scope))) {
    throw new Error('Open Manage voice to import or record your enrollment on this device.');
  }
  await prepareVoiceModelWithProgress(parent, signal, model);
  signal.throwIfAborted();
  // The operation window opens only now, after the models load.
  const challenge = await preparation.challenge(signal);
  signal.throwIfAborted();
  return {
    kind: 'recording',
    expiresAtMs: challenge.expiresAtMs,
    action: captureAndConfirm.bind(null, model, challenge),
  };
}

function captureAndConfirm(
  model: VoiceIdTranscriptionModel,
  challenge: VoiceIdOperationChallenge,
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
): Promise<VoiceIdOperationProof> {
  return challenge.complete(
    captureVoiceIdOperation.bind(null, model, { onCapture, phrase }),
    signal,
  );
}
