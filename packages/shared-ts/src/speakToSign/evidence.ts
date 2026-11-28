// The check of spoken evidence: a signed statement of a verifier that approves one request.
// Wallet core checks it before it signs with no confirm, and the Seams co-signer checks it again
// before it adds its part of the signature. Both use the checker of the evidence kind from this
// file, and only this file and a backend module read a kind's own module in `evidence/`.

import type { SpeakToSignBackendId } from './backend';
import { SAYSO_VERDICT_KEYS, SAYSO_VERDICT_V1_CHECKER } from './evidence/saysoVerdictV1';
import { VOICE_VERDICT_V2_CHECKER, VOICE_VERDICT_V2_KEYS } from './evidence/voiceVerdictV2';
import type { SpeakToSignNetwork, SpokenRequest } from './spokenRequest';

/** The kinds of evidence. Each verifier backend signs one kind. */
export type SpokenEvidenceKind = 'sayso_verdict_v1' | 'voice_verdict_v2';

/** The evidence kind of each backend. A lane accepts only the kind of its backend. */
export const BACKEND_EVIDENCE_KIND: Readonly<Record<SpeakToSignBackendId, SpokenEvidenceKind>> = {
  sayso: 'sayso_verdict_v1',
  outlayer: 'voice_verdict_v2',
};

/**
 * The pinned verdict keys of one evidence kind on each network, in the form of the kind. A list,
 * so that a key rotation needs no forced release. An empty list: the network has no verifier.
 */
export type VerdictKeys = Readonly<Record<SpeakToSignNetwork, readonly string[]>>;

/** The verdict keys of each evidence kind. They are pinned in code and never come from the app. */
export const VERDICT_KEYS: Readonly<Record<SpokenEvidenceKind, VerdictKeys>> = {
  sayso_verdict_v1: SAYSO_VERDICT_KEYS,
  voice_verdict_v2: VOICE_VERDICT_V2_KEYS,
};

/** The signed text, exactly as the verifier gave it, and the signature over it. */
export type SignedEvidence = Readonly<{ verdictJson: string; signatureB64: string }>;

/**
 * Why evidence does not pass. `invalid`: not evidence of this kind that approves. `mismatch`: it
 * is for another request, sentence or recording. `words`: the verifier heard other words than
 * the request; the owner can say it again. `detail` is for a log, the card and the tests.
 */
export type EvidenceRefusal = Readonly<{
  code: 'invalid' | 'signature_invalid' | 'expired' | 'mismatch' | 'words';
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
  /** The request of the bytes to sign. Its owner is the NEAR account of the Wallet Session. */
  request: SpokenRequest;
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
  bindingRefusal(expected: ExpectedEvidence): Promise<EvidenceRefusal | null>;
}>;

export type EvidenceOpening =
  | Readonly<{ ok: true; evidence: OpenedEvidence }>
  | Readonly<{ ok: false; refusal: EvidenceRefusal }>;

/**
 * The checker of one evidence kind, in three steps: `read` the text, `open` it against the pinned
 * keys, and then `bindingRefusal` of the opened evidence. The steps are apart because the
 * co-signer needs a fresh approval for a step-up before it decodes the bytes that it signs.
 */
export interface EvidenceChecker {
  readonly kind: SpokenEvidenceKind;
  /**
   * A contract checks this kind: a note, a rating and a bet carry the verdict in their call, and
   * the co-signer checks that the call carries this verdict. Otherwise the call carries none.
   */
  readonly reachesContracts: boolean;
  read(verdictJson: string): EvidenceReading;
  /** `publicKeys` are the pinned keys of the network (`VERDICT_KEYS`). */
  open(
    signed: SignedEvidence,
    pinned: Readonly<{ publicKeys: readonly string[]; nowMs: number }>,
  ): Promise<EvidenceOpening>;
}

const CHECKERS: Readonly<Record<SpokenEvidenceKind, EvidenceChecker>> = {
  sayso_verdict_v1: SAYSO_VERDICT_V1_CHECKER,
  voice_verdict_v2: VOICE_VERDICT_V2_CHECKER,
};

export function evidenceChecker(kind: SpokenEvidenceKind): EvidenceChecker {
  return CHECKERS[kind];
}
