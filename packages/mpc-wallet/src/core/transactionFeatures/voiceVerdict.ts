// The signed verdict of the Speak-to-Sign verifier. Wallet core checks it before it signs, because
// an accepted verdict replaces the confirm click. The Seams co-signer checks it again. Both check
// it with the checker of its evidence kind.

import {
  evidenceChecker,
  type SpeakToSignVerifier,
  type SpokenEvidenceKind,
} from '@shared/speakToSign/evidence';
import { isPlainObject } from '@shared/utils/validation';
import type { SpokenDigests } from './spokenTransfer';

const VERIFY_OUTPUT_KIND = 'seams_voice_verify_output_v2';

const VERIFIER_REFUSALS = [
  'quality',
  'speaker',
  'words',
  'audio_reused',
  'audio_invalid',
  'template_missing',
  'unsupported',
  'speaker_unavailable',
  'storage',
  'transcriber_unavailable',
  // Verifier 0.14.0 and later: the check of NEAR AI's gateway TEE failed, or Whisper's reply did
  // not open with the checked key. No audio went out after a failed check.
  'transcriber_not_attested',
  // A community note (verifier 0.13.0 and later): JEV checks that the summary fits the note.
  'summary_mismatch',
  'summary_check_unavailable',
] as const;

export type VerifierRefusal = (typeof VERIFIER_REFUSALS)[number];

/** `voice`: the verdict alone approves. `voice_and_passkey`: a policy rule asks for a passkey. */
export type VoiceApproval = 'voice' | 'voice_and_passkey';

/** The verifier output that the Seams verify route passes through unchanged. */
export type VerifyOutput = Readonly<{
  verdictJson: string;
  signatureB64: string | null;
  publicKey: string | null;
  /** The sentence of the policy rule that asked for a passkey. Not signed. */
  policyText: string | null;
  ms: Readonly<Record<string, unknown>>;
}>;

/**
 * A checked verdict that core sends with the signing request, so that the Seams co-signer checks
 * it again before it adds its part of the signature.
 */
export type SignedVoiceVerdict = Readonly<{
  verdictJson: string;
  signatureB64: string;
  /**
   * The spoken summary of a general transaction. The transaction does not hold it, so the
   * co-signer needs it to build the request digest again. The digest binds it.
   */
  summary?: string;
}>;

/** How core signs one voice-approved transaction. */
export type VoiceApprovedSigning = Readonly<{
  approval: VoiceApproval;
  /** The sentence of the rule that asked for a fresh approval, for the confirm. */
  policyText: string | null;
  verdict: SignedVoiceVerdict;
}>;

export type VoiceVerdictCheck =
  | (Readonly<{ kind: 'approved' }> & VoiceApprovedSigning)
  | Readonly<{ kind: 'refused'; reason: VerifierRefusal; detail?: string }>
  | Readonly<{ kind: 'mismatch'; detail: string }>;

export function parseVerifyOutput(value: unknown): VerifyOutput | null {
  if (
    !isPlainObject(value) ||
    value.kind !== VERIFY_OUTPUT_KIND ||
    typeof value.verdict_json !== 'string'
  ) {
    return null;
  }
  return {
    verdictJson: value.verdict_json,
    signatureB64: typeof value.signature_b64 === 'string' ? value.signature_b64 : null,
    publicKey: typeof value.public_key === 'string' ? value.public_key : null,
    policyText: typeof value.policy_text === 'string' ? value.policy_text.slice(0, 200) : null,
    ms: isPlainObject(value.ms) ? value.ms : {},
  };
}

/**
 * Checks a verdict against the request that core will sign, in the order of its checker: the
 * text, the key and signature, the kind, the outcome, the expiry, the request and spoken-text
 * digests, and then that the audio digest is a clip of this flow. A refusal signs nothing, so it
 * needs no signature check: core only shows its reason and what was heard.
 */
export async function checkVoiceVerdict(input: {
  readonly kind: SpokenEvidenceKind;
  readonly output: VerifyOutput;
  /** The digests of the request that core built itself. */
  readonly expected: SpokenDigests;
  readonly verifier: SpeakToSignVerifier;
  /** base64url SHA-256 of each clip that core recorded in this flow. */
  readonly recordedAudio: ReadonlySet<string>;
  readonly nowMs: number;
}): Promise<VoiceVerdictCheck> {
  const checker = evidenceChecker(input.kind);
  const { verdictJson, signatureB64, publicKey } = input.output;
  const reading = checker.read(verdictJson);
  if (reading.kind === 'unreadable') return { kind: 'mismatch', detail: reading.refusal.detail };
  if (reading.kind === 'refused') {
    const reason = VERIFIER_REFUSALS.find((candidate) => candidate === reading.reason);
    return reason
      ? { kind: 'refused', reason, ...heardDetail(reading.heard) }
      : { kind: 'mismatch', detail: 'unknown refusal' };
  }
  if (!signatureB64 || publicKey !== input.verifier.publicKey) {
    return { kind: 'mismatch', detail: 'verdict key is not the pinned verifier key' };
  }
  const opened = await checker.open(
    { verdictJson, signatureB64 },
    { publicKey: input.verifier.publicKey, nowMs: input.nowMs },
  );
  if (!opened.ok) return { kind: 'mismatch', detail: opened.refusal.detail };
  const unbound = opened.evidence.bindingRefusal({
    requestDigest: input.expected.request,
    spokenTextDigest: input.expected.spokenText,
    recordedAudio: input.recordedAudio,
  });
  if (unbound) return { kind: 'mismatch', detail: unbound.detail };
  return {
    kind: 'approved',
    // A step-up verdict passes the check; core then asks for the fresh approval that it names.
    approval: opened.evidence.stepUp ? 'voice_and_passkey' : 'voice',
    policyText: input.output.policyText,
    verdict: { verdictJson, signatureB64 },
  };
}

/** True while a checked verdict is not expired. Core reads it again after a step-up answer. */
export function verdictStillValid(
  kind: SpokenEvidenceKind,
  verdictJson: string,
  nowMs: number,
): boolean {
  const reading = evidenceChecker(kind).read(verdictJson);
  return reading.kind === 'approves' && reading.expiresAtMs > nowMs;
}

function heardDetail(heard: string | null): { detail?: string } {
  return heard ? { detail: `heard: ${heard}` } : {};
}
