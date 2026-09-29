// Opens the HPKE envelope (X25519, HKDF-SHA256, AES-256-GCM) that carries a linked device's
// ECDSA target client share, and the X25519 PKCS#8 encoding it shares with recipient keys.
import type { CommittedEcdsaSignerPackageV1 } from '@shared/device-linking';
import { base64UrlDecode } from '@shared/utils/base64';
import { concat } from '@shared/utils/digestEncoding';

const LINKED_DEVICE_ECDSA_SOURCE_CONTRIBUTION_HPKE_INFO_V1 = new TextEncoder().encode(
  'seams/linked-device/ecdsa-source-contribution/hpke-x25519-hkdf-sha256-aes256gcm/v1',
);

const HPKE_VERSION_V1 = new TextEncoder().encode('HPKE-v1');

const HPKE_KEM_SUITE_ID_V1 = concat([new TextEncoder().encode('KEM'), uint16Bytes(0x0020)]);

const HPKE_SUITE_ID_V1 = concat([
  new TextEncoder().encode('HPKE'),
  uint16Bytes(0x0020),
  uint16Bytes(0x0001),
  uint16Bytes(0x0002),
]);

export async function openLinkedDeviceEcdsaTargetClientShare(input: {
  readonly envelope: CommittedEcdsaSignerPackageV1['encryptedTargetClientShare'];
  readonly recipientPrivateKey: Uint8Array;
}): Promise<Uint8Array> {
  if (input.recipientPrivateKey.length !== 32) {
    throw new Error('ECDSA client recipient private key must be 32 bytes');
  }
  const encappedKey = base64UrlDecode(input.envelope.encappedKeyB64u);
  const recipientPublicKey = base64UrlDecode(input.envelope.recipientPublicKeyB64u);
  const bindingDigest = base64UrlDecode(input.envelope.bindingDigestB64u);
  const ciphertext = base64UrlDecode(input.envelope.ciphertextB64u);
  let privatePkcs8: Uint8Array | null = null;
  let sharedSecret: Uint8Array | null = null;
  let kemSharedSecret: Uint8Array | null = null;
  let secret: Uint8Array | null = null;
  let key: CryptoKey | null = null;
  try {
    privatePkcs8 = x25519PrivateKeyPkcs8(input.recipientPrivateKey);
    const privateKey = await globalThis.crypto.subtle.importKey(
      'pkcs8',
      privatePkcs8,
      { name: 'X25519' },
      false,
      ['deriveBits'],
    );
    const encappedPublicKey = await globalThis.crypto.subtle.importKey(
      'raw',
      encappedKey,
      { name: 'X25519' },
      false,
      [],
    );
    sharedSecret = new Uint8Array(
      await globalThis.crypto.subtle.deriveBits(
        { name: 'X25519', public: encappedPublicKey },
        privateKey,
        256,
      ),
    );
    const kemContext = concat([encappedKey, recipientPublicKey]);
    const eaePrk = await hpkeLabeledExtract(HPKE_KEM_SUITE_ID_V1, 'eae_prk', sharedSecret);
    kemSharedSecret = await hpkeLabeledExpand(
      HPKE_KEM_SUITE_ID_V1,
      eaePrk,
      'shared_secret',
      kemContext,
      32,
    );
    const pskIdHash = await hpkeLabeledExtract(HPKE_SUITE_ID_V1, 'psk_id_hash', new Uint8Array(0));
    const infoHash = await hpkeLabeledExtract(
      HPKE_SUITE_ID_V1,
      'info_hash',
      LINKED_DEVICE_ECDSA_SOURCE_CONTRIBUTION_HPKE_INFO_V1,
    );
    const keyScheduleContext = concat([new Uint8Array([0]), pskIdHash, infoHash]);
    secret = await hpkeLabeledExtract(
      HPKE_SUITE_ID_V1,
      'secret',
      new Uint8Array(0),
      kemSharedSecret,
    );
    const encryptionKey = await hpkeLabeledExpand(
      HPKE_SUITE_ID_V1,
      secret,
      'key',
      keyScheduleContext,
      32,
    );
    const baseNonce = await hpkeLabeledExpand(
      HPKE_SUITE_ID_V1,
      secret,
      'base_nonce',
      keyScheduleContext,
      12,
    );
    key = await globalThis.crypto.subtle.importKey(
      'raw',
      encryptionKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: baseNonce, additionalData: bindingDigest, tagLength: 128 },
        key,
        ciphertext,
      ),
    );
    if (plaintext.length !== 32) {
      plaintext.fill(0);
      throw new Error('ECDSA target client share must be 32 bytes');
    }
    return plaintext;
  } finally {
    encappedKey.fill(0);
    recipientPublicKey.fill(0);
    bindingDigest.fill(0);
    ciphertext.fill(0);
    privatePkcs8?.fill(0);
    sharedSecret?.fill(0);
    kemSharedSecret?.fill(0);
    secret?.fill(0);
  }
}

async function hpkeLabeledExtract(
  suiteId: Uint8Array,
  label: string,
  input: Uint8Array,
  salt: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
  return await hmacSha256(
    salt.length === 0 ? new Uint8Array(32) : salt,
    concat([HPKE_VERSION_V1, suiteId, new TextEncoder().encode(label), input]),
  );
}

async function hpkeLabeledExpand(
  suiteId: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const labeledInfo = concat([
    uint16Bytes(length),
    HPKE_VERSION_V1,
    suiteId,
    new TextEncoder().encode(label),
    info,
  ]);
  return await hkdfExpand(prk, labeledInfo, length);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const output = new Uint8Array(length);
  let previous = new Uint8Array(0);
  try {
    for (let counter = 1, offset = 0; offset < length; counter += 1) {
      const block = await hmacSha256(prk, concat([previous, info, new Uint8Array([counter])]));
      const copied = Math.min(block.length, length - offset);
      output.set(block.subarray(0, copied), offset);
      offset += copied;
      previous.fill(0);
      previous = block;
    }
    return output;
  } catch (error) {
    output.fill(0);
    throw error;
  } finally {
    previous.fill(0);
  }
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, data));
}

// RFC 8410's fixed PKCS#8 wrapper for a 32-byte X25519 scalar.
const X25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

function x25519PrivateKeyPkcs8(privateKey: Uint8Array): Uint8Array {
  return concat([X25519_PKCS8_PREFIX, privateKey]);
}

function uint16Bytes(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

export function extractX25519PrivateKey(pkcs8: Uint8Array): Uint8Array {
  if (pkcs8.length !== X25519_PKCS8_PREFIX.length + 32) {
    throw new Error('ordinary signer material recipient private key encoding is invalid');
  }
  for (let index = 0; index < X25519_PKCS8_PREFIX.length; index += 1) {
    if (pkcs8[index] !== X25519_PKCS8_PREFIX[index]) {
      throw new Error('ordinary signer material recipient private key encoding is invalid');
    }
  }
  return pkcs8.slice(X25519_PKCS8_PREFIX.length);
}
