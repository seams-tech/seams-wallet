// What one spoken request signs, and the evidence that approves it. Wallet core builds the
// request of a verdict from the intent, so the caller of the sign path supplies no digest of
// the request and no sentence.

import type { SpokenEvidenceKind } from '@shared/speakToSign/evidence';
import {
  renderSpokenFields,
  spokenFieldsRefusal,
  spokenVerifyRequest,
  type SpokenFieldsRefusal,
  type SpokenTypedFields,
} from '@shared/speakToSign/spokenKinds';
import { spokenRequestBorsh, type SpokenRequest } from '@shared/speakToSign/spokenRequest';
import type { SpeakToSignNetwork } from './plugins';
import {
  messageActionRefusal,
  messageRequest,
  messageVerifyRequest,
  renderMessage,
  type SpokenMessageAction,
} from './spokenMessage';
import {
  noteActionRefusal,
  noteActionRequest,
  noteVerifyRequest,
  renderNoteAction,
  type SpokenNoteAction,
} from './spokenNote';
import { spokenDigests, type RenderedTransfer, type SpokenDigests } from './spokenTransfer';

/**
 * The thing to sign for one spoken request: the fields of a typed kind (`SPOKEN_KINDS`), a
 * general transaction with its delivery, or a NEP-413 message.
 */
export type SpokenIntent =
  | Extract<SpokenTypedFields, { kind: 'account_transfer' }>
  | SpokenNoteAction
  | Readonly<{ kind: 'signed_message'; message: SpokenMessageAction }>;

/** A signed statement that approves one request, of the evidence kind of the verifier backend. */
export type SpokenEvidence = Readonly<{
  kind: SpokenEvidenceKind;
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
  | SpokenFieldsRefusal {
  if (intent.kind === 'signed_message') return messageActionRefusal(intent.message);
  if (intent.kind === 'transaction') return noteActionRefusal(network, intent);
  return spokenFieldsRefusal(intent, network);
}

/** The request that a verdict for this intent names, with its request and spoken-text digests. */
export async function intentEvidence(
  network: SpeakToSignNetwork,
  owner: string,
  intent: SpokenIntent,
): Promise<Readonly<{ request: SpokenRequest; digests: SpokenDigests }>> {
  const request =
    intent.kind === 'signed_message'
      ? messageRequest(network, owner, intent.message)
      : await noteActionRequest(network, owner, intent);
  const digests = await spokenDigests(spokenRequestBorsh(request), renderIntent(intent).spokenText);
  return { request, digests };
}

/** The request digest and the spoken-text digest that a verdict for this intent names. */
export async function intentDigests(
  network: SpeakToSignNetwork,
  owner: string,
  intent: SpokenIntent,
): Promise<SpokenDigests> {
  return (await intentEvidence(network, owner, intent)).digests;
}

/** The sentence of the intent: what the card shows and the words that the owner says. */
export function renderIntent(intent: SpokenIntent): RenderedTransfer {
  if (intent.kind === 'signed_message') return renderMessage(intent.message);
  return intent.kind === 'transaction' ? renderNoteAction(intent) : renderSpokenFields(intent);
}

/** The `request` of the verifier's `verify` input for this intent. */
export async function intentVerifyRequest(
  intent: SpokenIntent,
): Promise<Readonly<Record<string, unknown>>> {
  if (intent.kind === 'signed_message') return messageVerifyRequest(intent.message);
  if (intent.kind === 'transaction') return await noteVerifyRequest(intent);
  return await spokenVerifyRequest(intent);
}
