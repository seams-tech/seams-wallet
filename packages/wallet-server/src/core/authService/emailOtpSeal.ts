import type { SigningSessionSealCipherAdapter } from '../../threshold/session/signingSessionSeal/signingSessionSeal.types';

export type EmailOtpShamirCipherResult =
  | {
      readonly ok: true;
      readonly keyVersion: string;
      readonly cipher: SigningSessionSealCipherAdapter;
    }
  | {
      readonly ok: false;
      readonly code: 'not_configured';
      readonly message: string;
    };

export type EmailOtpServerSealRequest = {
  readonly wrappedCiphertext?: unknown;
};

export type EmailOtpServerSealResult =
  | { ok: true; ciphertext: string; enrollmentSealKeyVersion: string }
  | { ok: false; code: string; message: string };
