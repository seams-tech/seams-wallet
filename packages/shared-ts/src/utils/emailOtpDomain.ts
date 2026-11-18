import { encodeSigningSessionHkdfTuple } from './signingSessionSeal';
import { isPlainObject } from './validation';

export const EMAIL_OTP_CHANNEL = 'email_otp' as const;

export const EMAIL_OTP_INITIAL_ENROLLMENT_VERSION = '1' as const;

export function emailOtpDeviceEnrollmentId(walletId: string, providerSubject: string): string {
  const normalizedWalletId = String(walletId || '').trim();
  const normalizedProviderSubject = String(providerSubject || '').trim();
  if (!normalizedWalletId || !normalizedProviderSubject) {
    throw new Error('Email OTP enrollment identity requires wallet and provider subject');
  }
  return `email-otp-device-enrollment-v1:${normalizedWalletId}:${normalizedProviderSubject}`;
}

/** The key info of the server's Email OTP factor key (RFC 9497 DeriveKeyPair). */
export const EMAIL_OTP_FACTOR_OPRF_KEY_INFO = new TextEncoder().encode(
  'seams/email-otp/factor-oprf/key/v1',
);

/**
 * The POPRF `info` of one Email OTP factor. The wallet, the enrollment and the
 * server-chosen factor nonce select the function, so an evaluation for one
 * enrollment never gives the factor of another.
 */
export function emailOtpFactorOprfInfo(input: {
  readonly walletId: string;
  readonly enrollmentId: string;
  readonly factorNonceB64u: string;
}): Uint8Array {
  return encodeSigningSessionHkdfTuple([
    'seams/email-otp/factor-oprf/info/v1',
    input.walletId,
    input.enrollmentId,
    input.factorNonceB64u,
  ]);
}

/** The most device factors that one release request carries for a wallet. */
export const EMAIL_OTP_DEVICE_FACTOR_LIMIT = 4;

/** A blinded device input for one stored factor nonce. */
export type EmailOtpDeviceFactorBlindV1 = {
  readonly factorNonceB64u: string;
  readonly blindedElementB64u: string;
};

/**
 * The server's evaluation of the device factor that matches its enrollment, and
 * the factor key S encrypted under the device's OPRF output.
 */
export type EmailOtpFactorEvaluationV1 = {
  readonly kind: 'email_otp_factor_evaluation_v1';
  readonly challengeId: string;
  readonly enrollmentId: string;
  readonly enrollmentSealKeyVersion: string;
  readonly factorNonceB64u: string;
  readonly publicKeyB64u: string;
  readonly evaluatedElementB64u: string;
  readonly proofB64u: string;
  readonly wrappedFactorB64u: string;
};

const EMAIL_OTP_FACTOR_EVALUATION_FIELDS = [
  'challengeId',
  'enrollmentId',
  'enrollmentSealKeyVersion',
  'factorNonceB64u',
  'publicKeyB64u',
  'evaluatedElementB64u',
  'proofB64u',
  'wrappedFactorB64u',
] as const;

/** Reads the server's factor evaluation. Other fields of the body are ignored. */
export function readEmailOtpFactorEvaluation(value: unknown): EmailOtpFactorEvaluationV1 {
  if (!isPlainObject(value) || value.kind !== 'email_otp_factor_evaluation_v1') {
    throw new Error('Email OTP factor evaluation is missing');
  }
  const fields: Partial<Record<(typeof EMAIL_OTP_FACTOR_EVALUATION_FIELDS)[number], string>> = {};
  for (const field of EMAIL_OTP_FACTOR_EVALUATION_FIELDS) {
    const text = value[field];
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`Email OTP factor evaluation ${field} is missing`);
    }
    fields[field] = text.trim();
  }
  return { kind: 'email_otp_factor_evaluation_v1', ...fields } as EmailOtpFactorEvaluationV1;
}

/**
 * Reads up to `EMAIL_OTP_DEVICE_FACTOR_LIMIT` blinded device factors with
 * distinct nonces. An empty list is valid: the server then answers that this
 * device has no factor for the wallet.
 */
export function parseEmailOtpDeviceFactorBlinds(
  value: unknown,
): readonly EmailOtpDeviceFactorBlindV1[] | null {
  if (!Array.isArray(value) || value.length > EMAIL_OTP_DEVICE_FACTOR_LIMIT) {
    return null;
  }
  const nonces = new Set<string>();
  const blinds: EmailOtpDeviceFactorBlindV1[] = [];
  for (const item of value) {
    if (!isPlainObject(item) || Object.keys(item).length !== 2) return null;
    const { factorNonceB64u, blindedElementB64u } = item;
    if (typeof factorNonceB64u !== 'string' || typeof blindedElementB64u !== 'string') return null;
    if (!factorNonceB64u || !blindedElementB64u || nonces.has(factorNonceB64u)) return null;
    nonces.add(factorNonceB64u);
    blinds.push({ factorNonceB64u, blindedElementB64u });
  }
  return blinds;
}

const WALLET_UNLOCK_BACKENDS = ['passkey', EMAIL_OTP_CHANNEL] as const;

export type WalletUnlockBackend = (typeof WALLET_UNLOCK_BACKENDS)[number];

export type WalletEmailOtpChannel = typeof EMAIL_OTP_CHANNEL;

const WALLET_EMAIL_OTP_LOGIN_OPERATIONS = [
  'wallet_unlock',
  'transaction_sign',
  'export_key',
] as const;

export type WalletEmailOtpLoginOperation = (typeof WALLET_EMAIL_OTP_LOGIN_OPERATIONS)[number];

export const WALLET_EMAIL_OTP_REGISTRATION_OPERATION = 'registration' as const;

/** Linked-device enrollment: prove control of the wallet's enrolled email
 * destination to complete one device link. */
export const WALLET_EMAIL_OTP_DEVICE_LINK_OPERATION = 'device_link' as const;
export const WALLET_EMAIL_OTP_RELOCATION_OPERATION = 'wallet_relocation' as const;

export type WalletEmailOtpOperation =
  | WalletEmailOtpLoginOperation
  | typeof WALLET_EMAIL_OTP_REGISTRATION_OPERATION
  | typeof WALLET_EMAIL_OTP_DEVICE_LINK_OPERATION
  | typeof WALLET_EMAIL_OTP_RELOCATION_OPERATION;

export const WALLET_EMAIL_OTP_ACTIONS = {
  login: 'wallet_email_otp_login',
  registration: 'wallet_email_otp_registration',
  recoveryBootstrap: 'wallet_email_otp_recovery_bootstrap',
  unseal: 'wallet_email_otp_unseal',
  deviceLink: 'wallet_email_otp_device_link',
  relocation: 'wallet_email_otp_relocation',
} as const;

export type WalletEmailOtpAction =
  (typeof WALLET_EMAIL_OTP_ACTIONS)[keyof typeof WALLET_EMAIL_OTP_ACTIONS];

export const WALLET_EMAIL_OTP_EXPORT_OPERATION = 'export_key' as const;
export const WALLET_EMAIL_OTP_UNLOCK_OPERATION = 'wallet_unlock' as const;
export const WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION = 'transaction_sign' as const;

export type WalletEmailOtpExportOperation = typeof WALLET_EMAIL_OTP_EXPORT_OPERATION;
export type WalletEmailOtpTransactionSignOperation =
  typeof WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION;

export function isWalletUnlockBackend(value: string): value is WalletUnlockBackend {
  return (WALLET_UNLOCK_BACKENDS as readonly string[]).includes(value);
}

export function isWalletEmailOtpLoginOperation(
  value: string,
): value is WalletEmailOtpLoginOperation {
  return (WALLET_EMAIL_OTP_LOGIN_OPERATIONS as readonly string[]).includes(value);
}
