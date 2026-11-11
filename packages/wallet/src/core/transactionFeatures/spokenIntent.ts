// What one spoken request signs, and the evidence that approves it. Wallet core builds the
// request of a verdict from the intent, so the caller of the sign path supplies no digest of
// the request and no sentence.

import type { SpokenTypedFields } from '@shared/speakToSign/spokenKinds';
import type { SpeakToSignNetwork } from './plugins';
import {
  messageActionRefusal,
  messageDigests,
  messageVerifyRequest,
  renderMessage,
  type SpokenMessageAction,
} from './spokenMessage';
import {
  noteActionDigests,
  noteActionRefusal,
  noteVerifyRequest,
  renderNoteAction,
  type SpokenNoteAction,
} from './spokenNote';
import {
  isSpeakableAccount,
  isSpeakableHundredths,
  renderTransfer,
  transferDigests,
  type RenderedTransfer,
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
export function intentRefusal(
  network: SpeakToSignNetwork,
  intent: SpokenIntent,
):
  | ReturnType<typeof noteActionRefusal>
  | ReturnType<typeof messageActionRefusal>
  | 'receiver_not_speakable'
  | 'amount_not_speakable' {
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

/** The sentence of the intent: what the card shows and the words that the owner says. */
export function renderIntent(intent: SpokenIntent): RenderedTransfer {
  if (intent.kind === 'signed_message') return renderMessage(intent.message);
  return intent.kind === 'account_transfer' ? renderTransfer(intent) : renderNoteAction(intent);
}

/** The `request` of the verifier's `verify` input for this intent. */
export async function intentVerifyRequest(
  intent: SpokenIntent,
): Promise<Readonly<Record<string, unknown>>> {
  if (intent.kind === 'signed_message') return messageVerifyRequest(intent.message);
  if (intent.kind !== 'account_transfer') return await noteVerifyRequest(intent);
  return {
    kind: 'transfer',
    receiver: intent.receiver,
    amount_yocto: String(intent.amountYocto),
  };
}
