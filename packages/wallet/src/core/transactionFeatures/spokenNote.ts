// The requests that sign one transaction: the typed kinds of the `spoken-intent` crate
// (seams-tech/speak-to-sign) other than the transfer, and the general `Transaction`: any actions
// for any receiver, with a spoken summary. Everything that is particular to a typed kind (its
// limits, its sentence, its request and its call) is its entry of `SPOKEN_KINDS`
// (`@shared/speakToSign/spokenKinds`). This file adds the general transaction, and gives core one
// function for each step. The crate's golden vectors check the ports.

import { functionCall, transfer } from '@/core/types/actionBuilders';
import type { TransactionInput } from '@/core/types/actions';
import {
  hex,
  MAX_NOTE_CHARS,
  renderSpokenFields,
  spokenCallOfFields,
  spokenFieldsRefusal,
  spokenRequestOfFields,
  spokenVerifyRequest,
  type SpokenCall,
  type SpokenTypedFields,
} from '@shared/speakToSign/spokenKinds';
import {
  NOTE_RATINGS,
  sha256,
  spokenRequestBorsh,
  utf8,
  type NoteRating,
} from '@shared/speakToSign/spokenRequest';
import {
  MAX_SUMMARY_BYTES,
  MAX_SUMMARY_WORDS,
  renderSummary,
  summaryRefusal,
  type SummaryRefusal,
} from '@shared/speakToSign/spokenSummary';
import { isValidAccountId } from '@shared/utils/near';
import type { SpeakToSignNetwork } from './plugins';
import { spokenDigests, type RenderedTransfer, type SpokenDigests } from './spokenTransfer';
import type { SignedVoiceVerdict } from './voiceVerdict';

export {
  hex,
  MAX_NOTE_CHARS,
  MAX_SUMMARY_BYTES,
  MAX_SUMMARY_WORDS,
  NOTE_RATINGS,
  renderSummary,
  summaryRefusal,
  type NoteRating,
  type SummaryRefusal,
};

/**
 * A spoken request that signs one transaction: a typed kind of `SPOKEN_KINDS` other than the
 * transfer (a note, a rating, a merge approval, a bet), or the general transaction.
 */
export type SpokenNoteAction =
  | Exclude<SpokenTypedFields, { kind: 'account_transfer' }>
  /**
   * Any NEAR transaction from the owner's account. The owner says the summary only. The Wallet
   * host sets `actionsSha256` from the bytes that the signer builds.
   */
  | Readonly<{
      kind: 'transaction';
      transaction: TransactionInput;
      /** SHA-256 of the Borsh of the transaction's actions. The verdict binds it. */
      actionsSha256: Uint8Array;
      /** The sentence that the owner says. See `summaryRefusal`. */
      summary: string;
      delivery: TransactionDelivery;
    }>;

/**
 * What core does with a spoken transaction: `send` signs and sends it, `sign` signs it only,
 * and the fields of a NEP-366 delegate action sign its actions for a relayer to send.
 */
export type TransactionDelivery =
  | 'send'
  | 'sign'
  | Readonly<{ nonce: string; maxBlockHeight: string; publicKey: string }>;

/** Why core cannot build this action, or null. */
export function noteActionRefusal(
  network: SpeakToSignNetwork,
  action: SpokenNoteAction,
):
  | 'summary_not_speakable'
  | 'note_not_valid'
  | 'merge_not_valid'
  | 'bet_not_valid'
  | 'transaction_not_valid'
  | null {
  if (action.kind !== 'transaction') {
    const refusal = spokenFieldsRefusal(action, network);
    // Only a transfer has a receiver and an amount to say.
    if (refusal === 'receiver_not_speakable' || refusal === 'amount_not_speakable') return null;
    return refusal;
  }
  const { delivery } = action;
  const valid =
    isValidAccountId(action.transaction.receiverId) &&
    action.transaction.actions.length > 0 &&
    action.actionsSha256.length === 32 &&
    (typeof delivery === 'string' ||
      (/^\d{1,20}$/.test(delivery.nonce) &&
        /^\d{1,20}$/.test(delivery.maxBlockHeight) &&
        delivery.publicKey.startsWith('ed25519:')));
  if (!valid) return 'transaction_not_valid';
  return summaryRefusal(action.summary) === null ? null : 'summary_not_speakable';
}

/** The sentence of the action. `displayText` keeps the summary as the author wrote it. */
export function renderNoteAction(action: SpokenNoteAction): RenderedTransfer {
  return action.kind === 'transaction' ? renderSummary(action.summary) : renderSpokenFields(action);
}

export async function noteSha256(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return await sha256(utf8(text));
}

/** Borsh of the request kind of the action, whose explicit tags are 4 to 8. */
export async function noteActionBorsh(
  network: SpeakToSignNetwork,
  owner: string,
  action: SpokenNoteAction,
): Promise<Uint8Array> {
  if (action.kind !== 'transaction') {
    return spokenRequestBorsh(await spokenRequestOfFields(action, network, owner));
  }
  return spokenRequestBorsh({
    kind: 'transaction',
    network,
    owner,
    receiver: action.transaction.receiverId,
    actionsSha256: action.actionsSha256,
    summary: action.summary,
  });
}

export async function noteActionDigests(
  network: SpeakToSignNetwork,
  owner: string,
  action: SpokenNoteAction,
): Promise<SpokenDigests> {
  return await spokenDigests(
    await noteActionBorsh(network, owner, action),
    renderNoteAction(action).spokenText,
  );
}

/** The `request` of the verifier's `verify` input. */
export async function noteVerifyRequest(
  action: SpokenNoteAction,
): Promise<Readonly<Record<string, unknown>>> {
  if (action.kind !== 'transaction') return await spokenVerifyRequest(action);
  return {
    kind: 'transaction',
    receiver: action.transaction.receiverId,
    actions_sha256_hex: hex(action.actionsSha256),
    summary: action.summary,
  };
}

/**
 * The transaction that core signs: the one call of the typed kind (`SPOKEN_KINDS`), or the
 * application's own transaction of the general kind. A bet carries the verdict to the market
 * contract, so pass only a verdict that passed the check.
 */
export function noteTransaction(
  action: SpokenNoteAction,
  verdict: SignedVoiceVerdict,
): TransactionInput {
  if (action.kind === 'transaction') return action.transaction;
  return spokenCallTransaction(spokenCallOfFields(action, verdict));
}

/** The transaction of one action of a typed kind. */
export function spokenCallTransaction(call: SpokenCall): TransactionInput {
  const action =
    call.kind === 'transfer'
      ? transfer(`${call.depositYocto} yoctoNEAR`)
      : functionCall({
          method: call.methodName,
          args: { ...call.args },
          gas: call.gas,
          deposit: call.depositYocto.toString(),
        });
  return { receiverId: call.receiverId, actions: [action] };
}
