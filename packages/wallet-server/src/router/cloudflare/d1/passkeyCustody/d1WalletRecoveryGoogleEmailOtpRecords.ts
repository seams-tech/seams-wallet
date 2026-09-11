import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { parseDeviceId, type DeviceId } from '@shared/authorization/capabilityKinds';
import {
  parsePasskeyEnvelopeId,
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseWalletRecoveryOperationId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type PasskeyEnvelopeId,
  type WalletAuthMethodId,
  type WalletAuthorityBindingDigest,
  type WalletAuthorityId,
  type WalletId,
  type WalletRecoveryOperationId,
  type WebAuthnCredentialIdB64u,
  type WebAuthnRpId,
} from '@shared/utils/domainIds';
import { parseEnvelopeRevision, type EnvelopeRevision } from '@shared/passkey-custody';
import { parseWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import {
  parseWalletAuthMethodRecordV2,
  type WalletAuthMethodRecordV2,
} from '@shared/utils/registrationIntent';
import {
  parseRecoveryCodeReservationId,
  type RecoveryCodeReservationId,
} from '@shared/wallet-recovery/recoveryCodeReservation';
import type {
  WebAuthnRecoveryContinuityAnchorRecord,
  WebAuthnRecoveryContinuityEnvelopeAnchorRecord,
} from '../webauthn/d1WebAuthnRecords';

export type WalletRecoveryGoogleEmailOtpTargetV1 = {
  readonly kind: 'google_email_otp';
  readonly googleProvider: 'google';
};

export type WalletRecoveryGoogleEmailOtpTargetEnrollmentV1 =
  | {
      readonly kind: 'existing';
      readonly enrollmentId: string;
      readonly enrollmentSealKeyVersion: string;
    }
  | {
      readonly kind: 'create';
      readonly providerSubject: string;
      readonly verifiedEmail: string;
    };

type WalletRecoveryGoogleEmailOtpAttemptCommonV1 = {
  readonly version: 'wallet_recovery_google_email_otp_attempt_v1';
  readonly walletId: WalletId;
  readonly orgId: string;
  readonly reservationId: RecoveryCodeReservationId;
  readonly recoveryOperationId: WalletRecoveryOperationId;
  readonly targetDeviceId: DeviceId;
  readonly targetAuthorityId: WalletAuthorityId;
  readonly targetWalletAuthMethodId: WalletAuthMethodId;
  readonly target: WalletRecoveryGoogleEmailOtpTargetV1;
  readonly continuityAnchor: WebAuthnRecoveryContinuityAnchorRecord;
  readonly recoverySetVersion: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
};

export type WalletRecoveryGoogleEmailOtpAttemptRecord =
  | (WalletRecoveryGoogleEmailOtpAttemptCommonV1 & {
      readonly state: 'prepared';
      readonly providerSubject?: never;
      readonly verifiedEmail?: never;
      readonly challengeId?: never;
      readonly ownerProofBindingDigest?: never;
      readonly targetEnrollment?: never;
    })
  | (WalletRecoveryGoogleEmailOtpAttemptCommonV1 & {
      readonly state: 'otp_issued';
      readonly providerSubject: string;
      readonly verifiedEmail: string;
      readonly challengeId: string;
      readonly ownerProofBindingDigest: DigestB64u;
      readonly targetEnrollment: WalletRecoveryGoogleEmailOtpTargetEnrollmentV1;
    })
  | (WalletRecoveryGoogleEmailOtpAttemptCommonV1 & {
      readonly state: 'otp_verified';
      readonly providerSubject: string;
      readonly verifiedEmail: string;
      readonly challengeId: string;
      readonly ownerProofBindingDigest: DigestB64u;
      readonly targetEnrollment: WalletRecoveryGoogleEmailOtpTargetEnrollmentV1;
    })
  | (WalletRecoveryGoogleEmailOtpAttemptCommonV1 & {
      readonly state: 'finalized';
      readonly providerSubject: string;
      readonly verifiedEmail: string;
      readonly challengeId: string;
      readonly ownerProofBindingDigest: DigestB64u;
      readonly targetEnrollment: WalletRecoveryGoogleEmailOtpTargetEnrollmentV1;
    });

export type PreparedWalletRecoveryGoogleEmailOtpAttempt = Extract<
  WalletRecoveryGoogleEmailOtpAttemptRecord,
  { readonly state: 'prepared' }
>;

export type OtpIssuedWalletRecoveryGoogleEmailOtpAttempt = Extract<
  WalletRecoveryGoogleEmailOtpAttemptRecord,
  { readonly state: 'otp_issued' }
>;

export type OtpVerifiedWalletRecoveryGoogleEmailOtpAttempt = Extract<
  WalletRecoveryGoogleEmailOtpAttemptRecord,
  { readonly state: 'otp_verified' }
>;

export type FinalizableWalletRecoveryGoogleEmailOtpAttempt = Extract<
  WalletRecoveryGoogleEmailOtpAttemptRecord,
  { readonly state: 'otp_verified' | 'finalized' }
>;

export type WalletRecoveryGoogleEmailOtpFinalizationInput = {
  readonly kind: 'wallet_recovery_google_email_otp_finalization_v1';
  readonly walletId: WalletId;
  readonly orgId: string;
  readonly reservationId: RecoveryCodeReservationId;
  readonly recoveryOperationId: WalletRecoveryOperationId;
  readonly targetDeviceId: DeviceId;
  readonly targetAuthorityId: WalletAuthorityId;
  readonly targetWalletAuthMethodId: WalletAuthMethodId;
  readonly challengeId: string;
  readonly providerSubject: string;
  readonly verifiedEmail: string;
  readonly ownerProofBindingDigest: DigestB64u;
  readonly targetEnrollment: WalletRecoveryGoogleEmailOtpTargetEnrollmentV1;
};

export function walletRecoveryGoogleEmailOtpAttemptKey(
  recoveryOperationId: WalletRecoveryOperationId,
): string {
  return `recovery-operation:${String(recoveryOperationId)}`;
}

export function buildPreparedWalletRecoveryGoogleEmailOtpAttempt(input: {
  readonly walletId: WalletId;
  readonly orgId: string;
  readonly reservationId: RecoveryCodeReservationId;
  readonly recoveryOperationId: WalletRecoveryOperationId;
  readonly targetDeviceId: DeviceId;
  readonly targetAuthorityId: WalletAuthorityId;
  readonly targetWalletAuthMethodId: WalletAuthMethodId;
  readonly continuityAnchor: WebAuthnRecoveryContinuityAnchorRecord;
  readonly recoverySetVersion: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}): PreparedWalletRecoveryGoogleEmailOtpAttempt {
  return {
    version: 'wallet_recovery_google_email_otp_attempt_v1',
    walletId: input.walletId,
    orgId: input.orgId,
    reservationId: input.reservationId,
    recoveryOperationId: input.recoveryOperationId,
    targetDeviceId: input.targetDeviceId,
    targetAuthorityId: input.targetAuthorityId,
    targetWalletAuthMethodId: input.targetWalletAuthMethodId,
    target: { kind: 'google_email_otp', googleProvider: 'google' },
    continuityAnchor: input.continuityAnchor,
    recoverySetVersion: input.recoverySetVersion,
    state: 'prepared',
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
  };
}

export function markWalletRecoveryGoogleEmailOtpAttemptIssued(input: {
  readonly attempt: PreparedWalletRecoveryGoogleEmailOtpAttempt;
  readonly providerSubject: string;
  readonly verifiedEmail: string;
  readonly challengeId: string;
  readonly ownerProofBindingDigest: DigestB64u;
  readonly targetEnrollment: WalletRecoveryGoogleEmailOtpTargetEnrollmentV1;
}): OtpIssuedWalletRecoveryGoogleEmailOtpAttempt {
  return {
    ...input.attempt,
    state: 'otp_issued',
    providerSubject: input.providerSubject,
    verifiedEmail: input.verifiedEmail,
    challengeId: input.challengeId,
    ownerProofBindingDigest: input.ownerProofBindingDigest,
    targetEnrollment: input.targetEnrollment,
  };
}

export function markWalletRecoveryGoogleEmailOtpAttemptVerified(
  attempt: OtpIssuedWalletRecoveryGoogleEmailOtpAttempt,
): OtpVerifiedWalletRecoveryGoogleEmailOtpAttempt {
  return { ...attempt, state: 'otp_verified' };
}

export function walletRecoveryGoogleEmailOtpFinalizationInput(
  attempt: FinalizableWalletRecoveryGoogleEmailOtpAttempt,
): WalletRecoveryGoogleEmailOtpFinalizationInput {
  return {
    kind: 'wallet_recovery_google_email_otp_finalization_v1',
    walletId: attempt.walletId,
    orgId: attempt.orgId,
    reservationId: attempt.reservationId,
    recoveryOperationId: attempt.recoveryOperationId,
    targetDeviceId: attempt.targetDeviceId,
    targetAuthorityId: attempt.targetAuthorityId,
    targetWalletAuthMethodId: attempt.targetWalletAuthMethodId,
    challengeId: attempt.challengeId,
    providerSubject: attempt.providerSubject,
    verifiedEmail: attempt.verifiedEmail,
    ownerProofBindingDigest: attempt.ownerProofBindingDigest,
    targetEnrollment: attempt.targetEnrollment,
  };
}

export function parseWalletRecoveryGoogleEmailOtpAttemptRecord(
  raw: unknown,
): WalletRecoveryGoogleEmailOtpAttemptRecord | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Readonly<Record<string, unknown>>;
  const expectedCommonFields = [
    'version',
    'walletId',
    'orgId',
    'reservationId',
    'recoveryOperationId',
    'targetDeviceId',
    'targetAuthorityId',
    'targetWalletAuthMethodId',
    'target',
    'continuityAnchor',
    'recoverySetVersion',
    'state',
    'createdAtMs',
    'expiresAtMs',
  ] as const;
  if (
    record.version !== 'wallet_recovery_google_email_otp_attempt_v1' ||
    !hasFields(record, expectedCommonFields) ||
    typeof record.orgId !== 'string' ||
    !record.orgId.trim() ||
    typeof record.recoverySetVersion !== 'string' ||
    !record.recoverySetVersion.trim()
  ) {
    return null;
  }
  const walletId = parseWalletId(record.walletId);
  const reservationId = parseRecoveryCodeReservationIdSafe(record.reservationId);
  const recoveryOperationId = parseWalletRecoveryOperationId(record.recoveryOperationId);
  const targetDeviceId = parseDeviceId(record.targetDeviceId);
  const targetAuthorityId = parseWalletAuthorityId(record.targetAuthorityId);
  const targetWalletAuthMethodId = parseWalletAuthMethodId(record.targetWalletAuthMethodId);
  const continuityAnchor = parseContinuityAnchor(record.continuityAnchor);
  const createdAtMs = parsePositiveMs(record.createdAtMs);
  const expiresAtMs = parsePositiveMs(record.expiresAtMs);
  const target = parseTarget(record.target);
  if (
    !walletId.ok ||
    !reservationId ||
    !recoveryOperationId.ok ||
    !targetDeviceId.ok ||
    !targetAuthorityId.ok ||
    !targetWalletAuthMethodId.ok ||
    !continuityAnchor ||
    !target ||
    createdAtMs === null ||
    expiresAtMs === null ||
    expiresAtMs <= createdAtMs ||
    continuityAnchor.method.walletId !== walletId.value ||
    continuityAnchor.envelope.walletId !== walletId.value
  ) {
    return null;
  }
  const common = {
    version: 'wallet_recovery_google_email_otp_attempt_v1' as const,
    walletId: walletId.value,
    orgId: record.orgId,
    reservationId,
    recoveryOperationId: recoveryOperationId.value,
    targetDeviceId: targetDeviceId.value,
    targetAuthorityId: targetAuthorityId.value,
    targetWalletAuthMethodId: targetWalletAuthMethodId.value,
    target,
    continuityAnchor,
    recoverySetVersion: record.recoverySetVersion,
    createdAtMs,
    expiresAtMs,
  };
  if (record.state === 'prepared') {
    if (!hasExactFields(record, [...expectedCommonFields])) return null;
    return { ...common, state: 'prepared' };
  }
  if (
    record.state !== 'otp_issued' &&
    record.state !== 'otp_verified' &&
    record.state !== 'finalized'
  ) {
    return null;
  }
  const fields = [
    ...expectedCommonFields,
    'providerSubject',
    'verifiedEmail',
    'challengeId',
    'ownerProofBindingDigest',
    'targetEnrollment',
  ];
  if (!hasExactFields(record, fields)) return null;
  const providerSubject = nonEmpty(record.providerSubject);
  const verifiedEmail = nonEmpty(record.verifiedEmail)?.toLowerCase();
  const challengeId = nonEmpty(record.challengeId);
  let ownerProofBindingDigest: DigestB64u;
  try {
    ownerProofBindingDigest = parseDigestB64u(record.ownerProofBindingDigest);
  } catch {
    return null;
  }
  const targetEnrollment = parseTargetEnrollment(record.targetEnrollment);
  if (!providerSubject || !verifiedEmail || !challengeId || !targetEnrollment) return null;
  return {
    ...common,
    state: record.state,
    providerSubject,
    verifiedEmail,
    challengeId,
    ownerProofBindingDigest,
    targetEnrollment,
  };
}

function parseContinuityAnchor(raw: unknown): WebAuthnRecoveryContinuityAnchorRecord | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Readonly<Record<string, unknown>>;
  if (!hasExactFields(record, ['kind', 'authority', 'method', 'envelope'])) return null;
  if (record.kind !== 'wallet_recovery_continuity_anchor_v1') return null;
  const authority = parseWalletAuthorityV1(record.authority);
  const method = parseWalletAuthMethodRecordV2(record.method);
  const envelope = parseContinuityEnvelope(record.envelope);
  if (
    !authority.ok ||
    authority.value.state !== 'active' ||
    !method ||
    method.status !== 'active' ||
    !envelope ||
    method.walletId !== authority.value.walletId ||
    method.walletAuthorityId !== authority.value.authorityId
  )
    return null;
  if (
    method.kind === 'passkey' &&
    (envelope.kind !== 'passkey' ||
      method.rpId !== envelope.rpId ||
      method.credentialIdB64u !== envelope.credentialIdB64u)
  )
    return null;
  if (method.kind === 'email_otp' && envelope.kind !== 'email_otp') return null;
  return {
    kind: 'wallet_recovery_continuity_anchor_v1',
    authority: authority.value,
    method,
    envelope,
  };
}

function parseContinuityEnvelope(
  raw: unknown,
): WebAuthnRecoveryContinuityEnvelopeAnchorRecord | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Readonly<Record<string, unknown>>;
  const commonFields = [
    'kind',
    'envelopeId',
    'walletId',
    'envelopeRevision',
    'updatedAtMs',
    'bindingKind',
  ] as const;
  if (!hasFields(record, commonFields)) return null;
  const envelopeId = parsePasskeyEnvelopeId(record.envelopeId);
  const walletId = parseWalletId(record.walletId);
  let envelopeRevision: EnvelopeRevision;
  try {
    envelopeRevision = parseEnvelopeRevision(
      record.envelopeRevision,
      'continuity envelope revision',
    );
  } catch {
    return null;
  }
  const updatedAtMs = parsePositiveMs(record.updatedAtMs);
  if (
    !envelopeId.ok ||
    !walletId.ok ||
    updatedAtMs === null ||
    record.bindingKind !== 'wallet_custody_seed_v1'
  )
    return null;
  if (record.kind === 'passkey') {
    if (!hasExactFields(record, [...commonFields, 'rpId', 'credentialIdB64u'])) return null;
    const rpId = parseWebAuthnRpId(record.rpId);
    const credentialIdB64u = parseWebAuthnCredentialIdB64u(record.credentialIdB64u);
    if (!rpId.ok || !credentialIdB64u.ok) return null;
    return {
      kind: 'passkey',
      envelopeId: envelopeId.value,
      walletId: walletId.value,
      rpId: rpId.value,
      credentialIdB64u: credentialIdB64u.value,
      envelopeRevision,
      updatedAtMs,
      bindingKind: 'wallet_custody_seed_v1',
    };
  }
  if (record.kind === 'email_otp') {
    if (!hasExactFields(record, [...commonFields, 'enrollmentId', 'enrollmentSealKeyVersion']))
      return null;
    const enrollmentId = nonEmpty(record.enrollmentId);
    const enrollmentSealKeyVersion = nonEmpty(record.enrollmentSealKeyVersion);
    if (!enrollmentId || !enrollmentSealKeyVersion) return null;
    return {
      kind: 'email_otp',
      envelopeId: envelopeId.value,
      walletId: walletId.value,
      enrollmentId,
      enrollmentSealKeyVersion,
      envelopeRevision,
      updatedAtMs,
      bindingKind: 'wallet_custody_seed_v1',
    };
  }
  return null;
}

function parseTarget(raw: unknown): WalletRecoveryGoogleEmailOtpTargetV1 | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Readonly<Record<string, unknown>>;
  return hasExactFields(record, ['kind', 'googleProvider']) &&
    record.kind === 'google_email_otp' &&
    record.googleProvider === 'google'
    ? { kind: 'google_email_otp', googleProvider: 'google' }
    : null;
}

function parseTargetEnrollment(
  raw: unknown,
): WalletRecoveryGoogleEmailOtpTargetEnrollmentV1 | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Readonly<Record<string, unknown>>;
  if (typeof record.kind !== 'string') return null;
  if (record.kind === 'existing') {
    if (!hasExactFields(record, ['kind', 'enrollmentId', 'enrollmentSealKeyVersion'])) return null;
    const enrollmentId = nonEmpty(record.enrollmentId);
    const enrollmentSealKeyVersion = nonEmpty(record.enrollmentSealKeyVersion);
    return enrollmentId && enrollmentSealKeyVersion
      ? { kind: 'existing', enrollmentId, enrollmentSealKeyVersion }
      : null;
  }
  if (record.kind === 'create') {
    if (!hasExactFields(record, ['kind', 'providerSubject', 'verifiedEmail'])) return null;
    const providerSubject = nonEmpty(record.providerSubject);
    const verifiedEmail = nonEmpty(record.verifiedEmail)?.toLowerCase();
    return providerSubject && verifiedEmail
      ? { kind: 'create', providerSubject, verifiedEmail }
      : null;
  }
  return null;
}

function parseRecoveryCodeReservationIdSafe(raw: unknown): RecoveryCodeReservationId | null {
  try {
    return parseRecoveryCodeReservationId(raw);
  } catch {
    return null;
  }
}

function parsePositiveMs(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

function nonEmpty(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function hasExactFields(
  record: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  return (
    actual.length === expected.length && actual.every((field, index) => field === expected[index])
  );
}

function hasFields(record: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean {
  return fields.every((field) => Object.hasOwn(record, field));
}

export type {
  WalletAuthMethodId,
  WalletAuthorityBindingDigest,
  WalletAuthorityId,
  WalletId,
  WebAuthnCredentialIdB64u,
  WebAuthnRpId,
};
