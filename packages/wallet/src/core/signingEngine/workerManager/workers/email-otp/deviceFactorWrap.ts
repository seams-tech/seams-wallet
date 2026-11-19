import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { encodeSigningSessionHkdfTuple } from '@shared/utils/signingSessionSeal';
import { decryptUnderOprfOutput, encryptUnderOprfOutput } from '../oprf/outputCipher';

/**
 * The wrapped Email OTP factor that the server stores: an AES-GCM nonce and S encrypted under a
 * key from the POPRF output for the device input. The associated data names the wallet, the
 * enrollment and the factor nonce, so a wrapped factor does not open under another enrollment.
 * Both functions zero `output`.
 */

const WRAP_LABEL = 'seams/email-otp/device-factor-wrap/v1';
const WRAP_NONCE_BYTES = 12;

type EmailOtpFactorWrapScope = {
  readonly walletId: string;
  readonly enrollmentId: string;
  readonly factorNonceB64u: string;
};

function wrapAssociatedData(scope: EmailOtpFactorWrapScope): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    encodeSigningSessionHkdfTuple([
      WRAP_LABEL,
      scope.walletId,
      scope.enrollmentId,
      scope.factorNonceB64u,
    ]),
  );
}

export async function wrapEmailOtpFactorSecret(input: {
  readonly output: Uint8Array;
  readonly scope: EmailOtpFactorWrapScope;
  readonly factorSecret32: Uint8Array;
}): Promise<string> {
  const { nonce, ciphertext } = await encryptUnderOprfOutput({
    output: input.output,
    label: WRAP_LABEL,
    associatedData: wrapAssociatedData(input.scope),
    secret32: input.factorSecret32,
  });
  const wrapped = new Uint8Array(WRAP_NONCE_BYTES + ciphertext.length);
  wrapped.set(nonce, 0);
  wrapped.set(ciphertext, WRAP_NONCE_BYTES);
  return base64UrlEncode(wrapped);
}

export async function unwrapEmailOtpFactorSecret(input: {
  readonly output: Uint8Array;
  readonly scope: EmailOtpFactorWrapScope;
  readonly wrappedFactorB64u: string;
}): Promise<Uint8Array> {
  const wrapped = base64UrlDecode(input.wrappedFactorB64u);
  return await decryptUnderOprfOutput({
    output: input.output,
    label: WRAP_LABEL,
    associatedData: wrapAssociatedData(input.scope),
    nonce: wrapped.slice(0, WRAP_NONCE_BYTES),
    ciphertext: wrapped.slice(WRAP_NONCE_BYTES),
  });
}
