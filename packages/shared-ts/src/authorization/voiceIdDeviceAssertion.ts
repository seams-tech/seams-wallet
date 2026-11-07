import {
  parseWalletSessionMintId,
  type WalletSessionMintId,
} from './capabilityKinds';
import { alphabetizeStringify } from '../utils/digests';
import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletId,
} from '../utils/domainIds';
import { isPlainObject } from '../utils/validation';

const CHALLENGE_DOMAIN = 'seams:wallet-session:voiceid-device:v1';
const MAXIMUM_CHALLENGE_MS = 60_000;

declare const voiceIdDevicePublicKeyBrand: unique symbol;
export type VoiceIdDevicePublicKeyB64u = string & {
  readonly [voiceIdDevicePublicKeyBrand]: true;
};

export function parseVoiceIdDevicePublicKeyB64u(value: unknown): VoiceIdDevicePublicKeyB64u {
  if (typeof value !== 'string') throw new Error('VoiceID public key is invalid');
  const bytes = base64UrlDecode(value);
  if (bytes.length !== 32 || base64UrlEncode(bytes) !== value) {
    throw new Error('VoiceID public key must be canonical Ed25519 bytes');
  }
  return value as VoiceIdDevicePublicKeyB64u;
}

export type VoiceIdWalletSessionChallenge = Readonly<{
  kind: 'voiceid_wallet_session_challenge_v1';
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  walletAuthorityId: WalletAuthorityId;
  deviceKeyId: DigestB64u;
  challengeId: WalletSessionMintId;
  nonce: DigestB64u;
  requestOrigin: string;
  audience: string;
  issuedAtMs: number;
  expiresAtMs: number;
}>;

export type VoiceIdDeviceAssertion = Readonly<{
  kind: 'voiceid_device_assertion_v1';
  challenge: VoiceIdWalletSessionChallenge;
  signatureB64u: string;
}>;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) return false;
  }
  return true;
}

function requireOrigin(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be an origin`);
  let origin: string;
  let protocol: string;
  try {
    const parsed = new URL(value);
    origin = parsed.origin;
    protocol = parsed.protocol;
  } catch {
    throw new Error(`${label} must be an origin`);
  }
  if (origin !== value || (protocol !== 'http:' && protocol !== 'https:')) {
    throw new Error(`${label} must be a canonical HTTP origin`);
  }
  return origin;
}

function requireWindow(issuedAtMs: unknown, expiresAtMs: unknown): void {
  if (
    !Number.isSafeInteger(issuedAtMs) ||
    !Number.isSafeInteger(expiresAtMs) ||
    Number(issuedAtMs) <= 0 ||
    Number(expiresAtMs) <= Number(issuedAtMs) ||
    Number(expiresAtMs) - Number(issuedAtMs) > MAXIMUM_CHALLENGE_MS
  ) {
    throw new Error('VoiceID challenge has an invalid validity window');
  }
}

export function buildVoiceIdWalletSessionChallenge(
  fields: Omit<VoiceIdWalletSessionChallenge, 'kind'>,
): VoiceIdWalletSessionChallenge {
  requireWindow(fields.issuedAtMs, fields.expiresAtMs);
  requireOrigin(fields.requestOrigin, 'VoiceID requestOrigin');
  requireOrigin(fields.audience, 'VoiceID audience');
  return {
    kind: 'voiceid_wallet_session_challenge_v1',
    walletId: fields.walletId,
    walletAuthMethodId: fields.walletAuthMethodId,
    walletAuthorityId: fields.walletAuthorityId,
    deviceKeyId: fields.deviceKeyId,
    challengeId: fields.challengeId,
    nonce: fields.nonce,
    requestOrigin: fields.requestOrigin,
    audience: fields.audience,
    issuedAtMs: fields.issuedAtMs,
    expiresAtMs: fields.expiresAtMs,
  };
}

export function parseVoiceIdWalletSessionChallenge(raw: unknown): VoiceIdWalletSessionChallenge {
  if (
    !isPlainObject(raw) ||
    !exactKeys(raw, [
      'kind',
      'walletId',
      'walletAuthMethodId',
      'walletAuthorityId',
      'deviceKeyId',
      'challengeId',
      'nonce',
      'requestOrigin',
      'audience',
      'issuedAtMs',
      'expiresAtMs',
    ]) ||
    raw.kind !== 'voiceid_wallet_session_challenge_v1'
  ) {
    throw new Error('Invalid VoiceID Wallet Session challenge');
  }
  const walletId = parseWalletId(raw.walletId);
  const walletAuthMethodId = parseWalletAuthMethodId(raw.walletAuthMethodId);
  const walletAuthorityId = parseWalletAuthorityId(raw.walletAuthorityId);
  const challengeId = parseWalletSessionMintId(raw.challengeId);
  if (!walletId.ok || !walletAuthMethodId.ok || !walletAuthorityId.ok || !challengeId.ok) {
    throw new Error('VoiceID challenge identity is invalid');
  }
  if (typeof raw.issuedAtMs !== 'number' || typeof raw.expiresAtMs !== 'number') {
    throw new Error('VoiceID challenge times must be numbers');
  }
  return buildVoiceIdWalletSessionChallenge({
    walletId: walletId.value,
    walletAuthMethodId: walletAuthMethodId.value,
    walletAuthorityId: walletAuthorityId.value,
    deviceKeyId: parseDigestB64u(raw.deviceKeyId),
    challengeId: challengeId.value,
    nonce: parseDigestB64u(raw.nonce),
    requestOrigin: requireOrigin(raw.requestOrigin, 'VoiceID requestOrigin'),
    audience: requireOrigin(raw.audience, 'VoiceID audience'),
    issuedAtMs: raw.issuedAtMs,
    expiresAtMs: raw.expiresAtMs,
  });
}

export function parseVoiceIdDeviceAssertion(raw: unknown): VoiceIdDeviceAssertion {
  if (
    !isPlainObject(raw) ||
    !exactKeys(raw, ['kind', 'challenge', 'signatureB64u']) ||
    raw.kind !== 'voiceid_device_assertion_v1' ||
    typeof raw.signatureB64u !== 'string'
  ) {
    throw new Error('Invalid VoiceID device assertion');
  }
  const signature = base64UrlDecode(raw.signatureB64u);
  if (signature.length !== 64 || base64UrlEncode(signature) !== raw.signatureB64u) {
    throw new Error('VoiceID signature must be canonical Ed25519 bytes');
  }
  return {
    kind: 'voiceid_device_assertion_v1',
    challenge: parseVoiceIdWalletSessionChallenge(raw.challenge),
    signatureB64u: raw.signatureB64u,
  };
}

export function voiceIdWalletSessionChallengeBytes(
  challenge: VoiceIdWalletSessionChallenge,
): Uint8Array<ArrayBuffer> {
  const payload = alphabetizeStringify(challenge);
  return new TextEncoder().encode(`${CHALLENGE_DOMAIN}|${payload}`);
}

const OPERATION_DOMAIN = 'seams:wallet-operation:voiceid-device:v1';

/** The operations a fresh voice check can authorize; signing uses a Wallet Session. */
export type VoiceIdOperationKind = 'near.export_key' | 'evm.export_key';

/**
 * What the enrolled device key signs after a local voice match for one
 * operation. `operationChallenge` is the digest that a passkey signs for the
 * same operation, and the server accepts that operation only once. It is a
 * different statement from a Wallet Session challenge, under its own domain,
 * so neither proof can stand in for the other.
 */
export type VoiceIdOperationStatement = Readonly<{
  kind: 'voiceid_operation_statement_v1';
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  walletAuthorityId: WalletAuthorityId;
  deviceKeyId: DigestB64u;
  operationKind: VoiceIdOperationKind;
  operationChallenge: DigestB64u;
  requestOrigin: string;
  issuedAtMs: number;
  expiresAtMs: number;
}>;

export type VoiceIdOperationAssertion = Readonly<{
  kind: 'voiceid_operation_assertion_v1';
  statement: VoiceIdOperationStatement;
  signatureB64u: string;
}>;

function parseVoiceIdOperationKind(value: unknown): VoiceIdOperationKind {
  if (value === 'near.export_key' || value === 'evm.export_key') return value;
  throw new Error('VoiceID operation kind is unsupported');
}

export function buildVoiceIdOperationStatement(
  fields: Omit<VoiceIdOperationStatement, 'kind'>,
): VoiceIdOperationStatement {
  requireWindow(fields.issuedAtMs, fields.expiresAtMs);
  requireOrigin(fields.requestOrigin, 'VoiceID requestOrigin');
  return {
    kind: 'voiceid_operation_statement_v1',
    walletId: fields.walletId,
    walletAuthMethodId: fields.walletAuthMethodId,
    walletAuthorityId: fields.walletAuthorityId,
    deviceKeyId: fields.deviceKeyId,
    operationKind: parseVoiceIdOperationKind(fields.operationKind),
    operationChallenge: parseDigestB64u(fields.operationChallenge),
    requestOrigin: fields.requestOrigin,
    issuedAtMs: fields.issuedAtMs,
    expiresAtMs: fields.expiresAtMs,
  };
}

export function parseVoiceIdOperationStatement(raw: unknown): VoiceIdOperationStatement {
  if (
    !isPlainObject(raw) ||
    !exactKeys(raw, [
      'kind',
      'walletId',
      'walletAuthMethodId',
      'walletAuthorityId',
      'deviceKeyId',
      'operationKind',
      'operationChallenge',
      'requestOrigin',
      'issuedAtMs',
      'expiresAtMs',
    ]) ||
    raw.kind !== 'voiceid_operation_statement_v1'
  ) {
    throw new Error('Invalid VoiceID operation statement');
  }
  const walletId = parseWalletId(raw.walletId);
  const walletAuthMethodId = parseWalletAuthMethodId(raw.walletAuthMethodId);
  const walletAuthorityId = parseWalletAuthorityId(raw.walletAuthorityId);
  if (!walletId.ok || !walletAuthMethodId.ok || !walletAuthorityId.ok) {
    throw new Error('VoiceID operation identity is invalid');
  }
  if (typeof raw.issuedAtMs !== 'number' || typeof raw.expiresAtMs !== 'number') {
    throw new Error('VoiceID operation times must be numbers');
  }
  return buildVoiceIdOperationStatement({
    walletId: walletId.value,
    walletAuthMethodId: walletAuthMethodId.value,
    walletAuthorityId: walletAuthorityId.value,
    deviceKeyId: parseDigestB64u(raw.deviceKeyId),
    operationKind: parseVoiceIdOperationKind(raw.operationKind),
    operationChallenge: parseDigestB64u(raw.operationChallenge),
    requestOrigin: requireOrigin(raw.requestOrigin, 'VoiceID requestOrigin'),
    issuedAtMs: raw.issuedAtMs,
    expiresAtMs: raw.expiresAtMs,
  });
}

export function parseVoiceIdOperationAssertion(raw: unknown): VoiceIdOperationAssertion {
  if (
    !isPlainObject(raw) ||
    !exactKeys(raw, ['kind', 'statement', 'signatureB64u']) ||
    raw.kind !== 'voiceid_operation_assertion_v1' ||
    typeof raw.signatureB64u !== 'string'
  ) {
    throw new Error('Invalid VoiceID operation assertion');
  }
  const signature = base64UrlDecode(raw.signatureB64u);
  if (signature.length !== 64 || base64UrlEncode(signature) !== raw.signatureB64u) {
    throw new Error('VoiceID signature must be canonical Ed25519 bytes');
  }
  return {
    kind: 'voiceid_operation_assertion_v1',
    statement: parseVoiceIdOperationStatement(raw.statement),
    signatureB64u: raw.signatureB64u,
  };
}

export function voiceIdOperationStatementBytes(
  statement: VoiceIdOperationStatement,
): Uint8Array<ArrayBuffer> {
  const payload = alphabetizeStringify(statement);
  return new TextEncoder().encode(`${OPERATION_DOMAIN}|${payload}`);
}

const INTENT_DOMAIN = 'seams:wallet-operation:voiceid-intent:v1';
const MAXIMUM_HEARD_TEXT_LENGTH = 256;

/** The spoken requests that a device intent statement can name. */
export type VoiceIdIntentOperationKind =
  | 'near.voice_vault_transfer'
  | 'near.voice_multisig_approval';

/**
 * What the enrolled device key signs for one spoken request. It names the
 * `spoken-intent` request digest, the digest of the rendered spoken text, the
 * text the user saw in the confirm modal and the digest of the uploaded audio
 * ciphertext. It has its own kind and domain, so it can never parse as, or be
 * verified as, an operation statement or a Wallet Session challenge.
 */
export type VoiceIdIntentStatement = Readonly<{
  kind: 'voiceid_intent_statement_v1';
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  walletAuthorityId: WalletAuthorityId;
  deviceKeyId: DigestB64u;
  operationKind: VoiceIdIntentOperationKind;
  operationChallenge: DigestB64u;
  rendererVersion: 'spoken-intent/1';
  spokenTextDigest: DigestB64u;
  heardText: string;
  audioDigest: DigestB64u;
  requestOrigin: string;
  issuedAtMs: number;
  expiresAtMs: number;
}>;

export type VoiceIdIntentAssertion = Readonly<{
  kind: 'voiceid_intent_assertion_v1';
  statement: VoiceIdIntentStatement;
  signatureB64u: string;
}>;

function parseVoiceIdIntentOperationKind(value: unknown): VoiceIdIntentOperationKind {
  if (value === 'near.voice_vault_transfer' || value === 'near.voice_multisig_approval') {
    return value;
  }
  throw new Error('VoiceID intent operation kind is unsupported');
}

function requireHeardText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_HEARD_TEXT_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error('VoiceID heard text must be 1 to 256 printable characters');
  }
  return value;
}

export function buildVoiceIdIntentStatement(
  fields: Omit<VoiceIdIntentStatement, 'kind'>,
): VoiceIdIntentStatement {
  requireWindow(fields.issuedAtMs, fields.expiresAtMs);
  requireOrigin(fields.requestOrigin, 'VoiceID requestOrigin');
  if (fields.rendererVersion !== 'spoken-intent/1') {
    throw new Error('VoiceID intent renderer version is unsupported');
  }
  return {
    kind: 'voiceid_intent_statement_v1',
    walletId: fields.walletId,
    walletAuthMethodId: fields.walletAuthMethodId,
    walletAuthorityId: fields.walletAuthorityId,
    deviceKeyId: parseDigestB64u(fields.deviceKeyId),
    operationKind: parseVoiceIdIntentOperationKind(fields.operationKind),
    operationChallenge: parseDigestB64u(fields.operationChallenge),
    rendererVersion: fields.rendererVersion,
    spokenTextDigest: parseDigestB64u(fields.spokenTextDigest),
    heardText: requireHeardText(fields.heardText),
    audioDigest: parseDigestB64u(fields.audioDigest),
    requestOrigin: fields.requestOrigin,
    issuedAtMs: fields.issuedAtMs,
    expiresAtMs: fields.expiresAtMs,
  };
}

export function parseVoiceIdIntentStatement(raw: unknown): VoiceIdIntentStatement {
  if (
    !isPlainObject(raw) ||
    !exactKeys(raw, [
      'kind',
      'walletId',
      'walletAuthMethodId',
      'walletAuthorityId',
      'deviceKeyId',
      'operationKind',
      'operationChallenge',
      'rendererVersion',
      'spokenTextDigest',
      'heardText',
      'audioDigest',
      'requestOrigin',
      'issuedAtMs',
      'expiresAtMs',
    ]) ||
    raw.kind !== 'voiceid_intent_statement_v1' ||
    raw.rendererVersion !== 'spoken-intent/1'
  ) {
    throw new Error('Invalid VoiceID intent statement');
  }
  const walletId = parseWalletId(raw.walletId);
  const walletAuthMethodId = parseWalletAuthMethodId(raw.walletAuthMethodId);
  const walletAuthorityId = parseWalletAuthorityId(raw.walletAuthorityId);
  if (!walletId.ok || !walletAuthMethodId.ok || !walletAuthorityId.ok) {
    throw new Error('VoiceID intent identity is invalid');
  }
  if (typeof raw.issuedAtMs !== 'number' || typeof raw.expiresAtMs !== 'number') {
    throw new Error('VoiceID intent times must be numbers');
  }
  return buildVoiceIdIntentStatement({
    walletId: walletId.value,
    walletAuthMethodId: walletAuthMethodId.value,
    walletAuthorityId: walletAuthorityId.value,
    deviceKeyId: parseDigestB64u(raw.deviceKeyId),
    operationKind: parseVoiceIdIntentOperationKind(raw.operationKind),
    operationChallenge: parseDigestB64u(raw.operationChallenge),
    rendererVersion: raw.rendererVersion,
    spokenTextDigest: parseDigestB64u(raw.spokenTextDigest),
    heardText: requireHeardText(raw.heardText),
    audioDigest: parseDigestB64u(raw.audioDigest),
    requestOrigin: requireOrigin(raw.requestOrigin, 'VoiceID requestOrigin'),
    issuedAtMs: raw.issuedAtMs,
    expiresAtMs: raw.expiresAtMs,
  });
}

export function parseVoiceIdIntentAssertion(raw: unknown): VoiceIdIntentAssertion {
  if (
    !isPlainObject(raw) ||
    !exactKeys(raw, ['kind', 'statement', 'signatureB64u']) ||
    raw.kind !== 'voiceid_intent_assertion_v1' ||
    typeof raw.signatureB64u !== 'string'
  ) {
    throw new Error('Invalid VoiceID intent assertion');
  }
  const signature = base64UrlDecode(raw.signatureB64u);
  if (signature.length !== 64 || base64UrlEncode(signature) !== raw.signatureB64u) {
    throw new Error('VoiceID signature must be canonical Ed25519 bytes');
  }
  return {
    kind: 'voiceid_intent_assertion_v1',
    statement: parseVoiceIdIntentStatement(raw.statement),
    signatureB64u: raw.signatureB64u,
  };
}

/** Signed bytes: `seams:wallet-operation:voiceid-intent:v1|` and the alphabetized JSON. */
export function voiceIdIntentStatementBytes(
  statement: VoiceIdIntentStatement,
): Uint8Array<ArrayBuffer> {
  const payload = alphabetizeStringify(statement);
  return new TextEncoder().encode(`${INTENT_DOMAIN}|${payload}`);
}
