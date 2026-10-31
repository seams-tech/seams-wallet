import { requireVoiceUserAction } from '../browser/microphone';
import type { VoiceCaptureObserver } from '../browser/microphone';
import type { SpokenPhrase } from '../browser/phrase';
import type {
  VoiceIdTranscriptionModel,
  AuthMethodUnlockSuccess,
  WalletAuthMethodHostPlugin,
  VoiceIdUnlockChallenge,
} from '@seams/wallet/voiceid-host';
import { prepareVoiceModelWithProgress } from '../browser/progress';
import { readVoiceEnrollment } from '../browser/enrollmentStore';
import { captureVoiceIdUnlock } from '../capture/deviceBridge';
import type { PreparedVoiceCapture } from '../capture/surface';

type PreparedVoiceIdUnlock = Readonly<{
  challenge: VoiceIdUnlockChallenge;
  initiation: 'hosted_menu' | 'sdk_request';
}>;

export async function prepareUnlockSurface(
  input: Parameters<WalletAuthMethodHostPlugin['unlock']>[0],
  signal: AbortSignal,
  parent: HTMLElement,
  model: VoiceIdTranscriptionModel,
): Promise<PreparedVoiceCapture<AuthMethodUnlockSuccess>> {
  const preparation = await input.prepareUnlock(signal);
  const scope = preparation.scope;
  if (!(await readVoiceEnrollment(scope))) {
    throw new Error(
      'Unlock with a passkey, then open Manage voice to import or record your enrollment.',
    );
  }
  await prepareVoiceModelWithProgress(parent, signal, model);
  signal.throwIfAborted();
  const challenge = await preparation.challenge(signal);
  const prepared: PreparedVoiceIdUnlock = {
    challenge,
    initiation: input.mountCapture ? 'hosted_menu' : 'sdk_request',
  };
  signal.throwIfAborted();
  return {
    kind: 'recording',
    expiresAtMs: challenge.expiresAtMs,
    action: captureAndInstall.bind(null, model, prepared),
  };
}
async function captureAndInstall(
  model: VoiceIdTranscriptionModel,
  prepared: PreparedVoiceIdUnlock,
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
): Promise<AuthMethodUnlockSuccess> {
  switch (prepared.initiation) {
    case 'sdk_request':
      requireVoiceUserAction();
      break;
    case 'hosted_menu':
      break;
    default:
      return assertNever(prepared.initiation);
  }
  return prepared.challenge.complete(
    captureVoiceIdUnlock.bind(null, model, { onCapture, phrase }),
    signal,
  );
}

function assertNever(value: never): never {
  throw new Error(`Unexpected VoiceID initiation: ${String(value)}`);
}
