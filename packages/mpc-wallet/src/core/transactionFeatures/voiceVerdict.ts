// The signed verdict of the Speak-to-Sign verifier (verdict v2). Wallet core checks it before it
// signs, because an accepted verdict replaces the confirm click. The Seams co-signer checks it
// again. Both check it with `checkVerdict` of `@seams/voice-verdict`.

import { checkVerdict, parseVerdict, type VerdictRefusal } from '@seams/voice-verdict';
import { isPlainObject } from '@shared/utils/validation';
import type { SpeakToSignVerifier } from '@shared/speakToSign/voiceVerdict';
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
 * Checks a verdict against the request that core will sign: the key and signature, the shape,
 * kind and renderer, the outcome, the expiry, the request and spoken-text digests (all in
 * `checkVerdict`), and then that the audio digest is a clip of this flow. A refusal signs
 * nothing, so it needs no signature check: core only shows its reason and what was heard.
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
  const parsed = parseVerdict(input.output.verdictJson);
  if ('refusal' in parsed) return { kind: 'mismatch', detail: refusalDetail(parsed.refusal) };
  if (parsed.verdict.outcome === 'refuse') {
    const { reason: said, heard } = parsed.verdict;
    const reason = VERIFIER_REFUSALS.find((candidate) => candidate === said);
    return reason
      ? { kind: 'refused', reason, ...heardDetail(heard) }
      : { kind: 'mismatch', detail: 'unknown refusal' };
  }
  const { signatureB64, publicKey } = input.output;
  if (!signatureB64 || publicKey !== input.verifier.publicKey) {
    return { kind: 'mismatch', detail: 'verdict key is not the pinned verifier key' };
  }
  const checked = await checkVerdict({
    verdictJson: input.output.verdictJson,
    signatureB64,
    publicKey: input.verifier.publicKey,
    requestDigest: input.expected.request,
    spokenTextDigest: input.expected.spokenText,
    nowMs: input.nowMs,
    // A step-up verdict passes here; core then asks for the fresh approval that it names.
    acceptStepUp: true,
  });
  if (!checked.ok) return { kind: 'mismatch', detail: refusalDetail(checked.refusal) };
  const { verdict } = checked;
  if (verdict.audio_digest === null || !input.recordedAudio.has(verdict.audio_digest)) {
    return { kind: 'mismatch', detail: 'audio_digest is not a recording of this flow' };
  }
  return {
    kind: 'approved',
    approval: verdict.outcome === 'accept' ? 'voice' : 'voice_and_passkey',
    policyText: input.output.policyText,
    verdict: { verdictJson: input.output.verdictJson, signatureB64 },
  };
}

/** The detail of a mismatch, for the log and the tests. */
function refusalDetail(refusal: VerdictRefusal): string {
  switch (refusal.code) {
    case 'bad_public_key':
    case 'bad_signature_encoding':
    case 'bad_signature':
      return 'verdict signature is invalid';
    case 'malformed':
      return 'verdict fields are invalid';
    case 'wrong_kind':
      return 'unknown verdict kind';
    case 'wrong_renderer':
      return 'unknown renderer';
    case 'expired':
    case 'not_yet_valid':
      return 'verdict expired or not yet valid';
    case 'request_mismatch':
      return 'request_digest differs';
    case 'spoken_text_mismatch':
      return 'spoken_text_digest differs';
    case 'audio_mismatch':
      return 'audio_digest is not a recording of this flow';
    // A refusal is read before the check, and core accepts a step-up.
    case 'refused':
    case 'step_up':
      return `unexpected ${refusal.code}`;
  }
}

function heardDetail(heard: unknown): { detail?: string } {
  return typeof heard === 'string' && heard ? { detail: `heard: ${heard}` } : {};
}
