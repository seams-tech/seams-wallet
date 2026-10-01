import { base64UrlEncode, base64UrlDecode } from '../utils/base64';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { sha256Bytes } from '../utils/digests';
import { concat } from '../utils/digestEncoding';
import {
  buildSigningWorkerParticipantRecordV1,
  parseLaneHolderParticipantRecordV1,
  parseLaneParticipantBindingDigestB64u,
  parseSigningWorkerParticipantRecordV1,
  type LaneHolderParticipantRecordV1,
  type LaneParticipantBindingDigestB64u,
  type SigningWorkerParticipantId,
  type SigningWorkerParticipantRecordV1,
  type SigningWorkerRecipientIdentityV1,
} from './participants';

/** Domain tags are part of the wire contract and must never be shortened. */
const LANE_HOLDER_PARTICIPANT_BINDING_DOMAIN_V1 =
  'seams/rotatable-signing-lanes/lane-holder-participant/v1' as const;
const SIGNING_WORKER_PARTICIPANT_BINDING_DOMAIN_V1 =
  'seams/rotatable-signing-lanes/signing-worker-participant/v1' as const;
/** The lane digest binds the fixed holder-then-SigningWorker participant set. */
const LANE_PARTICIPANT_SET_BINDING_DOMAIN_V1 =
  'seams/rotatable-signing-lanes/lane-participant-set/v1' as const;

type SigningWorkerParticipantBindingInputV1 = {
  readonly participantId: SigningWorkerParticipantId;
  readonly recipient: SigningWorkerRecipientIdentityV1;
};

function placeholderParticipantDigest(): LaneParticipantBindingDigestB64u {
  const parsed = parseLaneParticipantBindingDigestB64u(base64UrlEncode(new Uint8Array(32)));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function u32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('canonical u32 must be an integer between 0 and 4294967295');
  }
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

/** LP32(UTF8(value)) from the canonical lane encoding. */
export function encodeLaneCanonicalTextV1(value: string): Uint8Array {
  if (typeof value !== 'string') throw new Error('canonical text must be a string');
  const bytes = new TextEncoder().encode(value);
  return concat([u32(bytes.length), bytes]);
}

/** LP32(BASE64URL_DECODE_CANONICAL_32(value)) from the canonical lane encoding. */
export function encodeLaneCanonicalDigestV1(value: DigestB64u): Uint8Array {
  const parsed = parseDigestB64u(value);
  return concat([u32(32), base64UrlDecode(parsed)]);
}

/** U64(value), encoded as unsigned big-endian bytes. */
export function encodeLaneCanonicalU64V1(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('canonical u64 must be a non-negative safe integer');
  }
  const output = new Uint8Array(8);
  const remaining = BigInt(value);
  for (let shift = 56; shift >= 0; shift -= 8) {
    output[7 - shift / 8] = Number((remaining >> BigInt(shift)) & 0xffn);
  }
  return output;
}

/** Nonempty array count encoding used by enrollment and receipt records. */
function encodeLaneCanonicalNonEmptyCountV1(count: number): Uint8Array {
  if (!Number.isInteger(count) || count < 1 || count > 0xffffffff) {
    throw new Error('canonical array count must be a nonempty u32');
  }
  return u32(count);
}

function laneHolderParticipantCanonicalBytesV1(input: LaneHolderParticipantRecordV1): Uint8Array {
  const record = parseLaneHolderParticipantRecordV1(input);
  return concat([
    encodeLaneCanonicalTextV1(LANE_HOLDER_PARTICIPANT_BINDING_DOMAIN_V1),
    encodeLaneCanonicalTextV1(record.participantId),
    encodeLaneCanonicalTextV1(record.custodyBindingId),
    encodeLaneCanonicalDigestV1(record.custodyBindingDigestB64u),
    encodeLaneCanonicalTextV1(record.hpkePublicKeyB64u),
    encodeLaneCanonicalDigestV1(record.hpkePublicKeyDigestB64u),
  ]);
}

function signingWorkerParticipantCanonicalBytesV1(
  input: SigningWorkerParticipantRecordV1,
): Uint8Array {
  const record = parseSigningWorkerParticipantRecordV1(input);
  return concat([
    encodeLaneCanonicalTextV1(SIGNING_WORKER_PARTICIPANT_BINDING_DOMAIN_V1),
    encodeLaneCanonicalTextV1(record.participantId),
    encodeLaneCanonicalTextV1(record.recipientKeyId),
    encodeLaneCanonicalTextV1(record.hpkePublicKeyB64u),
    encodeLaneCanonicalDigestV1(record.hpkePublicKeyDigestB64u),
  ]);
}

function encodeCanonicalBytes(value: Uint8Array): Uint8Array {
  return concat([u32(value.length), value]);
}

/**
 * Canonical bytes for the lane's complete participant set. The order is part
 * of the protocol: holder first, SigningWorker second. Individual participant
 * binding digests are included after their canonical identity bytes so a
 * verified record cannot be substituted while retaining the same identities.
 */
function laneParticipantSetCanonicalBytesV1(input: {
  readonly holderParticipant: LaneHolderParticipantRecordV1;
  readonly signingWorkerParticipant: SigningWorkerParticipantRecordV1;
}): Uint8Array {
  const holderParticipant = parseLaneHolderParticipantRecordV1(input.holderParticipant);
  const signingWorkerParticipant = parseSigningWorkerParticipantRecordV1(
    input.signingWorkerParticipant,
  );
  return concat([
    encodeLaneCanonicalTextV1(LANE_PARTICIPANT_SET_BINDING_DOMAIN_V1),
    encodeLaneCanonicalNonEmptyCountV1(2),
    encodeLaneCanonicalTextV1('holder'),
    encodeCanonicalBytes(laneHolderParticipantCanonicalBytesV1(holderParticipant)),
    encodeLaneCanonicalDigestV1(holderParticipant.participantBindingDigestB64u),
    encodeLaneCanonicalTextV1('signing_worker'),
    encodeCanonicalBytes(signingWorkerParticipantCanonicalBytesV1(signingWorkerParticipant)),
    encodeLaneCanonicalDigestV1(signingWorkerParticipant.participantBindingDigestB64u),
  ]);
}

async function digestCanonicalBytes(bytes: Uint8Array): Promise<LaneParticipantBindingDigestB64u> {
  const digest = base64UrlEncode(await sha256Bytes(bytes));
  const parsed = parseLaneParticipantBindingDigestB64u(digest);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

export async function computeLaneParticipantSetBindingDigestV1(input: {
  readonly holderParticipant: LaneHolderParticipantRecordV1;
  readonly signingWorkerParticipant: SigningWorkerParticipantRecordV1;
}): Promise<LaneParticipantBindingDigestB64u> {
  return await digestCanonicalBytes(laneParticipantSetCanonicalBytesV1(input));
}

export async function buildSigningWorkerParticipantRecordWithDigestV1(
  input: SigningWorkerParticipantBindingInputV1,
): Promise<SigningWorkerParticipantRecordV1> {
  const draft = buildSigningWorkerParticipantRecordV1({
    ...input,
    participantBindingDigestB64u: placeholderParticipantDigest(),
  });
  return buildSigningWorkerParticipantRecordV1({
    ...input,
    participantBindingDigestB64u: await digestCanonicalBytes(
      signingWorkerParticipantCanonicalBytesV1(draft),
    ),
  });
}
