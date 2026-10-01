import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';

type PasskeyCustodyBrand<TName extends string> = {
  readonly __passkeyCustodyBrand: TName;
};

// Unpadded canonical base64url over the AEAD nonce for one sealed envelope.
export type EnvelopeNonceB64u = string & PasskeyCustodyBrand<'EnvelopeNonceB64u'>;

// Unpadded canonical base64url over AEAD ciphertext. It never holds plaintext
// custody material, PRF output, a KEK, or a recovery code.
export type EnvelopeCiphertextB64u = string & PasskeyCustodyBrand<'EnvelopeCiphertextB64u'>;

// 32-byte Ed25519 public key. This is public identity, not custody material.
export type Ed25519PublicKeyB64u = string & PasskeyCustodyBrand<'Ed25519PublicKeyB64u'>;

// 33-byte compressed secp256k1 point. This is public identity, not custody
// material.
export type Secp256k1CompressedPublicKeyB64u = string &
  PasskeyCustodyBrand<'Secp256k1CompressedPublicKeyB64u'>;

// Yao key-creation signer slot. Router A/B encodes this as a positive u32 and
// binds it into the Ed25519 application binding.
export type KeyCreationSignerSlot = number & PasskeyCustodyBrand<'KeyCreationSignerSlot'>;

// Monotonic compare-and-set revision for one envelope row. A browser cache is
// usable only at the exact server revision.
export type EnvelopeRevision = number & PasskeyCustodyBrand<'EnvelopeRevision'>;

const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;

function requireCanonicalBase64Url(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || !UNPADDED_BASE64URL.test(value)) {
    throw new Error(`${label} must be unpadded base64url`);
  }
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(value);
  } catch {
    throw new Error(`${label} must be valid base64url`);
  }
  if (base64UrlEncode(decoded) !== value) {
    throw new Error(`${label} must be canonical base64url`);
  }
  return decoded;
}

// Unwraps a parse result, putting the field's label before its error.
export function requireParsed<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly message: string } },
  label: string,
): T {
  if (result.ok) return result.value;
  throw new Error(`${label} ${result.error.message}`);
}

// Wraps the canonical 32-byte digest parser so a failure names the field that
// carried the bad digest.
export function parseDigestField(value: unknown, label: string): DigestB64u {
  try {
    return parseDigestB64u(value);
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : 'is not a digest'}`);
  }
}

// Frozen AEAD for every passkey custody wrap: ChaCha20Poly1305 (IETF) under an
// HKDF-SHA256-derived key, matching EMAIL_OTP_RECOVERY_WRAP_ALG and the
// Rust/WASM activated-Client seal.
const PASSKEY_CUSTODY_WRAP_NONCE_LENGTH = 12 as const;
const PASSKEY_CUSTODY_WRAP_TAG_LENGTH = 16 as const;

export function parseEnvelopeNonceB64u(value: unknown, label = 'nonceB64u'): EnvelopeNonceB64u {
  const decoded = requireCanonicalBase64Url(value, label);
  if (decoded.length !== PASSKEY_CUSTODY_WRAP_NONCE_LENGTH) {
    throw new Error(`${label} must decode to a 12-byte ChaCha20Poly1305 nonce`);
  }
  return value as EnvelopeNonceB64u;
}

export function parseEnvelopeCiphertextB64u(
  value: unknown,
  label = 'ciphertextB64u',
): EnvelopeCiphertextB64u {
  const decoded = requireCanonicalBase64Url(value, label);
  if (decoded.length < PASSKEY_CUSTODY_WRAP_TAG_LENGTH + 1) {
    throw new Error(`${label} must decode to sealed ciphertext with an authentication tag`);
  }
  return value as EnvelopeCiphertextB64u;
}

export function parseEd25519PublicKeyB64u(
  value: unknown,
  label = 'registeredPublicKeyB64u',
): Ed25519PublicKeyB64u {
  const decoded = requireCanonicalBase64Url(value, label);
  if (decoded.length !== 32) {
    throw new Error(`${label} must decode to a 32-byte Ed25519 public key`);
  }
  return value as Ed25519PublicKeyB64u;
}

export function parseSecp256k1CompressedPublicKeyB64u(
  value: unknown,
  label = 'publicKey33B64u',
): Secp256k1CompressedPublicKeyB64u {
  const decoded = requireCanonicalBase64Url(value, label);
  if (decoded.length !== 33) {
    throw new Error(`${label} must decode to a 33-byte compressed secp256k1 point`);
  }
  if (decoded[0] !== 0x02 && decoded[0] !== 0x03) {
    throw new Error(`${label} must be a compressed secp256k1 public key`);
  }
  return value as Secp256k1CompressedPublicKeyB64u;
}

export function parseKeyCreationSignerSlot(
  value: unknown,
  label = 'keyCreationSignerSlot',
): KeyCreationSignerSlot {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 0xffffffff
  ) {
    throw new Error(`${label} must be a positive u32`);
  }
  return value as KeyCreationSignerSlot;
}

export function parseEnvelopeRevision(
  value: unknown,
  label = 'envelopeRevision',
): EnvelopeRevision {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer revision`);
  }
  return value as EnvelopeRevision;
}

export function parseUnixMs(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive unix-millisecond timestamp`);
  }
  return value;
}
