import type { EmailOtpFactorOprf } from './emailOtpFactorOprf';

export type { EmailOtpFactorOprf };

/** The wallet and the enrollment of one Email OTP factor. */
type EmailOtpFactorScope = {
  readonly walletId: string;
  readonly enrollmentId: string;
};

export type EmailOtpFactorEnrollRequest = EmailOtpFactorScope & {
  readonly blindedElementB64u?: unknown;
};

/** The server reads every field but the blinded element from its own enrollment record. */
export type EmailOtpFactorEvaluateRequest = EmailOtpFactorScope & {
  readonly factorNonceB64u: string;
  readonly enrollmentSealKeyVersion: string;
  readonly blindedElementB64u?: unknown;
};

type EmailOtpFactorEvaluation = {
  readonly publicKeyB64u: string;
  readonly evaluatedElementB64u: string;
  readonly proofB64u: string;
};

type EmailOtpFactorFailure = {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
};

export type EmailOtpFactorEnrollResult =
  | ({
      readonly ok: true;
      readonly enrollmentSealKeyVersion: string;
      readonly factorNonceB64u: string;
    } & EmailOtpFactorEvaluation)
  | EmailOtpFactorFailure;

export type EmailOtpFactorEvaluateResult =
  ({ readonly ok: true } & EmailOtpFactorEvaluation) | EmailOtpFactorFailure;
