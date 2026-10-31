import { VoiceSpeakerMismatchError } from '../browser/verificationError';
import type { VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';
import { voiceQualityMessage, type VoiceCaptureObserver } from '../browser/microphone';
import { VoicePhraseMismatchError, type SpokenPhrase } from '../browser/phrase';
import type { AuthMethodApprovalResult } from '@seams/wallet/voiceid-host';
import { verifyBrowserVoice } from '../browser/enrollment';
import type { VoiceEnrollmentScope } from '@seams/wallet/voiceid-host';
import { VoiceMicrophoneInterruptedError } from '../browser/microphoneInput';

export type VoiceBinding = Readonly<{
  attemptId: string;
  operationHash: string;
  expiresAtMs: number;
}>;

export function sameVoiceBinding(left: VoiceBinding, right: VoiceBinding): boolean {
  return (
    left.attemptId === right.attemptId &&
    left.operationHash === right.operationHash &&
    left.expiresAtMs === right.expiresAtMs
  );
}

export async function listenForVoiceApproval(
  scope: VoiceEnrollmentScope,
  binding: VoiceBinding,
  timeoutMs: number,
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
  model: VoiceIdTranscriptionModel,
): Promise<AuthMethodApprovalResult> {
  const deadline = Math.min(binding.expiresAtMs, Date.now() + timeoutMs);
  if (signal.aborted || deadline <= Date.now())
    throw new Error('VoiceID review expired or was cancelled.');
  let result: Awaited<ReturnType<typeof verifyBrowserVoice>>;
  try {
    result = await verifyBrowserVoice({ kind: 'active', scope }, signal, onCapture, phrase, model);
  } catch (error) {
    if (!(error instanceof VoiceMicrophoneInterruptedError)) throw error;
    if (signal.aborted || deadline <= Date.now())
      throw new Error('VoiceID review expired or was cancelled.');
    return { kind: 'retry', message: error.message };
  }
  if (signal.aborted || deadline <= Date.now())
    throw new Error('VoiceID review expired or was cancelled.');
  switch (result.kind) {
    case 'matched':
      return { kind: 'approved' };
    case 'insufficient_audio':
      return { kind: 'retry', message: voiceQualityMessage(result.quality) };
    case 'mismatch':
      return {
        kind: 'retry',
        message: new VoiceSpeakerMismatchError(result.quality).message,
      };
    case 'phrase_mismatch':
      return { kind: 'retry', message: new VoicePhraseMismatchError().message };
    default:
      return assertNever(result);
  }
}

function assertNever(result: never): never {
  throw new Error(`Unexpected voice result: ${String(result)}`);
}
