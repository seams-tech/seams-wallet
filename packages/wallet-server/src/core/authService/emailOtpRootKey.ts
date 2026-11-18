import { base64UrlDecode } from '@shared/utils/encoders';
import { encodeSigningSessionHkdfTuple } from '@shared/utils/signingSessionSeal';

/**
 * Derives 32 bytes from the Email OTP seal root under a context. Each context
 * gives an independent key: HMAC-SHA256 of the encoded context, keyed by the root.
 * The caller zeroes the result.
 */
export async function deriveEmailOtpRootBytes(
  rootSecretB64u: string,
  context: readonly string[],
): Promise<Uint8Array> {
  const root = base64UrlDecode(rootSecretB64u);
  const rootCopy = new ArrayBuffer(root.length);
  new Uint8Array(rootCopy).set(root);
  try {
    if (root.length !== 32) throw new Error('The Email OTP seal root secret must be 32 bytes');
    const rootKey = await crypto.subtle.importKey(
      'raw',
      rootCopy,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const message = encodeSigningSessionHkdfTuple(context);
    const messageCopy = new ArrayBuffer(message.length);
    new Uint8Array(messageCopy).set(message);
    return new Uint8Array(await crypto.subtle.sign('HMAC', rootKey, messageCopy));
  } finally {
    root.fill(0);
    new Uint8Array(rootCopy).fill(0);
  }
}
