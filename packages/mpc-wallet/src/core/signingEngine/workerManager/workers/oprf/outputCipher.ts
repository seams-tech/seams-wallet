/**
 * AES-256-GCM for a 32-byte secret under a key from an RFC 9497 OPRF output: HKDF-SHA256 of the
 * output with a label. Only the holder of the OPRF input can compute that output, so only it can
 * open the ciphertext. Both functions zero `output` before they return. This module loads no
 * WASM, so the unit tests use it as it is.
 */

const NONCE_BYTES = 12;
const SECRET_BYTES = 32;

type OutputCipherInput = {
  /** The OPRF output. It is zeroed. */
  readonly output: Uint8Array;
  readonly label: string;
  readonly associatedData: Uint8Array<ArrayBuffer>;
};

async function outputKey(input: OutputCipherInput, usage: KeyUsage): Promise<CryptoKey> {
  const ikm = new Uint8Array(input.output);
  input.output.fill(0);
  try {
    const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(input.label),
      },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      [usage],
    );
  } finally {
    ikm.fill(0);
  }
}

export async function encryptUnderOprfOutput(
  input: OutputCipherInput & { readonly secret32: Uint8Array },
): Promise<{
  readonly nonce: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
}> {
  if (input.secret32.length !== SECRET_BYTES) {
    input.output.fill(0);
    throw new Error('The sealed secret must be 32 bytes');
  }
  const key = await outputKey(input, 'encrypt');
  const plaintext = new Uint8Array(input.secret32);
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: input.associatedData },
        key,
        plaintext,
      ),
    );
    return { nonce, ciphertext };
  } finally {
    plaintext.fill(0);
  }
}

/** Fails when the output, the label or the associated data differ from the seal. */
export async function decryptUnderOprfOutput(
  input: OutputCipherInput & {
    readonly nonce: Uint8Array<ArrayBuffer>;
    readonly ciphertext: Uint8Array<ArrayBuffer>;
  },
): Promise<Uint8Array> {
  if (input.nonce.length !== NONCE_BYTES) {
    input.output.fill(0);
    throw new Error('The sealed secret has an invalid nonce');
  }
  const key = await outputKey(input, 'decrypt');
  const secret32 = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: input.nonce, additionalData: input.associatedData },
      key,
      input.ciphertext,
    ),
  );
  if (secret32.length !== SECRET_BYTES) {
    secret32.fill(0);
    throw new Error('The sealed secret must be 32 bytes');
  }
  return secret32;
}
