// The check of spoken evidence: a signed statement of a verifier that approves one request.
// Wallet core checks it before it signs with no confirm, and the Seams co-signer checks it again
// before it adds its part of the signature. Both use the checker of the evidence kind from this
// file, and only this file and a backend module read a kind's own module in `evidence/`.

import type { SpeakToSignBackendId } from './backend';
import {
  SPEAK_TO_SIGN_VERIFIERS,
  VOICE_VERDICT_V2_CHECKER,
  type SpeakToSignVerifier,
} from './evidence/voiceVerdictV2';

export { SPEAK_TO_SIGN_VERIFIERS, type SpeakToSignVerifier };

/** The kinds of evidence. Each verifier backend signs one kind. */
export type SpokenEvidenceKind = 'voice_verdict_v2';

/** The evidence kind of each backend. A lane accepts only the kind of its backend. */
export const BACKEND_EVIDENCE_KIND: Readonly<Record<SpeakToSignBackendId, SpokenEvidenceKind>> = {
  outlayer: 'voice_verdict_v2',
};

/** The signed text, exactly as the verifier gave it, and the signature over it. */
export type SignedEvidence = Readonly<{ verdictJson: string; signatureB64: string }>;

/**
 * Why evidence does not pass. `invalid`: not evidence of this kind that approves. `mismatch`: it
 * is for another request, sentence or recording. `detail` is for a log and the tests.
 */
export type EvidenceRefusal = Readonly<{
  code: 'invalid' | 'signature_invalid' | 'expired' | 'mismatch';
  detail: string;
}>;

/**
 * What the text says before any signature check. A refusal of the verifier signs nothing, so the
 * Wallet shows its reason and the heard words as they are.
 */
export type EvidenceReading =
  | Readonly<{ kind: 'unreadable'; refusal: EvidenceRefusal }>
  | Readonly<{ kind: 'refused'; reason: string | null; heard: string | null }>
  | Readonly<{ kind: 'approves'; expiresAtMs: number }>;

/** What the checker compares evidence with. The caller builds it from the bytes that it signs. */
export type ExpectedEvidence = Readonly<{
  /** The request digest (`spokenRequestDigest`). */
  requestDigest: Uint8Array;
  /** The digest of the words on the card. Only Wallet core has a card. */
  spokenTextDigest?: Uint8Array;
  /** base64url SHA-256 of each recording of this flow. Only Wallet core has the recordings. */
  recordedAudio?: ReadonlySet<string>;
}>;

/** Evidence whose signature, kind, outcome and expiry passed. */
export type OpenedEvidence = Readonly<{
  /** base64url of the message that the verifier key signed. The co-signer records it once. */
  verdictId: string;
  /** The verifier asks for a fresh approval of the owner beside the voice. */
  stepUp: boolean;
  signedAtMs: number;
  expiresAtMs: number;
  /** Null when the evidence is for this request, these words and a recording of this flow. */
  bindingRefusal(expected: ExpectedEvidence): EvidenceRefusal | null;
}>;

export type EvidenceOpening =
  | Readonly<{ ok: true; evidence: OpenedEvidence }>
  | Readonly<{ ok: false; refusal: EvidenceRefusal }>;

/**
 * The checker of one evidence kind, in three steps: `read` the text, `open` it against the pinned
 * key, and then `bindingRefusal` of the opened evidence. The steps are apart because the
 * co-signer needs a fresh approval for a step-up before it decodes the bytes that it signs.
 */
export interface EvidenceChecker {
  readonly kind: SpokenEvidenceKind;
  read(verdictJson: string): EvidenceReading;
  /** `publicKey` is the pinned key of the verifier, in the form of this kind. */
  open(
    signed: SignedEvidence,
    pinned: Readonly<{ publicKey: string; nowMs: number }>,
  ): Promise<EvidenceOpening>;
}

const CHECKERS: Readonly<Record<SpokenEvidenceKind, EvidenceChecker>> = {
  voice_verdict_v2: VOICE_VERDICT_V2_CHECKER,
};

export function evidenceChecker(kind: SpokenEvidenceKind): EvidenceChecker {
  return CHECKERS[kind];
}
