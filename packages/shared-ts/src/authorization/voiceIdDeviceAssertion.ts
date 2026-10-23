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
