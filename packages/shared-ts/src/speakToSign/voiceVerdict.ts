// The verifier key of each network, and the co-signer's refusals of a Speak-to-Sign verdict.
// Wallet core checks a verdict before it signs with no confirm, and the Seams co-signer checks it
// again before it adds its part of the signature. Both check it with `checkVerdict` of
// `@seams/voice-verdict` (speak-to-sign repository), against the key that this file pins.

import { VERDICT_LIFE_MS } from '@seams/voice-verdict';
import type { SpeakToSignNetwork } from './spokenRequest';

/**
 * The verifier of each network: its OutLayer project and its project-bound verdict key. The key
 * stays the same across verifier versions. It is pinned in code and never comes from the app,
 * which supplies the Seams server URL: a key from the app would let the app supply its own
 * verdicts.
 */
export type SpeakToSignVerifier = Readonly<{ project: string; publicKey: string }>;

export const SPEAK_TO_SIGN_VERIFIERS: Readonly<
  Record<SpeakToSignNetwork, SpeakToSignVerifier | null>
> = {
  testnet: {
    project: 'seams-v1.testnet/voice-verifier',
    publicKey: 'ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U',
  },
  mainnet: null,
};

/** The verifier signs a verdict with `expires_at_ms` 120 s after its own clock. */
export const VOICE_VERDICT_LIFE_MS = VERDICT_LIFE_MS;

/**
 * Why the Seams co-signer refused a voice-approved signing request. It checks only a request
 * that carries a verdict; a normal signing request carries none.
 */
const COSIGNER_VOICE_REFUSALS = [
  /** Not a verdict v2 that approves: bad JSON, kind, renderer, fields or outcome. */
  'verdict_invalid',
  /** The signature does not verify against the pinned key of the network. */
  'signature_invalid',
  /** The network has no pinned verifier key. */
  'network_unsupported',
  'expired',
  /** The transaction is not the verdict's request: another receiver, amount, call or form. */
  'request_mismatch',
  /** The transaction is not signed by the NEAR account of the session. */
  'owner_mismatch',
  /** The co-signer already accepted this verdict for another signing request. */
  'reused',
  /** A `step_up` verdict without a fresh approval: an operation step-up or a new VoiceID unlock. */
  'step_up_required',
  /** The co-signer could not read the account or its verdict records. */
  'unavailable',
] as const;

export type CosignerVoiceRefusal = (typeof COSIGNER_VOICE_REFUSALS)[number];

/** The `code` of the co-signer's refusal response. Its `reason` is a `CosignerVoiceRefusal`. */
export const COSIGNER_VOICE_REFUSAL_CODE = 'voice_verdict_refused';
const REFUSAL_MESSAGE_PREFIX = 'Speak-to-Sign verdict refused: ';

/** The `message` of the refusal response. The Wallet finds the reason in its signing error. */
export function cosignerVoiceRefusalMessage(reason: CosignerVoiceRefusal): string {
  return `${REFUSAL_MESSAGE_PREFIX}${reason}`;
}

/** The reason in a signing error that holds the co-signer's refusal message, or null. */
export function parseCosignerVoiceRefusal(error: string): CosignerVoiceRefusal | null {
  const at = error.indexOf(REFUSAL_MESSAGE_PREFIX);
  if (at < 0) return null;
  const word = /^[a-z_]+/.exec(error.slice(at + REFUSAL_MESSAGE_PREFIX.length))?.[0];
  return COSIGNER_VOICE_REFUSALS.find((reason) => reason === word) ?? null;
}
