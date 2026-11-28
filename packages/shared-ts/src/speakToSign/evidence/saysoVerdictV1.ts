// The SaySo verdict (`sayso_verdict_v1`): its checker, the verdict keys of each network and the
// transcript-only intent that the Gateway and Wallet core build. This is the one shared module
// that reads the SaySo format with its library. SaySo checks the speaker and the audio and signs
// the transcript (`heard`); the checker reads the transcript with `spoken-intent` and refuses
// unless it gives exactly the words of the request.

import {
  createIntent,
  parseVerdict,
  VERDICT_LIFE_MS,
  verdictMessage,
  verifyVerdict,
  type BuiltSaySoIntent,
  type SaySoVerdict,
  type VerdictRefusal,
} from '@seams/sayso-verdict';
import { base64UrlEncode } from '../../utils/base64';
import type {
  EvidenceChecker,
  EvidenceRefusal,
  ExpectedEvidence,
  OpenedEvidence,
  VerdictKeys,
} from '../evidence';
import { readHeardWords } from '../heardWords';
import { renderSpokenRequest } from '../spokenKinds';
import type { SpeakToSignNetwork, SpokenRequest } from '../spokenRequest';
import { isSpeakableAccount } from '../spokenWords';
import { sharedRefusal } from './verdictRefusals';

/**
 * The verdict key of the SaySo deployment of each network, 64 hex characters. A list, so that a
 * new key can come before the old one goes. The keys are pinned in code and never come from the
 * app: a key from the app would let the app supply its own verdicts. The operator holds the
 * secret key in its Cloudflare account, beside the co-signer; SaySo has no TEE.
 */
export const SAYSO_VERDICT_KEYS: VerdictKeys = {
  testnet: ['3d96c3d21be6b7864cadfe1d5e57366e45774d7513972710e2569aa33a0d6895'],
  mainnet: [],
};

/** The `action` of a SaySo intent for each request kind. */
const SAYSO_ACTIONS: Readonly<Record<SpokenRequest['kind'], string>> = {
  account_transfer: 'seams.near.transfer',
  community_note: 'seams.near.community_note',
  note_rating: 'seams.near.note_rating',
  merge_approval: 'seams.near.merge_approval',
  market_bet: 'seams.near.market_bet',
  transaction: 'seams.near.transaction',
  signed_message: 'seams.near.signed_message',
};

/** A verifier version of a real verdict key: `sayso/0.2.0`, never `sayso/0.2.0+mock`. */
const VERIFIER_PATTERN = /^sayso\/\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** The SaySo user of a NEAR account: `near:testnet:alice.testnet`. */
export function saysoUserId(network: SpeakToSignNetwork, accountId: string): string {
  return `near:${network}:${accountId}`;
}

export type SaySoIntentFields = Readonly<{
  network: SpeakToSignNetwork;
  /** The NEAR account of the Wallet Session. */
  owner: string;
  action: string;
  /** The request digest (`spokenRequestDigest`), 32 bytes or 64 lowercase hex characters. */
  payloadSha256: Uint8Array | string;
  /** The words that the owner says. */
  sentence: string;
}>;

/**
 * The transcript-only intent of a request: SaySo checks the speaker and the audio, and signs the
 * transcript. Throws a `RangeError` for a sentence above SaySo's limits (16 words, 160
 * characters) or a field of another form.
 */
export async function saysoIntent(fields: SaySoIntentFields): Promise<BuiltSaySoIntent> {
  return await createIntent({
    userId: saysoUserId(fields.network, fields.owner),
    action: fields.action,
    payloadSha256: fields.payloadSha256,
    sentence: fields.sentence,
    transcriptOnly: true,
  });
}

/** The intent fields of a request whose digest is `requestDigest`. */
export function saysoIntentFields(
  request: SpokenRequest,
  requestDigest: Uint8Array,
): SaySoIntentFields {
  return {
    network: request.network,
    owner: request.owner,
    action: SAYSO_ACTIONS[request.kind],
    payloadSha256: requestDigest,
    sentence: renderSpokenRequest(request).spokenText,
  };
}

/**
 * The checker of a SaySo verdict. `open` checks the pinned key, the signature, the fields, the
 * outcome, the expiry and the verifier version. SaySo has no step-up: voice approves what a
 * passkey step-up approves.
 */
export const SAYSO_VERDICT_V1_CHECKER: EvidenceChecker = {
  kind: 'sayso_verdict_v1',
  // No contract checks a SaySo verdict: a note, a rating and a bet sign as the other kinds do.
  reachesContracts: false,
  read(verdictJson) {
    const parsed = parseVerdict(verdictJson);
    if ('refusal' in parsed) return { kind: 'unreadable', refusal: refusalOf(parsed.refusal) };
    const { outcome, reason, heard, expires_at_ms: expiresAtMs } = parsed.verdict;
    if (outcome === 'refuse') return { kind: 'refused', reason, heard };
    return { kind: 'approves', expiresAtMs };
  },
  async open({ verdictJson, signatureB64 }, { publicKeys, nowMs }) {
    let refusal: EvidenceRefusal = { code: 'signature_invalid', detail: 'no pinned verdict key' };
    for (const publicKey of publicKeys) {
      const checked = await verifyVerdict({ verdictJson, signatureB64, publicKey, nowMs });
      if (!checked.ok) {
        refusal = refusalOf(checked.refusal);
        // Another pinned key may have signed it.
        if (refusal.code === 'signature_invalid') continue;
        return { ok: false, refusal };
      }
      const { verdict } = checked;
      if (!VERIFIER_PATTERN.test(verdict.verifier)) {
        return { ok: false, refusal: { code: 'invalid', detail: 'unknown verifier' } };
      }
      const evidence: OpenedEvidence = {
        verdictId: base64UrlEncode(await verdictMessage(verdictJson)),
        stepUp: false,
        // SaySo signs a verdict with `expires_at_ms` 120 s after its own clock.
        signedAtMs: verdict.expires_at_ms - VERDICT_LIFE_MS,
        expiresAtMs: verdict.expires_at_ms,
        bindingRefusal: (expected) => bindingRefusal(verdict, expected),
      };
      return { ok: true, evidence };
    }
    return { ok: false, refusal };
  },
};

/**
 * The verdict holds each digest as base64url text with no padding. The transcript is the last
 * check: it needs the `spoken-intent` module.
 */
async function bindingRefusal(
  verdict: SaySoVerdict,
  expected: ExpectedEvidence,
): Promise<EvidenceRefusal | null> {
  const { request } = expected;
  if (verdict.user_id !== saysoUserId(request.network, request.owner)) {
    return { code: 'mismatch', detail: 'user_id is not the owner' };
  }
  const fields = saysoIntentFields(request, expected.requestDigest);
  if (verdict.action !== fields.action) return { code: 'mismatch', detail: 'action differs' };
  let intent: BuiltSaySoIntent;
  try {
    intent = await saysoIntent(fields);
  } catch {
    return { code: 'mismatch', detail: 'the request is above the limits of SaySo' };
  }
  if (verdict.intent_digest !== base64UrlEncode(intent.intentDigest)) {
    return { code: 'mismatch', detail: 'intent_digest differs' };
  }
  if (
    expected.recordedAudio !== undefined &&
    (verdict.audio_digest === null || !expected.recordedAudio.has(verdict.audio_digest))
  ) {
    return { code: 'mismatch', detail: 'audio_digest is not a recording of this flow' };
  }
  if (verdict.heard === null) return { code: 'words', detail: 'no transcript' };
  const reading = await readHeardWords(verdict.heard, contactsOf(request));
  if (!reading.ok && reading.code === 'reader_unavailable') {
    return { code: 'invalid', detail: 'the transcript reader did not load' };
  }
  if (!reading.ok || reading.words !== fields.sentence) {
    return { code: 'words', detail: `heard: ${reading.ok ? reading.words : verdict.heard}` };
  }
  return null;
}

/**
 * The accounts that a heard recipient may match by sound. The co-signer has no contact list, so
 * both sides compare the heard recipient with the request's receiver only.
 */
function contactsOf(request: SpokenRequest): readonly string[] {
  if (request.kind !== 'account_transfer' && request.kind !== 'transaction') return [];
  return isSpeakableAccount(request.receiver) ? [request.receiver] : [];
}

function refusalOf(refusal: VerdictRefusal): EvidenceRefusal {
  const shared = sharedRefusal(refusal.code);
  if (shared) return shared;
  switch (refusal.code) {
    case 'user_mismatch':
    case 'action_mismatch':
    case 'intent_mismatch':
    case 'spoken_text_mismatch':
    case 'audio_mismatch':
      return { code: 'mismatch', detail: refusal.code };
    // The callers read a refusal before they open the verdict, and pass no replay guard.
    default:
      return { code: 'invalid', detail: `unexpected ${refusal.code}` };
  }
}
