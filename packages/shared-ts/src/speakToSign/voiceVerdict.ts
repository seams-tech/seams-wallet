// The signed verdict of the Speak-to-Sign verifier (verdict v2) and the verifier key of each
// network. Wallet core checks a verdict before it signs with no confirm, and the Seams co-signer
// checks it again before it adds its part of the signature. Both use these definitions.

import { base58Decode } from '../utils/base58';
import { base64Decode } from '../utils/base64';
import { hasExactKeys } from '../utils/exactKeys';
import { concat, sha256, utf8, type SpeakToSignNetwork } from './spokenRequest';

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

const RENDERER_VERSION = 'spoken-intent/1';
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

/** `accept`: the voice alone approves. `step_up`: a policy rule asks for a fresh approval too. */
type VoiceVerdictOutcome = 'accept' | 'step_up';

type ParsedVoiceVerdict =
  | Readonly<{ kind: 'invalid'; detail: string }>
  /** The verifier refused. A refusal signs nothing, so it needs no signature check. */
  | Readonly<{ kind: 'refuse'; reason: unknown; heard: unknown }>
  | Readonly<{
      kind: 'approve';
      outcome: VoiceVerdictOutcome;
      /** The rule that asked for the fresh approval of a `step_up` verdict. */
      policyRule: string | null;
      /** base64url SHA-256 values, as the verifier writes them. */
      requestDigest: string;
      spokenTextDigest: string;
      audioDigest: string;
      expiresAtMs: number;
    }>;

/** Reads the 13 fields of a verdict v2 in the verifier's JSON. It does not check the signature. */
export function parseVoiceVerdict(verdictJson: string): ParsedVoiceVerdict {
  let verdict: unknown;
  try {
    verdict = JSON.parse(verdictJson);
  } catch {
    return { kind: 'invalid', detail: 'verdict is not JSON' };
  }
  if (!hasExactKeys(verdict, VERDICT_FIELDS) || verdict.kind !== VERDICT_KIND) {
    return { kind: 'invalid', detail: 'unknown verdict kind' };
  }
  if (verdict.renderer !== RENDERER_VERSION) return { kind: 'invalid', detail: 'unknown renderer' };
  if (verdict.outcome === 'refuse') {
    return { kind: 'refuse', reason: verdict.reason, heard: verdict.heard };
  }
  const outcome = outcomeOf(verdict.outcome, verdict.policy_rule, verdict.reason);
  if (!outcome) return { kind: 'invalid', detail: 'unknown outcome' };
  const { request_digest, spoken_text_digest, audio_digest, expires_at_ms } = verdict;
  if (
    typeof request_digest !== 'string' ||
    typeof spoken_text_digest !== 'string' ||
    typeof audio_digest !== 'string' ||
    !Number.isSafeInteger(expires_at_ms)
  ) {
    return { kind: 'invalid', detail: 'verdict fields are invalid' };
  }
  return {
    kind: 'approve',
    outcome,
    policyRule: outcome === 'step_up' ? (verdict.policy_rule as string) : null,
    requestDigest: request_digest,
    spokenTextDigest: spoken_text_digest,
    audioDigest: audio_digest,
    expiresAtMs: expires_at_ms as number,
  };
}

function outcomeOf(
  outcome: unknown,
  policyRule: unknown,
  reason: unknown,
): VoiceVerdictOutcome | null {
  if (reason !== null) return null;
  if (outcome === 'accept' && policyRule === null) return 'accept';
  if (outcome === 'step_up' && typeof policyRule === 'string' && policyRule) return 'step_up';
  return null;
}

/** True while the verdict is valid: before its expiry, and not further ahead than one life. */
export function voiceVerdictIsLive(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs > nowMs && expiresAtMs <= nowMs + MAX_VERDICT_LIFE_MS;
}

/** `sha256(VERDICT_DOMAIN || verdict_json)`: the message that the verifier key signs. */
export async function voiceVerdictMessage(verdictJson: string): Promise<Uint8Array<ArrayBuffer>> {
  return await sha256(concat([utf8(VERDICT_DOMAIN), utf8(verdictJson)]));
}

/** Checks the ed25519 signature (base64) of the verdict against `ed25519:<base58>` `publicKey`. */
export async function verifyVoiceVerdictSignature(
  publicKey: string,
  verdictJson: string,
  signatureB64: string,
): Promise<boolean> {
  let keyBytes: Uint8Array;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    if (!publicKey.startsWith('ed25519:')) return false;
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
  const message = await voiceVerdictMessage(verdictJson);
  return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
}

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
  'over_payment_limit',
  'over_daily_limit',
  /** A `step_up` verdict without a fresh approval of the same operation. */
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
