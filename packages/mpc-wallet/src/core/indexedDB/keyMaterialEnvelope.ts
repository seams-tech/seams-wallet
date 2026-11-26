import type {
  KeyMaterialPayloadEnvelope,
  KeyMaterialPayloadEnvelopeAAD,
} from './keyMaterial.types';
import { toTrimmedString, asRecord } from '@shared/utils/validation';

export const KEY_PAYLOAD_ENC_VERSION = 1;

export function sanitizePayload(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return { ...record };
}

export function buildEnvelopeAAD(args: {
  profileId: string;
  signerSlot: number;
  chainIdKey: string;
  accountAddress: string;
  keyKind: string;
  schemaVersion: number;
  signerId: string;
}): KeyMaterialPayloadEnvelopeAAD {
  const signerId = toTrimmedString(args.signerId || '');
  const accountAddress = toTrimmedString(args.accountAddress || '').toLowerCase();
  return {
    profileId: toTrimmedString(args.profileId || ''),
    signerSlot: args.signerSlot,
    chainIdKey: toTrimmedString(args.chainIdKey || '').toLowerCase(),
    accountAddress,
    keyKind: toTrimmedString(args.keyKind || ''),
    schemaVersion: args.schemaVersion,
    signerId,
  };
}

const ENVELOPE_AAD_KEYS = [
  'profileId',
  'signerSlot',
  'chainIdKey',
  'accountAddress',
  'keyKind',
  'schemaVersion',
  'signerId',
] as const satisfies readonly (keyof KeyMaterialPayloadEnvelopeAAD)[];

/**
 * The stored AAD must name the same row as `expected`, field by field. Every
 * writer builds it with `buildEnvelopeAAD`, so a missing or different field is
 * a row that belongs to another signer or was changed, never a value to fill in.
 */
function normalizeEnvelopeAAD(
  raw: unknown,
  expected: KeyMaterialPayloadEnvelopeAAD,
  context: string,
): KeyMaterialPayloadEnvelopeAAD {
  const record = asRecord(raw);
  if (!record) {
    throw new Error(`KeyMaterialStore: payloadEnvelope.aad is missing for ${context}`);
  }
  const mismatched = ENVELOPE_AAD_KEYS.filter((key) => record[key] !== expected[key]);
  if (mismatched.length > 0) {
    throw new Error(
      `KeyMaterialStore: payloadEnvelope.aad mismatch (${mismatched.join(', ')}) for ${context}`,
    );
  }
  return { ...expected };
}

export function normalizePayloadEnvelope(
  raw: unknown,
  expectedAAD: KeyMaterialPayloadEnvelopeAAD,
  context: string,
): KeyMaterialPayloadEnvelope | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  if (!record) {
    throw new Error(`KeyMaterialStore: Invalid payloadEnvelope object for ${context}`);
  }
  const encVersionRaw = Number(record.encVersion);
  const encVersion =
    Number.isSafeInteger(encVersionRaw) && encVersionRaw >= 1 ? encVersionRaw : NaN;
  const alg = toTrimmedString(record.alg || '');
  const nonce = toTrimmedString(record.nonce || '');
  const ciphertext = toTrimmedString(record.ciphertext || '');
  const tag = toTrimmedString(record.tag || '');
  if (!Number.isFinite(encVersion)) {
    throw new Error(`KeyMaterialStore: Invalid payloadEnvelope.encVersion for ${context}`);
  }
  if (!alg || !nonce || !ciphertext) {
    throw new Error(
      `KeyMaterialStore: Missing payloadEnvelope cryptographic fields for ${context}`,
    );
  }
  const envelope: KeyMaterialPayloadEnvelope = {
    encVersion,
    alg,
    nonce,
    ciphertext,
    aad: normalizeEnvelopeAAD(record.aad, expectedAAD, context),
  };
  if (tag) {
    envelope.tag = tag;
  }
  return envelope;
}
