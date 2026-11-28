import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { alphabetizeStringify, sha256Bytes } from '@shared/utils/digests';

// The proof of a device key: an Ed25519 signature of a key that cannot leave its device. A
// method with a local gate (VoiceID) signs only after the owner passes the gate.

const DEVICE_KEY_PROOF_DOMAIN = 'seams:auth:device-key:v1';

/**
 * The message that a device key signs for an audience. The MPC wallet keeps its own message
 * for the audience `wallet`, and it checks that message with `verifyDeviceKeySignature`.
 */
export function deviceKeyProofBytes(input: {
  readonly audience: string;
  readonly challenge: string;
  readonly methodId: string;
  readonly deviceKeyId: string;
}): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    alphabetizeStringify({
      domain: DEVICE_KEY_PROOF_DOMAIN,
      audience: input.audience,
      challenge: input.challenge,
      methodId: input.methodId,
      deviceKeyId: input.deviceKeyId,
    }),
  );
}

/** The ID of a device key is the SHA-256 digest of its raw public key. */
export async function deviceKeyIdOf(publicKeyB64u: string): Promise<string> {
  return base64UrlEncode(await sha256Bytes(base64UrlDecode(publicKeyB64u)));
}

/**
 * True when the stored public key has the stored ID and its signature of `signedBytes` is
 * valid. A malformed key or signature gives false.
 */
export async function verifyDeviceKeySignature(input: {
  readonly publicKeyB64u: string;
  readonly deviceKeyId: string;
  readonly signatureB64u: string;
  readonly signedBytes: Uint8Array<ArrayBuffer>;
}): Promise<boolean> {
  try {
    if ((await deviceKeyIdOf(input.publicKeyB64u)) !== input.deviceKeyId) return false;
    const publicKey = await crypto.subtle.importKey(
      'raw',
      base64UrlDecode(input.publicKeyB64u),
      'Ed25519',
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      base64UrlDecode(input.signatureB64u),
      input.signedBytes,
    );
  } catch {
    return false;
  }
}
