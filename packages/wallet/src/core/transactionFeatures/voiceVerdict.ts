// The signed verdict of the Speak-to-Sign verifier (voice-verifier 0.4.0, verdict v2). Wallet
// core checks it before it signs, because an accepted verdict replaces the confirm click. The
// Seams co-signer checks it again. Both use `@shared/speakToSign/voiceVerdict`.

import { base64UrlEncode } from '@shared/utils/base64';
import { isPlainObject } from '@shared/utils/validation';
import {
  parseVoiceVerdict,
  verifyVoiceVerdictSignature,
  voiceVerdictIsLive,
  type SpeakToSignVerifier,
} from '@shared/speakToSign/voiceVerdict';
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
 * Checks a verdict against the request that core will sign: the kind, renderer and fields, the
 * outcome, the request, spoken-text and audio digests, the expiry, the pinned key of the
 * network and the signature. A refusal signs nothing, so it needs no signature check.
 */
export async function checkVoiceVerdict(input: {
  readonly output: VerifyOutput;
  /** The digests of the request that core built itself. */
  readonly expected: SpokenDigests;
  readonly verifier: SpeakToSignVerifier;
  /** base64url SHA-256 of each clip that core recorded in this flow. */
  readonly recordedAudio: ReadonlySet<string>;
  readonly nowMs: number;
}): Promise<VoiceVerdictCheck> {
  const verdict = parseVoiceVerdict(input.output.verdictJson);
  if (verdict.kind === 'invalid') return { kind: 'mismatch', detail: verdict.detail };
  if (verdict.kind === 'refuse') {
    const reason = VERIFIER_REFUSALS.find((candidate) => candidate === verdict.reason);
    return reason
      ? { kind: 'refused', reason, ...heardDetail(verdict.heard) }
      : { kind: 'mismatch', detail: 'unknown refusal' };
  }
  if (verdict.requestDigest !== base64UrlEncode(input.expected.request)) {
    return { kind: 'mismatch', detail: 'request_digest differs' };
  }
  if (verdict.spokenTextDigest !== base64UrlEncode(input.expected.spokenText)) {
    return { kind: 'mismatch', detail: 'spoken_text_digest differs' };
  }
  if (!input.recordedAudio.has(verdict.audioDigest)) {
    return { kind: 'mismatch', detail: 'audio_digest is not a recording of this flow' };
  }
  if (!voiceVerdictIsLive(verdict.expiresAtMs, input.nowMs)) {
    return { kind: 'mismatch', detail: 'verdict expired or not yet valid' };
  }
  const { signatureB64, publicKey } = input.output;
  if (!signatureB64 || publicKey !== input.verifier.publicKey) {
    return { kind: 'mismatch', detail: 'verdict key is not the pinned verifier key' };
  }
  if (!(await verifyVoiceVerdictSignature(publicKey, input.output.verdictJson, signatureB64))) {
    return { kind: 'mismatch', detail: 'verdict signature is invalid' };
  }
  return {
    kind: 'approved',
    approval: verdict.outcome === 'accept' ? 'voice' : 'voice_and_passkey',
    policyText: input.output.policyText,
    verdict: { verdictJson: input.output.verdictJson, signatureB64 },
  };
}

function heardDetail(heard: unknown): { detail?: string } {
  return typeof heard === 'string' && heard ? { detail: `heard: ${heard}` } : {};
}
