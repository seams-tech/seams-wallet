import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import { encodeSigningSessionHkdfTuple } from '@shared/utils/signingSessionSeal';

/**
 * Encrypts an Email OTP code for storage. The key comes from the Email OTP
 * seal root secret, so a reader of D1 alone cannot read a code. The server can
 * still read it, so it can send the code of a retried challenge again. The
 * challenge ID is bound as associated data, so a sealed code opens only in
 * its own challenge.
 */
export type EmailOtpCodeSeal = {
  readonly seal: (input: {
    readonly challengeId: string;
    readonly otpCode: string;
  }) => Promise<string>;
  readonly open: (input: {
    readonly challengeId: string;
    readonly otpCodeSealedB64u: string;
  }) => Promise<string>;
};

const KEY_CONTEXT = ['seams/email-otp/challenge-code', 'aes-256-gcm-key/v1'];
const AAD_LABEL = 'seams/email-otp/challenge-code/v1';
const NONCE_BYTES = 12;

export function createEmailOtpCodeSeal(rootSecretB64u: string): EmailOtpCodeSeal {
  const key = deriveCodeKey(rootSecretB64u);
  // A key that fails to derive rejects at its first use, not at construction.
  key.catch(() => undefined);
  return {
    seal: async ({ challengeId, otpCode }) => {
      const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: nonce, additionalData: associatedData(challengeId) },
          await key,
          new TextEncoder().encode(otpCode),
        ),
      );
      const sealed = new Uint8Array(NONCE_BYTES + ciphertext.length);
      sealed.set(nonce, 0);
      sealed.set(ciphertext, NONCE_BYTES);
      return base64UrlEncode(sealed);
    },
    open: async ({ challengeId, otpCodeSealedB64u }) => {
      const sealed = base64UrlDecode(otpCodeSealedB64u);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: sealed.slice(0, NONCE_BYTES),
          additionalData: associatedData(challengeId),
        },
        await key,
        sealed.slice(NONCE_BYTES),
      );
      return new TextDecoder().decode(plaintext);
    },
  };
}

function associatedData(challengeId: string): ArrayBuffer {
  return toArrayBuffer(encodeSigningSessionHkdfTuple([AAD_LABEL, challengeId]));
}

async function deriveCodeKey(rootSecretB64u: string): Promise<CryptoKey> {
  const root = base64UrlDecode(rootSecretB64u);
  let derived: Uint8Array | null = null;
  try {
    if (root.length !== 32) throw new Error('The Email OTP seal root secret must be 32 bytes');
    const rootKey = await importKey(root, { name: 'HMAC', hash: 'SHA-256' }, ['sign']);
    derived = new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        rootKey,
        toArrayBuffer(encodeSigningSessionHkdfTuple(KEY_CONTEXT)),
      ),
    );
    return await importKey(derived, { name: 'AES-GCM' }, ['encrypt', 'decrypt']);
  } finally {
    root.fill(0);
    derived?.fill(0);
  }
}

async function importKey(
  bytes: Uint8Array,
  algorithm: HmacImportParams | AlgorithmIdentifier,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const copy = toArrayBuffer(bytes);
  try {
    return await crypto.subtle.importKey('raw', copy, algorithm, false, usages);
  } finally {
    new Uint8Array(copy).fill(0);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.length);
  new Uint8Array(copy).set(bytes);
  return copy;
}
