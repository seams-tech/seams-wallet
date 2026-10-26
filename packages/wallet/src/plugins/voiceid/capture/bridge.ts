import { VoiceSpeakerMismatchError } from '../browser/verificationError';
import { voiceQualityMessage, type VoiceCaptureObserver } from '../browser/microphone';
import { VoicePhraseMismatchError, type SpokenPhrase } from '../browser/phrase';
import type { AuthMethodApprovalResult } from '@/core/authMethods/hostPlugin';
import { verifyBrowserVoice } from '../browser/enrollment';
import type { VoiceEnrollmentScope } from '../browser/enrollmentStore';

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
): Promise<AuthMethodApprovalResult> {
  const deadline = Math.min(binding.expiresAtMs, Date.now() + timeoutMs);
  if (signal.aborted || deadline <= Date.now())
    throw new Error('VoiceID review expired or was cancelled.');
  const result = await verifyBrowserVoice({ kind: 'active', scope }, signal, onCapture, phrase);
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
