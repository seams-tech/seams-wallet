// The NEP-413 message of the `spoken-intent` crate (seams-tech/speak-to-sign):
// `SpokenRequestV1::SignedMessage`. The owner says a summary, and the verdict binds the 32 bytes
// that the key signs. The crate's golden vector checks the Borsh bytes and the digest.

import { spokenRequestBorsh } from '@shared/speakToSign/spokenRequest';
import type { SpeakToSignNetwork } from './plugins';
import { hex, renderSummary, summaryRefusal } from './spokenNote';
import { spokenDigests, type RenderedTransfer, type SpokenDigests } from './spokenTransfer';

/** A spoken NEP-413 message. The owner says the summary only. */
export type SpokenMessageAction = Readonly<{
  message: string;
  recipient: string;
  /** base64 of the 32-byte NEP-413 nonce. The Wallet host draws it before the owner speaks. */
  nonce: string;
  callbackUrl: string | null;
  /** The application's own value, which the signed result returns. It is not signed. */
  state: string | null;
  /** SHA-256 of the NEP-413 bytes of the message, nonce, recipient and callback URL. */
  payloadSha256: Uint8Array;
  /** The sentence that the owner says. See `summaryRefusal`. */
  summary: string;
}>;

/** Why core cannot sign this message, or null. */
export function messageActionRefusal(
  action: SpokenMessageAction,
): 'summary_not_speakable' | 'message_not_valid' | null {
  const valid =
    action.message.length > 0 && action.recipient.length > 0 && action.payloadSha256.length === 32;
  if (!valid) return 'message_not_valid';
  return summaryRefusal(action.summary) === null ? null : 'summary_not_speakable';
}

export function renderMessage(action: SpokenMessageAction): RenderedTransfer {
  return renderSummary(action.summary);
}

export async function messageDigests(
  network: SpeakToSignNetwork,
  owner: string,
  action: SpokenMessageAction,
): Promise<SpokenDigests> {
  const borsh = spokenRequestBorsh({
    kind: 'signed_message',
    network,
    owner,
    payloadSha256: action.payloadSha256,
    summary: action.summary,
  });
  return await spokenDigests(borsh, renderMessage(action).spokenText);
}

/** The `request` of the verifier's `verify` input. */
export function messageVerifyRequest(action: SpokenMessageAction): Readonly<Record<string, unknown>> {
  return {
    kind: 'signed_message',
    payload_sha256_hex: hex(action.payloadSha256),
    summary: action.summary,
  };
}
