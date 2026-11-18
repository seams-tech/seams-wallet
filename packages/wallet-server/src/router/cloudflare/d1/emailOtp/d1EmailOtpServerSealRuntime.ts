import { toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import { createEmailOtpEnrollmentShamir3PassCipherAdapter } from '../../../../threshold/session/signingSessionSeal/crypto/cipher';
import type { EmailOtpServerSealRuntimeConfig } from '../auth/d1RouterApiAuthConfig';
import type {
  EmailOtpServerSealApplyRequest,
  EmailOtpServerSealRemoveRequest,
  EmailOtpServerSealResult as CoreEmailOtpServerSealResult,
  EmailOtpShamirCipherResult,
} from '../../../../core/authService/emailOtpSeal';

type EmailOtpServerSealResult = Readonly<CoreEmailOtpServerSealResult>;

type EmailOtpServerSealOperation =
  | {
      readonly cipherOperation: 'apply-server-seal';
      readonly thresholdSessionId: 'email-otp-enroll';
      readonly failureMessage: 'Failed to apply Email OTP server seal';
    }
  | {
      readonly cipherOperation: 'remove-server-seal';
      readonly thresholdSessionId: 'email-otp-unseal';
      readonly failureMessage: 'Failed to remove Email OTP server seal';
    };

const applyEmailOtpServerSealOperation: EmailOtpServerSealOperation = {
  cipherOperation: 'apply-server-seal',
  thresholdSessionId: 'email-otp-enroll',
  failureMessage: 'Failed to apply Email OTP server seal',
};

const removeEmailOtpServerSealOperation: EmailOtpServerSealOperation = {
  cipherOperation: 'remove-server-seal',
  thresholdSessionId: 'email-otp-unseal',
  failureMessage: 'Failed to remove Email OTP server seal',
};

export class CloudflareD1EmailOtpServerSealRuntime {
  private readonly cipherResult: EmailOtpShamirCipherResult;

  constructor(private readonly config: EmailOtpServerSealRuntimeConfig) {
    this.cipherResult = this.createCipher();
  }

  async removeEmailOtpServerSeal(
    input: EmailOtpServerSealRemoveRequest,
  ): Promise<EmailOtpServerSealResult> {
    const keyVersion = toOptionalTrimmedString(input.enrollmentSealKeyVersion);
    if (!keyVersion) {
      return failure('invalid_body', 'Missing enrollmentSealKeyVersion');
    }
    return await this.runServerSealOperation(
      input.wrappedCiphertext,
      removeEmailOtpServerSealOperation,
      keyVersion,
    );
  }

  /** The stored form of an Email OTP code: encrypted under a key from the seal root. */
  async sealEmailOtpCode(input: {
    readonly challengeId: string;
    readonly otpCode: string;
  }): Promise<
    | { readonly ok: true; readonly otpCodeSealedB64u: string }
    | { readonly ok: false; readonly code: string; readonly message: string }
  > {
    if (!this.config.configured) return failure('not_configured', this.config.message);
    try {
      return { ok: true, otpCodeSealedB64u: await this.config.codeSeal.seal(input) };
    } catch (error: unknown) {
      return failure(
        'not_configured',
        serverSealErrorMessage(error) || 'Email OTP code key is invalid',
      );
    }
  }

  /** Opens a stored code. A code sealed for another challenge does not open. */
  async openEmailOtpCode(input: {
    readonly challengeId: string;
    readonly otpCodeSealedB64u: string;
  }): Promise<
    | { readonly ok: true; readonly otpCode: string }
    | { readonly ok: false; readonly code: string; readonly message: string }
  > {
    if (!this.config.configured) return failure('not_configured', this.config.message);
    try {
      return { ok: true, otpCode: await this.config.codeSeal.open(input) };
    } catch {
      return failure('internal', 'Email OTP challenge code could not be opened');
    }
  }

  async applyEmailOtpServerSeal(
    input: EmailOtpServerSealApplyRequest,
  ): Promise<EmailOtpServerSealResult> {
    const shamir = this.cipherResult;
    if (!shamir.ok) return shamir;
    return await this.runServerSealOperation(
      input.wrappedCiphertext,
      applyEmailOtpServerSealOperation,
      shamir.keyVersion,
    );
  }

  private async runServerSealOperation(
    wrappedCiphertextRaw: unknown,
    operation: EmailOtpServerSealOperation,
    keyVersion: string,
  ): Promise<EmailOtpServerSealResult> {
    try {
      const wrappedCiphertext = toOptionalTrimmedString(wrappedCiphertextRaw);
      if (!wrappedCiphertext) {
        return failure('invalid_body', 'Missing wrappedCiphertext');
      }
      const shamir = this.cipherResult;
      if (!shamir.ok) return shamir;
      const result = await shamir.cipher.run({
        operation: operation.cipherOperation,
        thresholdSessionId: operation.thresholdSessionId,
        ciphertext: wrappedCiphertext,
        keyVersion,
        auth: { userId: 'email_otp' },
      });
      if (!result.ok) return result;
      return {
        ok: true,
        ciphertext: result.ciphertext,
        enrollmentSealKeyVersion: result.keyVersion || keyVersion,
      };
    } catch (error: unknown) {
      return failure('internal', serverSealErrorMessage(error) || operation.failureMessage);
    }
  }

  private createCipher(): EmailOtpShamirCipherResult {
    if (!this.config.configured) {
      return failure('not_configured', this.config.message);
    }
    try {
      const keyVersion = this.config.rootConfig.currentKeyVersion;
      return {
        ok: true,
        keyVersion,
        cipher: createEmailOtpEnrollmentShamir3PassCipherAdapter({
          config: this.config.rootConfig,
        }),
      };
    } catch (error: unknown) {
      return failure(
        'not_configured',
        serverSealErrorMessage(error) || 'Email OTP Shamir configuration is invalid',
      );
    }
  }
}

function serverSealErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}
