// Sealed audio for a spoken request. Wallet core seals each recording to the verifier's audio
// key before it leaves the device, so the Seams server and OutLayer's coordinator carry only
// ciphertext. The verifier opens it inside its TEE.
//
// The envelope is HPKE base mode (RFC 9180) with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and
// ChaCha20-Poly1305. The key agreement and the key derivation are WebCrypto. WebCrypto has no
// ChaCha20-Poly1305, so the cipher is `@noble/ciphers`. A sealed clip is
// `enc || ciphertext || tag`. The `aad` is `op || 0x00 || owner`, so a sealed clip opens only
// for that owner and that operation.

import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { concat, utf8 } from '@shared/speakToSign/spokenRequest';

type Bytes = Uint8Array<ArrayBuffer>;

/** The length of the audio key, of the encapsulated key and of each X25519 key. */
const KEY_BYTES = 32;
const INFO = utf8('seams:voice-audio:v1');
// RFC 9180, section 7: DHKEM(X25519, HKDF-SHA256) 0x0020, HKDF-SHA256 0x0001,
// ChaCha20-Poly1305 0x0003.
const KEM_SUITE = concat([utf8('KEM'), bytes(0x00, 0x20)]);
const HPKE_SUITE = concat([utf8('HPKE'), bytes(0x00, 0x20, 0x00, 0x01, 0x00, 0x03)]);
const VERSION = utf8('HPKE-v1');
const EMPTY = bytes();
const HASH_BYTES = 32;
const AEAD_KEY_BYTES = 32;
const AEAD_NONCE_BYTES = 12;
/** The PKCS#8 bytes before a raw X25519 private key (RFC 8410). */
const X25519_PKCS8_PREFIX = bytes(
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
);
/** The X25519 base point, u = 9. */
const X25519_BASE_POINT = bytes(9, ...new Array<number>(KEY_BYTES - 1).fill(0));

type EphemeralKey = Readonly<{ privateKey: CryptoKey; publicKey: Bytes }>;

/**
 * Seals one WAV to the verifier's audio key, for one operation of one owner. Each call uses a
 * new ephemeral key. A test passes `ephemeralIkm` (RFC 9180 DeriveKeyPair) to get the fixed
 * bytes of the verifier's shared vector.
 */
export async function sealAudio(
  audioKey: Uint8Array,
  op: string,
  owner: string,
  wav: Uint8Array,
  ephemeralIkm?: Uint8Array,
): Promise<Bytes> {
  if (audioKey.length !== KEY_BYTES) throw new Error('The audio key is not 32 bytes.');
  const recipient = copy(audioKey);
  const ephemeral = ephemeralIkm ? await derivedKey(ephemeralIkm) : await newKey();
  // Encap: the shared secret from the Diffie-Hellman value and both public keys.
  const dh = await x25519(ephemeral.privateKey, recipient);
  if (dh.every((byte) => byte === 0)) throw new Error('The audio key is not a valid X25519 key.');
  const enc = ephemeral.publicKey;
  const eaePrk = await labeledExtract(KEM_SUITE, EMPTY, 'eae_prk', dh);
  const sharedSecret = await labeledExpand(
    KEM_SUITE,
    eaePrk,
    'shared_secret',
    concat([enc, recipient]),
    HASH_BYTES,
  );
  // KeySchedule, base mode: no pre-shared key.
  const pskIdHash = await labeledExtract(HPKE_SUITE, EMPTY, 'psk_id_hash', EMPTY);
  const infoHash = await labeledExtract(HPKE_SUITE, EMPTY, 'info_hash', INFO);
  const context = concat([bytes(0x00), pskIdHash, infoHash]);
  const secret = await labeledExtract(HPKE_SUITE, sharedSecret, 'secret', EMPTY);
  const key = await labeledExpand(HPKE_SUITE, secret, 'key', context, AEAD_KEY_BYTES);
  const nonce = await labeledExpand(HPKE_SUITE, secret, 'base_nonce', context, AEAD_NONCE_BYTES);
  // One message per context, so the nonce is the base nonce (sequence number 0).
  const aad = concat([utf8(op), bytes(0x00), utf8(owner)]);
  return concat([enc, chacha20poly1305(key, nonce, aad).encrypt(wav)]);
}

async function newKey(): Promise<EphemeralKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, [
    'deriveBits',
  ])) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
}

async function derivedKey(ikm: Uint8Array): Promise<EphemeralKey> {
  const prk = await labeledExtract(KEM_SUITE, EMPTY, 'dkp_prk', ikm);
  const secret = await labeledExpand(KEM_SUITE, prk, 'sk', EMPTY, KEY_BYTES);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    concat([X25519_PKCS8_PREFIX, secret]),
    { name: 'X25519' },
    false,
    ['deriveBits'],
  );
  return { privateKey, publicKey: await x25519(privateKey, X25519_BASE_POINT) };
}

async function x25519(privateKey: CryptoKey, publicKey: Uint8Array): Promise<Bytes> {
  const peer = await crypto.subtle.importKey('raw', copy(publicKey), { name: 'X25519' }, false, []);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, privateKey, 256),
  );
}

/** RFC 9180 LabeledExtract. An empty salt is a salt of zeros (RFC 5869). */
function labeledExtract(
  suite: Bytes,
  salt: Uint8Array,
  label: string,
  ikm: Uint8Array,
): Promise<Bytes> {
  return hmac(
    salt.length === 0 ? new Uint8Array(HASH_BYTES) : salt,
    concat([VERSION, suite, utf8(label), ikm]),
  );
}

/** RFC 9180 LabeledExpand for at most one hash block (32 bytes). */
async function labeledExpand(
  suite: Bytes,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
): Promise<Bytes> {
  if (length > HASH_BYTES) throw new Error('labeledExpand: more than one block');
  const labeled = concat([bytes(length >> 8, length & 0xff), VERSION, suite, utf8(label), info]);
  return (await hmac(prk, concat([labeled, bytes(0x01)]))).slice(0, length);
}

async function hmac(key: Uint8Array, message: Uint8Array): Promise<Bytes> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    copy(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, copy(message)));
}

function bytes(...values: number[]): Bytes {
  return new Uint8Array(values);
}

/** A copy on its own `ArrayBuffer`, as WebCrypto's types need. */
function copy(source: Uint8Array): Bytes {
  return new Uint8Array(source);
}
