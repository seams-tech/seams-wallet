import type { AuthMethodApprovalResult } from '@/core/authMethods/hostPlugin';
import { verifyBrowserVoice } from '../browser/enrollment';

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
  binding: VoiceBinding,
  timeoutMs: number,
  signal: AbortSignal,
  onListening: () => void,
): Promise<AuthMethodApprovalResult> {
  const deadline = Math.min(binding.expiresAtMs, Date.now() + timeoutMs);
  if (signal.aborted || deadline <= Date.now())
    throw new Error('VoiceID review expired or was cancelled.');
  const result = await verifyBrowserVoice(signal, onListening);
  if (signal.aborted || deadline <= Date.now())
    throw new Error('VoiceID review expired or was cancelled.');
  if (result.kind === 'mismatch') {
    return {
      kind: 'retry',
      message:
        'VoiceID did not match the enrolled voice. Select Confirm to try again. Read the displayed sentence in your normal voice.',
    };
  }
  return { kind: 'approved' };
}
