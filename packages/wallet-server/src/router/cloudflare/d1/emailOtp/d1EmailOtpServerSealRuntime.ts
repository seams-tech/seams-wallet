import { toOptionalTrimmedString } from '@shared/utils/validation';
import { createSigningSessionSealShamir3PassCipherAdapter } from '../../../../threshold/session/signingSessionSeal/crypto/cipher';
import type { EmailOtpServerSealRuntimeConfig } from '../auth/d1RouterApiAuthConfig';
import type {
  EmailOtpServerSealRequest,
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
    input: EmailOtpServerSealRequest,
  ): Promise<EmailOtpServerSealResult> {
    return await this.runServerSealOperation(input, removeEmailOtpServerSealOperation);
  }

  async applyEmailOtpServerSeal(
    input: EmailOtpServerSealRequest,
  ): Promise<EmailOtpServerSealResult> {
    return await this.runServerSealOperation(input, applyEmailOtpServerSealOperation);
  }

  private async runServerSealOperation(
    input: EmailOtpServerSealRequest,
    operation: EmailOtpServerSealOperation,
  ): Promise<EmailOtpServerSealResult> {
    try {
      const wrappedCiphertext = toOptionalTrimmedString(input.wrappedCiphertext);
      if (!wrappedCiphertext) {
        return {
          ok: false,
          code: 'invalid_body',
          message: 'Missing wrappedCiphertext',
        };
      }
      const shamir = this.cipherResult;
      if (!shamir.ok) return shamir;
      const result = await shamir.cipher.run({
        operation: operation.cipherOperation,
        thresholdSessionId: operation.thresholdSessionId,
        ciphertext: wrappedCiphertext,
        keyVersion: shamir.keyVersion,
        auth: { userId: 'email_otp' },
      });
      if (!result.ok) return result;
      return {
        ok: true,
        ciphertext: result.ciphertext,
        enrollmentSealKeyVersion: result.keyVersion || shamir.keyVersion,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'internal',
        message: serverSealErrorMessage(error) || operation.failureMessage,
      };
    }
  }

  private createCipher(): EmailOtpShamirCipherResult {
    if (!this.config.configured) {
      return {
        ok: false,
        code: 'not_configured',
        message: this.config.message,
      };
    }
    try {
      const keyVersion = this.config.rootConfig.currentKeyVersion;
      return {
        ok: true,
        keyVersion,
        cipher: createSigningSessionSealShamir3PassCipherAdapter({
          config: this.config.rootConfig,
        }),
      };
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'not_configured',
        message: serverSealErrorMessage(error) || 'Email OTP Shamir configuration is invalid',
      };
    }
  }
}

function serverSealErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}
