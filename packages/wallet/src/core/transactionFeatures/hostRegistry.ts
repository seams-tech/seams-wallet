import type {
  SpeakToSignHostApproval,
  SpeakToSignHostEnrollment,
  SpeakToSignHostPlugin,
} from './hostPlugin';
import { findWalletApproval, type WalletApprovalPlugin } from './plugins';

/**
 * The Speak-to-Sign approver: the flow on the card. Its code is a chunk of the Wallet that
 * loads on the first spoken request or enrollment. A Wallet that does not enable the feature
 * never loads it. Configuration cannot supply executable code.
 */
export async function loadSpeakToSignApprover(
  enabled: readonly WalletApprovalPlugin[],
): Promise<SpeakToSignHostPlugin> {
  if (!findWalletApproval(enabled, 'spoken')) {
    throw new Error('Enable Speak-to-Sign in the SDK configuration before using it.');
  }
  return { approve, enroll };
}

async function approve(input: SpeakToSignHostApproval) {
  input.signal.throwIfAborted();
  const { runApproval } = await import('./approver/flow');
  input.signal.throwIfAborted();
  return await runApproval(input);
}

async function enroll(input: SpeakToSignHostEnrollment) {
  input.signal.throwIfAborted();
  const { runEnrollment } = await import('./approver/enroll');
  input.signal.throwIfAborted();
  return await runEnrollment(input);
}
