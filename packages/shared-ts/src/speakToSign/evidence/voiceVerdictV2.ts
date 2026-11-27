// The voice verdict v2 (`seams_voice_signed_verdict_v2`) of the OutLayer verifier: its checker, and
// the verdict key and audio key of each network. This is the one module that reads the v2 format
// with its library. Wallet core and the Seams co-signer reach it through `../evidence`, so that
// another evidence kind is another module beside this one.

import {
  checkVerdict,
  parseVerdict,
  VERDICT_LIFE_MS,
  verdictMessage,
  type VerdictRefusal,
  type VoiceVerdict,
} from '@seams/voice-verdict';
import { base64UrlEncode } from '../../utils/base64';
import type {
  EvidenceChecker,
  EvidenceRefusal,
  ExpectedEvidence,
  OpenedEvidence,
} from '../evidence';
import type { SpeakToSignNetwork } from '../spokenRequest';

/**
 * The verifier of each network: its OutLayer project, its project-bound verdict key and its
 * audio key. Both keys stay the same across verifier versions. They are pinned in code and never
 * come from the app, which supplies the Seams server URL: a verdict key from the app would let
 * the app supply its own verdicts, and an audio key from the app would let the app read the
 * recordings.
 *
 * `audioKey` is the X25519 public key (standard base64) that Wallet core seals each recording
 * to. The verifier's `audio_key` operation returns it with a signature of the verdict key.
 */
export type SpeakToSignVerifier = Readonly<{
  project: string;
  publicKey: string;
  audioKey: string;
}>;

export const SPEAK_TO_SIGN_VERIFIERS: Readonly<
  Record<SpeakToSignNetwork, SpeakToSignVerifier | null>
> = {
  testnet: {
    project: 'seams-v1.testnet/voice-verifier',
    publicKey: 'ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U',
    audioKey: 'swH9imlBy9lASO9868ouz/FUumuZIK9g/3R7QiFl7ig=',
  },
  mainnet: null,
};

/**
 * The checker of a v2 verdict. `open` checks the key, the signature, the shape, the kind, the
 * renderer, the outcome and the expiry, and lets a `step_up` verdict pass as a step-up.
 */
export const VOICE_VERDICT_V2_CHECKER: EvidenceChecker = {
  kind: 'voice_verdict_v2',
  read(verdictJson) {
    const parsed = parseVerdict(verdictJson);
    if ('refusal' in parsed) return { kind: 'unreadable', refusal: refusalOf(parsed.refusal) };
    const { outcome, reason, heard, expires_at_ms: expiresAtMs } = parsed.verdict;
    if (outcome === 'refuse') return { kind: 'refused', reason, heard };
    return { kind: 'approves', expiresAtMs };
  },
  async open({ verdictJson, signatureB64 }, { publicKey, nowMs }) {
    const checked = await checkVerdict({
      verdictJson,
      signatureB64,
      publicKey,
      nowMs,
      acceptStepUp: true,
    });
    if (!checked.ok) return { ok: false, refusal: refusalOf(checked.refusal) };
    const { verdict } = checked;
    const evidence: OpenedEvidence = {
      verdictId: base64UrlEncode(await verdictMessage(verdictJson)),
      stepUp: verdict.outcome === 'step_up',
      // The verifier signs a verdict with `expires_at_ms` 120 s after its own clock.
      signedAtMs: verdict.expires_at_ms - VERDICT_LIFE_MS,
      expiresAtMs: verdict.expires_at_ms,
      bindingRefusal: (expected) => bindingRefusal(verdict, expected),
    };
    return { ok: true, evidence };
  },
};

/** The verdict holds each digest as base64url text with no padding. */
function bindingRefusal(verdict: VoiceVerdict, expected: ExpectedEvidence): EvidenceRefusal | null {
  if (verdict.request_digest !== base64UrlEncode(expected.requestDigest)) {
    return { code: 'mismatch', detail: 'request_digest differs' };
  }
  if (
    expected.spokenTextDigest !== undefined &&
    verdict.spoken_text_digest !== base64UrlEncode(expected.spokenTextDigest)
  ) {
    return { code: 'mismatch', detail: 'spoken_text_digest differs' };
  }
  if (
    expected.recordedAudio !== undefined &&
    (verdict.audio_digest === null || !expected.recordedAudio.has(verdict.audio_digest))
  ) {
    return { code: 'mismatch', detail: 'audio_digest is not a recording of this flow' };
  }
  return null;
}

function refusalOf(refusal: VerdictRefusal): EvidenceRefusal {
  switch (refusal.code) {
    case 'bad_public_key':
    case 'bad_signature_encoding':
    case 'bad_signature':
      return { code: 'signature_invalid', detail: 'verdict signature is invalid' };
    case 'malformed':
      return { code: 'invalid', detail: 'verdict fields are invalid' };
    case 'wrong_kind':
      return { code: 'invalid', detail: 'unknown verdict kind' };
    case 'wrong_renderer':
      return { code: 'invalid', detail: 'unknown renderer' };
    case 'expired':
    case 'not_yet_valid':
      return { code: 'expired', detail: 'verdict expired or not yet valid' };
    case 'request_mismatch':
      return { code: 'mismatch', detail: 'request_digest differs' };
    case 'spoken_text_mismatch':
      return { code: 'mismatch', detail: 'spoken_text_digest differs' };
    case 'audio_mismatch':
      return { code: 'mismatch', detail: 'audio_digest is not a recording of this flow' };
    // The callers read a refusal before they open the verdict, and `open` accepts a step-up.
    case 'refused':
    case 'step_up':
      return { code: 'invalid', detail: `unexpected ${refusal.code}` };
  }
}
