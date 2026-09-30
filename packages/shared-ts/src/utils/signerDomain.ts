import { EMAIL_OTP_CHANNEL } from './emailOtpDomain';
import { normalizeOptionalTrimmedString } from './normalize';

export const SIGNER_KINDS = {
  thresholdEd25519: 'threshold-ed25519',
  thresholdEcdsa: 'threshold-ecdsa',
} as const;

export type SignerKind = (typeof SIGNER_KINDS)[keyof typeof SIGNER_KINDS];

export const SIGNER_AUTH_METHODS = {
  passkey: 'passkey',
  emailOtp: EMAIL_OTP_CHANNEL,
} as const;

/** Authentication methods that can authorize a signer capability. */
export type SignerAuthMethod = (typeof SIGNER_AUTH_METHODS)[keyof typeof SIGNER_AUTH_METHODS];

export const WALLET_AUTH_METHODS = {
  passkey: 'passkey',
  emailOtp: EMAIL_OTP_CHANNEL,
} as const;

/** Authentication methods that can be enrolled on a wallet. */
export type WalletAuthMethod = (typeof WALLET_AUTH_METHODS)[keyof typeof WALLET_AUTH_METHODS];

const SIGNING_SESSION_RETENTIONS = {
  session: 'session',
  singleUse: 'single_use',
} as const;

export type SigningSessionRetention =
  (typeof SIGNING_SESSION_RETENTIONS)[keyof typeof SIGNING_SESSION_RETENTIONS];

const SIGNING_SESSION_POLICIES = {
  session: 'session',
  perOperation: 'per_operation',
} as const;

export type SigningSessionPolicy =
  (typeof SIGNING_SESSION_POLICIES)[keyof typeof SIGNING_SESSION_POLICIES];

export const SENSITIVE_OPERATION_POLICIES = {
  inheritSessionPolicy: 'inherit_session_policy',
  requireFreshSameMethod: 'require_fresh_same_method',
  requirePasskey: 'require_passkey',
  denyEmailOtp: 'deny_email_otp',
} as const;

export type SensitiveOperationPolicy =
  (typeof SENSITIVE_OPERATION_POLICIES)[keyof typeof SENSITIVE_OPERATION_POLICIES];

export const SIGNER_SOURCES = {
  passkeyRegistration: 'passkey_registration',
  emailOtpRegistration: 'email_otp_registration',
  selfHostedImport: 'self_hosted_import',
} as const;

export type SignerSource = (typeof SIGNER_SOURCES)[keyof typeof SIGNER_SOURCES];

const WALLET_AUTH_METHOD_VALUES = Object.values(WALLET_AUTH_METHODS) as readonly WalletAuthMethod[];

function normalized(value: unknown): string {
  return normalizeOptionalTrimmedString(value)?.toLowerCase() || '';
}

export function isWalletAuthMethod(value: unknown): value is WalletAuthMethod {
  return (WALLET_AUTH_METHOD_VALUES as readonly string[]).includes(normalized(value));
}
