import type { ThresholdRuntimePolicyScope } from './types';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import {
  EMAIL_OTP_CHANNEL,
  WALLET_EMAIL_OTP_ACTIONS,
  WALLET_EMAIL_OTP_DEVICE_LINK_OPERATION,
  WALLET_EMAIL_OTP_REGISTRATION_OPERATION,
  WALLET_EMAIL_OTP_UNLOCK_OPERATION,
  isWalletEmailOtpLoginOperation,
} from '@shared/utils/emailOtpDomain';
import type {
  EmailOtpChallengeRecord,
  EmailOtpGrantRecord,
  EmailOtpUnlockChallengeRecord,
  GoogleEmailOtpRegistrationAttemptRecord,
  GoogleEmailOtpRegistrationAttemptScopeInput,
  PendingGoogleEmailOtpRegistrationAttemptRecord,
} from './EmailOtpStores';

/** Parses JSON text; any other value, and text that is not JSON, comes back unchanged. */
function parseJsonRecord(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toPositiveSafeInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toNonNegativeSafeInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseCurrentEmailOtpChallengeRecord(raw: unknown): EmailOtpChallengeRecord | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const version = toOptionalTrimmedString(obj.version);
  const challengeId = toOptionalTrimmedString(obj.challengeId);
  const challengeSubjectId = toOptionalTrimmedString(obj.challengeSubjectId);
  const walletId = toOptionalTrimmedString(obj.walletId);
  const orgId = toOptionalTrimmedString(obj.orgId) || undefined;
  const otpChannel = toOptionalTrimmedString(obj.otpChannel);
  const email = toOptionalTrimmedString(obj.email);
  const otpCode = toOptionalTrimmedString(obj.otpCode);
  const ownerProofBindingDigest = toOptionalTrimmedString(obj.ownerProofBindingDigest);
  const action = toOptionalTrimmedString(obj.action);
  const operationRaw = toOptionalTrimmedString(obj.operation);
  const createdAtMs = toPositiveSafeInt(obj.createdAtMs);
  const expiresAtMs = toPositiveSafeInt(obj.expiresAtMs);
  const attemptCount = toNonNegativeSafeInt(obj.attemptCount);
  const maxAttempts = toPositiveSafeInt(obj.maxAttempts);
  if (version !== 'email_otp_challenge_v1') return null;
  if (
    !challengeId ||
    !challengeSubjectId ||
    !walletId ||
    !email ||
    !otpCode ||
    !ownerProofBindingDigest ||
    !action ||
    !operationRaw ||
    !createdAtMs ||
    !expiresAtMs ||
    attemptCount == null ||
    !maxAttempts
  ) {
    return null;
  }
  if (otpChannel !== EMAIL_OTP_CHANNEL) return null;
  if (
    action !== WALLET_EMAIL_OTP_ACTIONS.login &&
    action !== WALLET_EMAIL_OTP_ACTIONS.registration &&
    action !== WALLET_EMAIL_OTP_ACTIONS.recoveryBootstrap &&
    action !== WALLET_EMAIL_OTP_ACTIONS.deviceLink
  ) {
    return null;
  }
  const operation =
    isWalletEmailOtpLoginOperation(operationRaw) ||
    operationRaw === WALLET_EMAIL_OTP_REGISTRATION_OPERATION ||
    operationRaw === WALLET_EMAIL_OTP_UNLOCK_OPERATION ||
    operationRaw === WALLET_EMAIL_OTP_DEVICE_LINK_OPERATION
      ? operationRaw
      : null;
  if (!operation) return null;
  return {
    version: 'email_otp_challenge_v1',
    challengeId,
    challengeSubjectId,
    walletId,
    ...(orgId ? { orgId } : {}),
    otpChannel: EMAIL_OTP_CHANNEL,
    email,
    otpCode,
    ownerProofBindingDigest,
    action,
    operation,
    createdAtMs,
    expiresAtMs,
    attemptCount,
    maxAttempts,
  };
}

export function parseCurrentEmailOtpChallengeRow(input: {
  recordJson: unknown;
  expiresAtMs: unknown;
}): EmailOtpChallengeRecord | null {
  const record = parseCurrentEmailOtpChallengeRecord(input.recordJson);
  const expiresAtMs = toPositiveSafeInt(input.expiresAtMs);
  if (!record || !expiresAtMs) return null;
  if (record.expiresAtMs !== expiresAtMs) return null;
  return record;
}

function parseCurrentEmailOtpGrantRecord(raw: unknown): EmailOtpGrantRecord | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const version = toOptionalTrimmedString(obj.version);
  const grantToken = toOptionalTrimmedString(obj.grantToken);
  const userId = toOptionalTrimmedString(obj.userId);
  const walletId = toOptionalTrimmedString(obj.walletId);
  const orgId = toOptionalTrimmedString(obj.orgId) || undefined;
  const challengeId = toOptionalTrimmedString(obj.challengeId);
  const otpChannel = toOptionalTrimmedString(obj.otpChannel);
  const ownerProofBindingDigest = toOptionalTrimmedString(obj.ownerProofBindingDigest);
  const action = toOptionalTrimmedString(obj.action);
  const issuedAtMs = toPositiveSafeInt(obj.issuedAtMs);
  const expiresAtMs = toPositiveSafeInt(obj.expiresAtMs);
  if (
    version !== 'email_otp_grant_v1' ||
    !grantToken ||
    !userId ||
    !walletId ||
    !challengeId ||
    !ownerProofBindingDigest ||
    !action ||
    !issuedAtMs ||
    !expiresAtMs
  ) {
    return null;
  }
  if (otpChannel !== EMAIL_OTP_CHANNEL) return null;
  if (
    action !== WALLET_EMAIL_OTP_ACTIONS.unseal &&
    action !== WALLET_EMAIL_OTP_ACTIONS.recoveryBootstrap
  ) {
    return null;
  }
  return {
    version: 'email_otp_grant_v1',
    grantToken,
    userId,
    walletId,
    ...(orgId ? { orgId } : {}),
    challengeId,
    otpChannel: EMAIL_OTP_CHANNEL,
    ownerProofBindingDigest,
    action,
    issuedAtMs,
    expiresAtMs,
  };
}

export function parseCurrentEmailOtpGrantRow(input: {
  recordJson: unknown;
  expiresAtMs: unknown;
}): EmailOtpGrantRecord | null {
  const record = parseCurrentEmailOtpGrantRecord(input.recordJson);
  const expiresAtMs = toPositiveSafeInt(input.expiresAtMs);
  if (!record || !expiresAtMs) return null;
  if (record.expiresAtMs !== expiresAtMs) return null;
  return record;
}

function parseCurrentEmailOtpUnlockChallengeRecord(
  raw: unknown,
): EmailOtpUnlockChallengeRecord | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const version = toOptionalTrimmedString(obj.version);
  const challengeId = toOptionalTrimmedString(obj.challengeId);
  const walletId = toOptionalTrimmedString(obj.walletId);
  const userId = toOptionalTrimmedString(obj.userId);
  const orgId = toOptionalTrimmedString(obj.orgId) || undefined;
  const challengeB64u = toOptionalTrimmedString(obj.challengeB64u);
  const createdAtMs = toPositiveSafeInt(obj.createdAtMs);
  const expiresAtMs = toPositiveSafeInt(obj.expiresAtMs);
  if (
    version !== 'email_otp_unlock_challenge_v1' ||
    !challengeId ||
    !walletId ||
    !userId ||
    !challengeB64u ||
    !createdAtMs ||
    !expiresAtMs
  ) {
    return null;
  }
  return {
    version: 'email_otp_unlock_challenge_v1',
    challengeId,
    walletId,
    userId,
    ...(orgId ? { orgId } : {}),
    challengeB64u,
    createdAtMs,
    expiresAtMs,
  };
}

export function parseCurrentEmailOtpUnlockChallengeRow(input: {
  recordJson: unknown;
  expiresAtMs: unknown;
}): EmailOtpUnlockChallengeRecord | null {
  const record = parseCurrentEmailOtpUnlockChallengeRecord(input.recordJson);
  const expiresAtMs = toPositiveSafeInt(input.expiresAtMs);
  if (!record || !expiresAtMs) return null;
  if (record.expiresAtMs !== expiresAtMs) return null;
  return record;
}

/** The scope as one comparable string, as D1 stores it in `runtime_policy_key`; empty when unset. */
export function runtimePolicyScopeKey(scope: ThresholdRuntimePolicyScope | undefined): string {
  if (!scope) return '';
  return `${scope.orgId}\n${scope.projectId}\n${scope.envId}\n${scope.signingRootVersion}`;
}

/** A started or key-finalized attempt, not yet expired, for the subject, email and runtime scope. */
function isLivePendingAttemptInScope(
  record: GoogleEmailOtpRegistrationAttemptRecord,
  input: Readonly<GoogleEmailOtpRegistrationAttemptScopeInput>,
): record is PendingGoogleEmailOtpRegistrationAttemptRecord {
  return (
    record.providerSubject === input.providerSubject &&
    record.email === input.email &&
    record.runtimePolicyScope?.orgId === input.orgId &&
    runtimePolicyScopeKey(record.runtimePolicyScope) ===
      runtimePolicyScopeKey(input.runtimePolicyScope) &&
    (record.state === 'started' || record.state === 'key_finalized') &&
    record.expiresAtMs > input.nowMs
  );
}

/** The pending attempt a registration with this owner binding resumes. */
export function registrationAttemptMatchesStartedScope(
  record: GoogleEmailOtpRegistrationAttemptRecord,
  input: Readonly<GoogleEmailOtpRegistrationAttemptScopeInput>,
): record is PendingGoogleEmailOtpRegistrationAttemptRecord {
  return (
    record.ownerProofBindingDigest === input.ownerProofBindingDigest &&
    isLivePendingAttemptInScope(record, input)
  );
}

/** A pending attempt that a registration with a new owner binding replaces. */
export function registrationAttemptMatchesReplacementScope(
  record: GoogleEmailOtpRegistrationAttemptRecord,
  input: Readonly<GoogleEmailOtpRegistrationAttemptScopeInput>,
): record is PendingGoogleEmailOtpRegistrationAttemptRecord {
  return (
    record.ownerProofBindingDigest !== input.ownerProofBindingDigest &&
    isLivePendingAttemptInScope(record, input)
  );
}
