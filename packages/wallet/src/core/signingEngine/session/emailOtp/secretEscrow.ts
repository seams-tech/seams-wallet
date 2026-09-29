import { decodeSigningSessionSecret32 } from '@shared/utils/signingSessionSeal';

const EMAIL_OTP_ESCROW_SECRET_LENGTH = 32 as const;

type EmailOtpEscrowSecret32 = {
  readonly kind: 'secret32';
  readonly secret32: Uint8Array;
};

type EmailOtpCorruptLocalCustodyFailure = {
  readonly kind: 'corrupt_local_custody';
  readonly ok: false;
  readonly code: 'corrupt_local_custody';
  readonly reason: 'invalid_escrow_plaintext_length';
  readonly expectedLength: typeof EMAIL_OTP_ESCROW_SECRET_LENGTH;
  readonly actualLength: number;
  readonly message: string;
};

export type EmailOtpEscrowSecret32DecodeResult =
  | EmailOtpEscrowSecret32
  | EmailOtpCorruptLocalCustodyFailure;

function corruptPlaintextLength(actualLength: number): EmailOtpCorruptLocalCustodyFailure {
  return {
    kind: 'corrupt_local_custody',
    ok: false,
    code: 'corrupt_local_custody',
    reason: 'invalid_escrow_plaintext_length',
    expectedLength: EMAIL_OTP_ESCROW_SECRET_LENGTH,
    actualLength,
    message: `Email OTP local custody plaintext has invalid length: expected at most 32 bytes, received ${actualLength}`,
  };
}

export function decodeEmailOtpEscrowSecret32(
  plaintext: Uint8Array,
): EmailOtpEscrowSecret32DecodeResult {
  const secret32 = decodeSigningSessionSecret32(plaintext);
  if (!secret32) return corruptPlaintextLength(plaintext.length);
  return { kind: 'secret32', secret32 };
}
