import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import type { EmailOtpServerSealRuntimeConfig } from '../auth/d1RouterApiAuthConfig';
import type {
  EmailOtpFactorEnrollRequest,
  EmailOtpFactorEnrollResult,
  EmailOtpFactorEvaluateRequest,
  EmailOtpFactorEvaluateResult,
} from '../../../../core/authService/emailOtpSeal';

const FACTOR_NONCE_BYTES = 32;

/**
 * The server keys of Email OTP: the factor key of the device-held factor
 * (an RFC 9497 POPRF) and the key that encrypts stored email codes.
 */
export class CloudflareD1EmailOtpServerSealRuntime {
  constructor(private readonly config: EmailOtpServerSealRuntimeConfig) {}

  /**
   * Starts a new factor. The server picks the factor nonce, so this route can
   * never evaluate the function of an enrollment that exists.
   */
  async enrollEmailOtpFactor(
    input: EmailOtpFactorEnrollRequest,
  ): Promise<EmailOtpFactorEnrollResult> {
    if (!this.config.configured) return failure('not_configured', this.config.message);
    const blindedElement = readBlindedElement(input.blindedElementB64u);
    if (!blindedElement) return failure('invalid_body', 'Missing or invalid blindedElementB64u');
    const factorOprf = this.config.factorOprf;
    const keyVersion = factorOprf.currentKeyVersion;
    const factorNonceB64u = base64UrlEncode(
      crypto.getRandomValues(new Uint8Array(FACTOR_NONCE_BYTES)),
    );
    try {
      const [publicKey, evaluation] = await Promise.all([
        factorOprf.publicKey(keyVersion),
        factorOprf.evaluate({
          keyVersion,
          walletId: input.walletId,
          enrollmentId: input.enrollmentId,
          factorNonceB64u,
          blindedElement,
        }),
      ]);
      return {
        ok: true,
        enrollmentSealKeyVersion: keyVersion,
        factorNonceB64u,
        publicKeyB64u: base64UrlEncode(publicKey),
        evaluatedElementB64u: base64UrlEncode(evaluation.evaluatedElement),
        proofB64u: base64UrlEncode(evaluation.proof),
      };
    } catch (error: unknown) {
      return evaluationFailure(error);
    }
  }

  /** Evaluates the factor of a stored enrollment for a blinded element from its device. */
  async evaluateEmailOtpFactor(
    input: EmailOtpFactorEvaluateRequest,
  ): Promise<EmailOtpFactorEvaluateResult> {
    if (!this.config.configured) return failure('not_configured', this.config.message);
    const blindedElement = readBlindedElement(input.blindedElementB64u);
    if (!blindedElement) return failure('invalid_body', 'Missing or invalid blindedElementB64u');
    const factorOprf = this.config.factorOprf;
    try {
      const [publicKey, evaluation] = await Promise.all([
        factorOprf.publicKey(input.enrollmentSealKeyVersion),
        factorOprf.evaluate({
          keyVersion: input.enrollmentSealKeyVersion,
          walletId: input.walletId,
          enrollmentId: input.enrollmentId,
          factorNonceB64u: input.factorNonceB64u,
          blindedElement,
        }),
      ]);
      return {
        ok: true,
        publicKeyB64u: base64UrlEncode(publicKey),
        evaluatedElementB64u: base64UrlEncode(evaluation.evaluatedElement),
        proofB64u: base64UrlEncode(evaluation.proof),
      };
    } catch (error: unknown) {
      return evaluationFailure(error);
    }
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
}

function readBlindedElement(value: unknown): Uint8Array | null {
  const encoded = toOptionalTrimmedString(value);
  if (!encoded) return null;
  try {
    const bytes = base64UrlDecode(encoded);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

function evaluationFailure(error: unknown) {
  const message = serverSealErrorMessage(error);
  if (/blinded element/i.test(message)) {
    return failure('invalid_body', 'The blinded element is not a valid group element');
  }
  return failure('internal', message || 'Email OTP factor evaluation failed');
}

function serverSealErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}
