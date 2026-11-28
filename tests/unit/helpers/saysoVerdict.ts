// SaySo verdicts signed by a test key, as the SaySo Worker writes them (`sayso_verdict_v1`, the
// 12 fields in the Worker's order), and the verify output that the Seams route passes through.

import { verdictMessage } from '@seams/sayso-verdict';
import { saysoIntent, saysoIntentFields } from '@shared/speakToSign/evidence/saysoVerdictV1';
import { startHeardWords } from '@shared/speakToSign/heardWords';
import type { SpokenRequest } from '@shared/speakToSign/spokenRequest';
import { SERVER_HEARD_WORDS_START } from '../../../packages/mpc-wallet-server/src/router/domains/speakToSign/spokenIntentWasm';

/** The test runs in Node, where the server's loader reads the module from the file. */
export const NODE_HEARD_WORDS_START = SERVER_HEARD_WORDS_START;

export function startNodeHeardWords(): void {
  startHeardWords(NODE_HEARD_WORDS_START);
}

export type SaySoKey = Readonly<{
  /** 64 lowercase hex characters, as the pins hold it. */
  publicKeyHex: string;
  sign(verdictJson: string): Promise<string>;
}>;

export async function saysoKey(): Promise<SaySoKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKeyHex: Buffer.from(raw).toString('hex'),
    async sign(verdictJson) {
      const message = await verdictMessage(verdictJson);
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message);
      return Buffer.from(signature).toString('base64');
    },
  };
}

export type SignedSaySoVerdict = Readonly<{ verdict_json: string; signature_b64: string }>;

/**
 * An accepted transcript-only verdict for `request`: SaySo heard `heard` in a recording whose
 * SHA-256 is `audioDigest`.
 */
export async function saysoVerdict(
  key: SaySoKey,
  request: SpokenRequest,
  requestDigest: Uint8Array,
  options: Readonly<{
    heard: string | null;
    audioDigest?: Uint8Array;
    expiresAtMs: number;
    overrides?: Readonly<Record<string, unknown>>;
  }>,
): Promise<SignedSaySoVerdict> {
  const intent = await saysoIntent(saysoIntentFields(request, requestDigest));
  const json = JSON.stringify({
    kind: 'sayso_verdict_v1',
    verifier: 'sayso/0.2.0',
    user_id: intent.intent.user_id,
    action: intent.intent.action,
    intent_digest: b64u(intent.intentDigest),
    spoken_text_digest: b64u(intent.spokenTextDigest),
    audio_digest: b64u(options.audioDigest ?? new Uint8Array(32).fill(7)),
    outcome: 'accept',
    reason: null,
    expires_at_ms: options.expiresAtMs,
    speaker_score_milli: 812,
    heard: options.heard,
    ...options.overrides,
  });
  return { verdict_json: json, signature_b64: await key.sign(json) };
}

/** The verify output of the SaySo Worker for a signed verdict. */
export function saysoOutput(key: SaySoKey, signed: SignedSaySoVerdict): Record<string, unknown> {
  return {
    kind: 'sayso_verify_output_v1',
    verdict_json: signed.verdict_json,
    signature_b64: signed.signature_b64,
    public_key_hex: key.publicKeyHex,
    ms: { critical_parallel: 1_400, total: 1_650 },
    detail: null,
  };
}

export function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
