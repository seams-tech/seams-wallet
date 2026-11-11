// What one spoken request signs, and the evidence that approves it. Wallet core builds the
// request of a verdict from the intent, so the caller of the sign path supplies no digest of
// the request and no sentence.

import type { SpokenTypedFields } from '@shared/speakToSign/spokenKinds';
import type { SpeakToSignNetwork } from './plugins';
import { messageActionRefusal, messageDigests, type SpokenMessageAction } from './spokenMessage';
import { noteActionDigests, noteActionRefusal, type SpokenNoteAction } from './spokenNote';
import {
  isSpeakableAccount,
  isSpeakableHundredths,
  transferDigests,
  type SpokenDigests,
} from './spokenTransfer';

const YOCTO_PER_HUNDREDTH = 10n ** 22n;

/**
 * The thing to sign for one spoken request: the fields of a typed kind (`SPOKEN_KINDS`), a
 * general transaction with its delivery, or a NEP-413 message.
 */
export type SpokenIntent =
  | Extract<SpokenTypedFields, { kind: 'account_transfer' }>
  | SpokenNoteAction
  | Readonly<{ kind: 'signed_message'; message: SpokenMessageAction }>;

/** A signed statement that approves one request. The first kind is the voice verdict. */
export type SpokenEvidence = Readonly<{
  kind: 'voice_verdict_v2';
  /** The verifier output, as the verify route returned it. Core checks it. */
  output: unknown;
}>;

/** Why core cannot sign this intent, or null. No verdict can approve a refused intent. */
export function intentRefusal(network: SpeakToSignNetwork, intent: SpokenIntent): string | null {
  if (intent.kind === 'signed_message') return messageActionRefusal(intent.message);
  if (intent.kind !== 'account_transfer') return noteActionRefusal(network, intent);
  if (!isSpeakableAccount(intent.receiver)) return 'receiver_not_speakable';
  // The sentence says whole hundredths of NEAR, so another amount has no sentence.
  const speakable =
    intent.amountYocto % YOCTO_PER_HUNDREDTH === 0n &&
    isSpeakableHundredths(intent.amountYocto / YOCTO_PER_HUNDREDTH);
  return speakable ? null : 'amount_not_speakable';
}

/** The request digest and the spoken-text digest that a verdict for this intent names. */
export async function intentDigests(
  network: SpeakToSignNetwork,
  owner: string,
  intent: SpokenIntent,
): Promise<SpokenDigests> {
  if (intent.kind === 'signed_message') return await messageDigests(network, owner, intent.message);
  if (intent.kind !== 'account_transfer') return await noteActionDigests(network, owner, intent);
  return await transferDigests({
    network,
    owner,
    receiver: intent.receiver,
    amountYocto: intent.amountYocto,
  });
}
