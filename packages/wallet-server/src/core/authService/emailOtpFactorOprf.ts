import {
  EMAIL_OTP_FACTOR_OPRF_KEY_INFO,
  emailOtpFactorOprfInfo,
} from '@shared/utils/emailOtpDomain';
import { evaluateOprf, oprfPublicKey } from '../oprfWasm';
import { deriveEmailOtpRootBytes } from './emailOtpRootKey';

/**
 * The server half of the Email OTP device factor. The device keeps a random
 * input; the factor key S is the RFC 9497 POPRF output under the server key of
 * one key version. The server sees only blinded elements, so it holds no copy
 * of S and cannot compute it without the device.
 */
export type EmailOtpFactorOprf = {
  readonly currentKeyVersion: string;
  readonly publicKey: (keyVersion: string) => Promise<Uint8Array>;
  readonly evaluate: (input: {
    readonly keyVersion: string;
    readonly walletId: string;
    readonly enrollmentId: string;
    readonly factorNonceB64u: string;
    readonly blindedElement: Uint8Array;
  }) => Promise<{ readonly evaluatedElement: Uint8Array; readonly proof: Uint8Array }>;
};

const SEED_CONTEXT = ['seams/email-otp/factor-oprf', 'poprf-ristretto255-sha512/v1'];

export function createEmailOtpFactorOprf(input: {
  readonly rootSecretB64u: string;
  readonly currentKeyVersion: string;
  readonly acceptedKeyVersions: readonly string[];
}): EmailOtpFactorOprf {
  const accepted = new Set(input.acceptedKeyVersions);
  if (!accepted.has(input.currentKeyVersion)) {
    throw new Error('The accepted Email OTP key versions must include the current version');
  }
  const withSeed = async <T>(keyVersion: string, use: (seed32: Uint8Array) => Promise<T>) => {
    if (!accepted.has(keyVersion)) throw new Error(`Unknown Email OTP key version "${keyVersion}"`);
    const seed32 = await deriveEmailOtpRootBytes(input.rootSecretB64u, [
      ...SEED_CONTEXT,
      keyVersion,
    ]);
    try {
      return await use(seed32);
    } finally {
      seed32.fill(0);
    }
  };
  return {
    currentKeyVersion: input.currentKeyVersion,
    publicKey: (keyVersion) =>
      withSeed(keyVersion, (seed32) =>
        oprfPublicKey({ seed32, keyInfo: EMAIL_OTP_FACTOR_OPRF_KEY_INFO }),
      ),
    evaluate: ({ keyVersion, blindedElement, ...scope }) =>
      withSeed(keyVersion, (seed32) =>
        evaluateOprf({
          seed32,
          keyInfo: EMAIL_OTP_FACTOR_OPRF_KEY_INFO,
          blindedElement,
          info: emailOtpFactorOprfInfo(scope),
        }),
      ),
  };
}
