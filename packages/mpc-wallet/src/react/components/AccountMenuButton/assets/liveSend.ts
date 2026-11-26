import type { SeamsWeb } from '@/SeamsWeb';
import type { ReadySend, SendOutcome } from './SendPanel';

// A send always opens the wallet's confirm card, whatever the app's preference.
const CONFIRM_IN_WALLET = { uiMode: 'modal', behavior: 'requireClick' } as const;

// An EVM error that names a cancel or a refusal happened before the wallet signed.
const NOT_SIGNED = /cancel|reject|denied|declin|not signed|aborted/i;

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** Send a prepared transfer through the wallet's own confirm card. */
export async function sendPrepared(
  seams: SeamsWeb,
  sender: { readonly walletId: string; readonly nearAccountId: string | null },
  prepared: ReadySend,
): Promise<SendOutcome> {
  if (prepared.kind === 'near') {
    if (!sender.nearAccountId) {
      return { kind: 'not_sent', message: 'This wallet has no NEAR account.' };
    }
    const result = await seams.near.signAndSendTransaction({
      walletSession: sender.walletId,
      nearAccount: sender.nearAccountId,
      receiverId: prepared.receiverId,
      actions: prepared.actions,
      options: { confirmationConfig: CONFIRM_IN_WALLET },
    });
    if (result.success) return { kind: 'sent', transactionId: result.transactionId };
    if (result.kind === 'not_submitted') return { kind: 'not_sent', message: result.error };
    return { kind: 'unknown', message: result.error };
  }
  try {
    const result = await seams.evm.signAndSendTransaction({
      walletSession: sender.walletId,
      chainTarget: prepared.asset.network,
      request: {
        chain: 'evm',
        kind: 'eip1559',
        senderSignatureAlgorithm: 'secp256k1',
        tx: prepared.tx,
      },
      options: { confirmationConfig: CONFIRM_IN_WALLET },
    });
    return { kind: 'sent', transactionId: result.txHash };
  } catch (error) {
    const text = message(error);
    return NOT_SIGNED.test(text)
      ? { kind: 'not_sent', message: text }
      : { kind: 'unknown', message: text };
  }
}
