// The signed verdict of the Speak-to-Sign verifier (voice-verifier 0.3.0, verdict v2). Wallet
// core checks it before it signs, because an accepted verdict replaces the confirm click.

import { base58Decode } from '@shared/utils/base58';
import { base64Decode, base64UrlEncode } from '@shared/utils/base64';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { isPlainObject } from '@shared/utils/validation';
import type { SpeakToSignNetwork } from './plugins';
import {
  concat,
  RENDERER_VERSION,
  renderTransfer,
  requestDigest,
  sha256,
  spokenTextDigest,
  utf8,
  type SpokenTransferRequest,
} from './spokenTransfer';

/**
 * The verifier of each network: its OutLayer project and its project-bound verdict key. The key
 * stays the same across verifier versions. It is pinned here and never comes from the app, which
 * supplies the Seams server URL: a key from the app would let the app supply its own verdicts.
 */
type SpeakToSignVerifier = Readonly<{ project: string; publicKey: string }>;

export const SPEAK_TO_SIGN_VERIFIERS: Readonly<
  Record<SpeakToSignNetwork, SpeakToSignVerifier | null>
> = {
  testnet: {
    project: 'seams-v1.testnet/voice-verifier',
    publicKey: 'ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U',
  },
  mainnet: null,
};

const VERIFY_OUTPUT_KIND = 'seams_voice_verify_output_v2';
const VERDICT_KIND = 'seams_voice_signed_verdict_v2';
const VERDICT_DOMAIN = 'seams:outlayer:voice-verdict:v2';
const VERDICT_FIELDS = [
  'kind',
  'renderer',
  'verifier',
  'request_digest',
  'spoken_text_digest',
  'audio_digest',
  'outcome',
  'reason',
  'policy_rule',
  'expires_at_ms',
  'speaker_score_milli',
  'word_margin_milli',
  'heard',
] as const;
/** The verifier gives a verdict 120 s. A later expiry means a worker clock that runs ahead. */
const MAX_VERDICT_LIFE_MS = 150_000;

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

export type VoiceVerdictCheck =
  | Readonly<{ kind: 'approved'; approval: VoiceApproval; policyText: string | null }>
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
 * Checks a verdict against the transfer that core will sign: the kind, renderer and fields, the
 * outcome, the request, spoken-text and audio digests, the expiry, the pinned key of the
 * network and the signature. A refusal pays nothing, so it needs no signature check.
 */
export async function checkVoiceVerdict(input: {
  readonly output: VerifyOutput;
  readonly request: SpokenTransferRequest;
  readonly verifier: SpeakToSignVerifier;
  /** base64url SHA-256 of each clip that core recorded in this flow. */
  readonly recordedAudio: ReadonlySet<string>;
  readonly nowMs: number;
}): Promise<VoiceVerdictCheck> {
  let verdict: unknown;
  try {
    verdict = JSON.parse(input.output.verdictJson);
  } catch {
    return { kind: 'mismatch', detail: 'verdict is not JSON' };
  }
  if (!hasExactKeys(verdict, VERDICT_FIELDS) || verdict.kind !== VERDICT_KIND) {
    return { kind: 'mismatch', detail: 'unknown verdict kind' };
  }
  if (verdict.renderer !== RENDERER_VERSION) {
    return { kind: 'mismatch', detail: 'unknown renderer' };
  }
  if (verdict.outcome === 'refuse') {
    const reason = VERIFIER_REFUSALS.find((candidate) => candidate === verdict.reason);
    return reason
      ? { kind: 'refused', reason, ...heardDetail(verdict.heard) }
      : { kind: 'mismatch', detail: 'unknown refusal' };
  }
  const approval = approvalOf(verdict.outcome, verdict.policy_rule, verdict.reason);
  if (!approval) return { kind: 'mismatch', detail: 'unknown outcome' };

  const expected = {
    request_digest: base64UrlEncode(await requestDigest(input.request)),
    spoken_text_digest: base64UrlEncode(await spokenTextDigest(renderTransfer(input.request))),
  };
  for (const [field, digest] of Object.entries(expected)) {
    if (verdict[field as keyof typeof expected] !== digest) {
      return { kind: 'mismatch', detail: `${field} differs` };
    }
  }
  if (typeof verdict.audio_digest !== 'string' || !input.recordedAudio.has(verdict.audio_digest)) {
    return { kind: 'mismatch', detail: 'audio_digest is not a recording of this flow' };
  }
  const expiresAtMs = verdict.expires_at_ms;
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    (expiresAtMs as number) <= input.nowMs ||
    (expiresAtMs as number) > input.nowMs + MAX_VERDICT_LIFE_MS
  ) {
    return { kind: 'mismatch', detail: 'verdict expired or not yet valid' };
  }

  const { signatureB64, publicKey } = input.output;
  if (!signatureB64 || publicKey !== input.verifier.publicKey) {
    return { kind: 'mismatch', detail: 'verdict key is not the pinned verifier key' };
  }
  const message = await sha256(concat([utf8(VERDICT_DOMAIN), utf8(input.output.verdictJson)]));
  if (!(await verifyEd25519(input.verifier.publicKey, signatureB64, message))) {
    return { kind: 'mismatch', detail: 'verdict signature is invalid' };
  }
  return { kind: 'approved', approval, policyText: input.output.policyText };
}

function approvalOf(outcome: unknown, policyRule: unknown, reason: unknown): VoiceApproval | null {
  if (reason !== null) return null;
  if (outcome === 'accept' && policyRule === null) return 'voice';
  if (outcome === 'step_up' && typeof policyRule === 'string' && policyRule) {
    return 'voice_and_passkey';
  }
  return null;
}

function heardDetail(heard: unknown): { detail?: string } {
  return typeof heard === 'string' && heard ? { detail: `heard: ${heard}` } : {};
}

async function verifyEd25519(
  publicKey: string,
  signatureB64: string,
  message: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  let keyBytes: Uint8Array;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = base58Decode(publicKey.slice('ed25519:'.length));
    signature = base64Decode(signatureB64);
  } catch {
    return false;
  }
  if (keyBytes.length !== 32 || signature.length !== 64) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(keyBytes),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
}
