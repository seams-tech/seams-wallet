import type { EmailOtpEnrollmentSealCipher } from '../../threshold/session/signingSessionSeal/crypto/cipher';

export type EmailOtpShamirCipherResult =
  | {
      readonly ok: true;
      readonly keyVersion: string;
      readonly cipher: EmailOtpEnrollmentSealCipher;
    }
  | {
      readonly ok: false;
      readonly code: 'not_configured';
      readonly message: string;
    };

/** The wallet and the enrollment choose the seal key, so a seal opens only for its own wallet. */
export type EmailOtpServerSealApplyRequest = {
  readonly walletId: string;
  readonly enrollmentId: string;
  readonly wrappedCiphertext?: unknown;
};

export type EmailOtpServerSealRemoveRequest = EmailOtpServerSealApplyRequest & {
  readonly enrollmentSealKeyVersion: string;
};

export type EmailOtpServerSealResult =
  | { ok: true; ciphertext: string; enrollmentSealKeyVersion: string }
  | { ok: false; code: string; message: string };
