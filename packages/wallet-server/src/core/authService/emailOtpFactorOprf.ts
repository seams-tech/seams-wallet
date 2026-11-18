import {
  EMAIL_OTP_FACTOR_OPRF_KEY_INFO,
  emailOtpFactorOprfInfo,
} from '@shared/utils/emailOtpDomain';
import { createOprfKeyring } from '../oprfKeyring';

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

export function createEmailOtpFactorOprf(input: {
  readonly rootSecretB64u: string;
  readonly currentKeyVersion: string;
  readonly acceptedKeyVersions: readonly string[];
}): EmailOtpFactorOprf {
  const keyring = createOprfKeyring({
    label: 'Email OTP',
    rootSecretB64u: input.rootSecretB64u,
    seedContext: ['seams/email-otp/factor-oprf', 'poprf-ristretto255-sha512/v1'],
    keyInfo: EMAIL_OTP_FACTOR_OPRF_KEY_INFO,
    currentKeyVersion: input.currentKeyVersion,
    acceptedKeyVersions: input.acceptedKeyVersions,
  });
  return {
    currentKeyVersion: keyring.currentKeyVersion,
    publicKey: keyring.publicKey,
    evaluate: ({ keyVersion, blindedElement, ...scope }) =>
      keyring.evaluate({ keyVersion, blindedElement, info: emailOtpFactorOprfInfo(scope) }),
  };
}
