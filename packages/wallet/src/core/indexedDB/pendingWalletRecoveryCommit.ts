import { parseDeviceId, type DeviceId } from '@shared/authorization/capabilityKinds';
import {
  isActiveRecoveredWalletAuthorityV1,
  parseWalletAuthorityV1,
  type ActiveRecoveredWalletAuthorityV1,
  type WalletEcdsaSignerActivationV1,
  type WalletEd25519SignerActivationV1,
  type WalletSignerActivationSetV1,
} from '@shared/authorization/walletAuthority';
import {
  mpcMaterialActivationRefsEqual,
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseWalletRecoveryOperationId,
  parseEmailOtpProviderUserId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type EmailOtpProviderUserId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletId,
  type WalletRecoveryOperationId,
  type WebAuthnCredentialIdB64u,
  type WebAuthnRpId,
} from '@shared/utils/domainIds';
import {
  parseWalletAuthMethodRecordV2,
  sameWalletAuthMethodRecordV2,
  type WalletAuthMethodRecordV2,
} from '@shared/utils/registrationIntent';
import {
  parseRecoveryCodeReservationId,
  type RecoveryCodeReservationId,
} from '@shared/wallet-recovery/recoveryCodeReservation';
import {
  parseWalletRecoveryCommittedProjectionV1,
  type WalletRecoveryCommittedProjectionExpectationV1,
  type WalletRecoveryCommittedProjectionV1,
  type WalletRecoveryEmailOtpEnrollmentReferenceV1,
} from '@shared/wallet-recovery/walletRecoveryCommittedProjection';

const RECORD_KIND = 'pending_wallet_recovery_commit_v1' as const;
const RECORD_VERSION = 1 as const;
const APP_STATE_PREFIX = `${RECORD_KIND}:`;
const AES_GCM_IV_BYTES = 12;
const PENDING_RECOVERY_PROJECTION_FIELDS = [
  'version',
  'kind',
  'storeVersion',
  'walletId',
  'recoveryOperationId',
  'targetDeviceId',
  'targetAuthorityId',
  'targetWalletAuthMethodId',
  'authority',
  'authMethod',
  'target',
] as const;
const PENDING_RECOVERY_PASSKEY_AUTH_METHOD_FIELDS = [
  'version',
  'walletAuthMethodId',
  'walletId',
  'walletAuthorityId',
  'kind',
  'status',
  'createdAtMs',
  'updatedAtMs',
  'rpId',
  'credentialIdB64u',
  'credentialPublicKeyB64u',
  'counter',
  'activatedAtMs',
] as const;
const PENDING_RECOVERY_EMAIL_OTP_AUTH_METHOD_FIELDS = [
  'version',
  'walletAuthMethodId',
  'walletId',
  'walletAuthorityId',
  'kind',
  'status',
  'createdAtMs',
  'updatedAtMs',
  'emailHashHex',
  'registrationAuthorityId',
  'activatedAtMs',
] as const;
const PENDING_RECOVERY_PASSKEY_TARGET_FIELDS = ['kind', 'rpId', 'credentialIdB64u'] as const;
const PENDING_RECOVERY_COMMIT_GOOGLE_EMAIL_OTP_TARGET_FIELDS = [
  'kind',
  'providerSubject',
  'emailHashHex',
  'registrationAuthorityId',
  'enrollment',
] as const;
const PENDING_RECOVERY_GOOGLE_EMAIL_OTP_TARGET_FIELDS = [
  'kind',
  'provider',
  'providerSubject',
  'emailHashHex',
  'registrationAuthorityId',
  'enrollment',
] as const;
const PENDING_RECOVERY_ENROLLMENT_FIELDS = [
  'kind',
  'enrollmentId',
  'enrollmentSealKeyVersion',
] as const;

/**
 * Local recovery material is carried as one encrypted envelope. The key is a
 * non-extractable WebCrypto key and the plaintext never enters IndexedDB.
 * Public projection identities remain outside the envelope for strict replay
 * matching.
 */
export type PendingWalletRecoveryEncryptedMaterialV1 = {
  readonly kind: 'wallet_recovery_encrypted_material_v1';
  readonly key: CryptoKey;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
};

export type PendingWalletRecoveryTargetIdentityV1 =
  | {
      readonly kind: 'passkey';
      readonly rpId: WebAuthnRpId;
      readonly credentialIdB64u: WebAuthnCredentialIdB64u;
    }
  | {
      readonly kind: 'google_email_otp';
      readonly providerSubject: EmailOtpProviderUserId;
      readonly emailHashHex: string;
      readonly registrationAuthorityId: string;
      readonly enrollment: WalletRecoveryEmailOtpEnrollmentReferenceV1;
    };

type PendingWalletRecoveryCommitCommonV1 = {
  readonly kind: typeof RECORD_KIND;
  readonly version: typeof RECORD_VERSION;
  readonly recoveryOperationId: WalletRecoveryOperationId;
  readonly walletId: WalletId;
  readonly reservationId: RecoveryCodeReservationId;
  readonly targetDeviceId: DeviceId;
  readonly targetAuthorityId: WalletAuthorityId;
  readonly targetWalletAuthMethodId: WalletAuthMethodId;
  readonly localMaterial: PendingWalletRecoveryEncryptedMaterialV1;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

type PendingWalletRecoveryCommitIdentityV1 = PendingWalletRecoveryCommitCommonV1 & {
  readonly target: PendingWalletRecoveryTargetIdentityV1;
};

export type PendingWalletRecoveryCommitV1 =
  | (PendingWalletRecoveryCommitIdentityV1 & {
      readonly stage: 'awaiting_server_promotion';
      readonly projection?: never;
    })
  | (PendingWalletRecoveryCommitCommonV1 & {
      readonly stage: 'server_promoted';
      readonly target: Extract<PendingWalletRecoveryTargetIdentityV1, { readonly kind: 'passkey' }>;
      readonly projection: Extract<
        WalletRecoveryCommittedProjectionV1,
        { readonly kind: 'passkey' }
      >;
    })
  | (PendingWalletRecoveryCommitCommonV1 & {
      readonly stage: 'server_promoted';
      readonly target: Extract<
        PendingWalletRecoveryTargetIdentityV1,
        { readonly kind: 'google_email_otp' }
      >;
      readonly projection: Extract<
        WalletRecoveryCommittedProjectionV1,
        { readonly kind: 'google_email_otp' }
      >;
    });

export type PendingWalletRecoveryCommitStorageRow = {
  readonly recovery_operation_id: WalletRecoveryOperationId;
  readonly stage: PendingWalletRecoveryCommitV1['stage'];
  readonly wallet_id: WalletId;
  readonly target_authority_id: WalletAuthorityId;
  readonly target_wallet_auth_method_id: WalletAuthMethodId;
  readonly updated_at_ms: number;
  readonly record: PendingWalletRecoveryCommitV1;
};

export type PendingWalletRecoveryPromotionAdvanceInputV1 = {
  readonly awaiting: Extract<
    PendingWalletRecoveryCommitV1,
    { readonly stage: 'awaiting_server_promotion' }
  >;
  readonly promoted: Extract<
    PendingWalletRecoveryCommitV1,
    { readonly stage: 'server_promoted' }
  >;
};

export function pendingWalletRecoveryCommitIdentityMatches(
  left: PendingWalletRecoveryCommitV1,
  right: PendingWalletRecoveryCommitV1,
): boolean {
  return (
    left.recoveryOperationId === right.recoveryOperationId &&
    left.walletId === right.walletId &&
    left.reservationId === right.reservationId &&
    left.targetDeviceId === right.targetDeviceId &&
    left.targetAuthorityId === right.targetAuthorityId &&
    left.targetWalletAuthMethodId === right.targetWalletAuthMethodId &&
    left.target.kind === right.target.kind &&
    (left.target.kind === 'passkey'
      ? right.target.kind === 'passkey' &&
        left.target.rpId === right.target.rpId &&
        left.target.credentialIdB64u === right.target.credentialIdB64u
      : right.target.kind === 'google_email_otp' &&
        left.target.providerSubject === right.target.providerSubject &&
        left.target.emailHashHex === right.target.emailHashHex &&
        left.target.registrationAuthorityId === right.target.registrationAuthorityId &&
        left.target.enrollment.enrollmentId === right.target.enrollment.enrollmentId &&
        left.target.enrollment.enrollmentSealKeyVersion ===
          right.target.enrollment.enrollmentSealKeyVersion) &&
    left.createdAtMs === right.createdAtMs
  );
}

export function pendingWalletRecoveryCommitAppStateKey(
  recoveryOperationId: WalletRecoveryOperationId,
): string {
  return `${APP_STATE_PREFIX}${String(recoveryOperationId)}`;
}

type PendingRecoveryObjectFields = ReadonlyMap<string, unknown>;

function decodeExactPendingRecoveryFields(
  value: unknown,
  expectedKeys: readonly string[],
): PendingRecoveryObjectFields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => !expectedKeys.includes(key))
  ) {
    return null;
  }
  const fields = new Map<string, unknown>();
  for (const key of actualKeys) fields.set(key, Reflect.get(value, key));
  return fields;
}

function readPendingRecoveryField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Reflect.get(value, key);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return null;
  return value;
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseRecoveryCodeReservationIdSafely(
  value: unknown,
): RecoveryCodeReservationId | null {
  try {
    return parseRecoveryCodeReservationId(value);
  } catch {
    return null;
  }
}

function isNonExtractableAesGcmKey(value: unknown): value is CryptoKey {
  return (
    typeof CryptoKey !== 'undefined' &&
    value instanceof CryptoKey &&
    value.type === 'secret' &&
    value.extractable === false &&
    value.algorithm.name === 'AES-GCM' &&
    value.usages.includes('encrypt') &&
    value.usages.includes('decrypt')
  );
}

function parseEncryptedMaterial(raw: unknown): PendingWalletRecoveryEncryptedMaterialV1 | null {
  const fields = decodeExactPendingRecoveryFields(raw, ['kind', 'key', 'iv', 'ciphertext']);
  if (!fields) return null;
  const key = fields.get('key');
  const iv = fields.get('iv');
  const ciphertext = fields.get('ciphertext');
  if (
    fields.get('kind') !== 'wallet_recovery_encrypted_material_v1' ||
    !isNonExtractableAesGcmKey(key) ||
    !(iv instanceof Uint8Array) ||
    iv.byteLength !== AES_GCM_IV_BYTES ||
    !(ciphertext instanceof Uint8Array) ||
    ciphertext.byteLength === 0
  ) {
    return null;
  }
  return {
    kind: 'wallet_recovery_encrypted_material_v1',
    key,
    iv,
    ciphertext,
  };
}

function parseEnrollmentReference(
  raw: unknown,
): WalletRecoveryEmailOtpEnrollmentReferenceV1 | null {
  const fields = decodeExactPendingRecoveryFields(raw, [
    'kind',
    'enrollmentId',
    'enrollmentSealKeyVersion',
  ]);
  if (!fields || fields.get('kind') !== 'email_otp_enrollment_reference_v1') return null;
  const enrollmentId = nonEmptyString(fields.get('enrollmentId'));
  const enrollmentSealKeyVersion = nonEmptyString(fields.get('enrollmentSealKeyVersion'));
  if (!enrollmentId || !enrollmentSealKeyVersion) return null;
  return {
    kind: 'email_otp_enrollment_reference_v1',
    enrollmentId,
    enrollmentSealKeyVersion,
  };
}

function parseTarget(raw: unknown): PendingWalletRecoveryTargetIdentityV1 | null {
  const kind = readPendingRecoveryField(raw, 'kind');
  if (kind === 'passkey') {
    const fields = decodeExactPendingRecoveryFields(raw, PENDING_RECOVERY_PASSKEY_TARGET_FIELDS);
    if (!fields) return null;
    const rpId = parseWebAuthnRpId(fields.get('rpId'));
    const credentialIdB64u = parseWebAuthnCredentialIdB64u(fields.get('credentialIdB64u'));
    return rpId.ok && credentialIdB64u.ok
      ? { kind: 'passkey', rpId: rpId.value, credentialIdB64u: credentialIdB64u.value }
      : null;
  }
  if (kind !== 'google_email_otp') return null;
  const fields = decodeExactPendingRecoveryFields(
    raw,
    PENDING_RECOVERY_COMMIT_GOOGLE_EMAIL_OTP_TARGET_FIELDS,
  );
  if (!fields) return null;
  const emailHashHex = fields.get('emailHashHex');
  if (typeof emailHashHex !== 'string' || !/^[0-9a-f]{64}$/.test(emailHashHex)) {
    return null;
  }
  const providerSubject = parseEmailOtpProviderUserId(fields.get('providerSubject'));
  const registrationAuthorityId = nonEmptyString(fields.get('registrationAuthorityId'));
  const enrollment = parseEnrollmentReference(fields.get('enrollment'));
  return providerSubject.ok && registrationAuthorityId && enrollment
    ? {
        kind: 'google_email_otp',
        providerSubject: providerSubject.value,
        emailHashHex,
        registrationAuthorityId,
        enrollment,
      }
    : null;
}

function projectionExpectation(
  record: PendingWalletRecoveryCommitIdentityV1,
): WalletRecoveryCommittedProjectionExpectationV1 {
  if (record.target.kind === 'passkey') {
    return {
      kind: 'passkey',
      walletId: record.walletId,
      recoveryOperationId: record.recoveryOperationId,
      targetDeviceId: record.targetDeviceId,
      targetAuthorityId: record.targetAuthorityId,
      targetWalletAuthMethodId: record.targetWalletAuthMethodId,
      rpId: record.target.rpId,
      credentialIdB64u: record.target.credentialIdB64u,
    };
  }
  return {
    kind: 'google_email_otp',
    walletId: record.walletId,
    recoveryOperationId: record.recoveryOperationId,
    targetDeviceId: record.targetDeviceId,
    targetAuthorityId: record.targetAuthorityId,
    targetWalletAuthMethodId: record.targetWalletAuthMethodId,
    providerSubject: record.target.providerSubject,
    emailHashHex: record.target.emailHashHex,
    registrationAuthorityId: record.target.registrationAuthorityId,
    enrollment: record.target.enrollment,
  };
}

export async function parsePendingWalletRecoveryCommitV1(
  raw: unknown,
): Promise<PendingWalletRecoveryCommitV1 | null> {
  const baseKeys = [
    'kind',
    'version',
    'stage',
    'recoveryOperationId',
    'walletId',
    'reservationId',
    'targetDeviceId',
    'targetAuthorityId',
    'targetWalletAuthMethodId',
    'target',
    'localMaterial',
    'createdAtMs',
    'updatedAtMs',
  ] as const;
  const stage = readPendingRecoveryField(raw, 'stage');
  const keys =
    stage === 'server_promoted'
      ? [...baseKeys, 'projection']
      : stage === 'awaiting_server_promotion'
        ? baseKeys
        : null;
  if (!keys) return null;
  const fields = decodeExactPendingRecoveryFields(raw, keys);
  if (!fields || fields.get('kind') !== RECORD_KIND || fields.get('version') !== RECORD_VERSION) {
    return null;
  }
  const recoveryOperationId = parseWalletRecoveryOperationId(fields.get('recoveryOperationId'));
  const walletId = parseWalletId(fields.get('walletId'));
  const reservationId = parseRecoveryCodeReservationIdSafely(fields.get('reservationId'));
  const targetDeviceId = parseDeviceId(fields.get('targetDeviceId'));
  const targetAuthorityId = parseWalletAuthorityId(fields.get('targetAuthorityId'));
  const targetWalletAuthMethodId = parseWalletAuthMethodId(
    fields.get('targetWalletAuthMethodId'),
  );
  const target = parseTarget(fields.get('target'));
  const localMaterial = parseEncryptedMaterial(fields.get('localMaterial'));
  const createdAtMs = positiveSafeInteger(fields.get('createdAtMs'));
  const updatedAtMs = positiveSafeInteger(fields.get('updatedAtMs'));
  if (
    !recoveryOperationId.ok ||
    !walletId.ok ||
    !reservationId ||
    !targetDeviceId.ok ||
    !targetAuthorityId.ok ||
    !targetWalletAuthMethodId.ok ||
    !target ||
    !localMaterial ||
    createdAtMs === null ||
    updatedAtMs === null ||
    updatedAtMs < createdAtMs
  ) {
    return null;
  }
  if (stage === 'awaiting_server_promotion') {
    return {
      kind: RECORD_KIND,
      version: RECORD_VERSION,
      stage,
      recoveryOperationId: recoveryOperationId.value,
      walletId: walletId.value,
      reservationId,
      targetDeviceId: targetDeviceId.value,
      targetAuthorityId: targetAuthorityId.value,
      targetWalletAuthMethodId: targetWalletAuthMethodId.value,
      target,
      localMaterial,
      createdAtMs,
      updatedAtMs,
    };
  }
  const identity: PendingWalletRecoveryCommitIdentityV1 = {
    kind: RECORD_KIND,
    version: RECORD_VERSION,
    recoveryOperationId: recoveryOperationId.value,
    walletId: walletId.value,
    reservationId,
    targetDeviceId: targetDeviceId.value,
    targetAuthorityId: targetAuthorityId.value,
    targetWalletAuthMethodId: targetWalletAuthMethodId.value,
    target,
    localMaterial,
    createdAtMs,
    updatedAtMs,
  };
  let projection: WalletRecoveryCommittedProjectionV1;
  try {
    projection = await parseWalletRecoveryCommittedProjectionV1(
      fields.get('projection'),
      projectionExpectation(identity),
    );
  } catch {
    return null;
  }
  if (projection.kind !== target.kind) return null;
  if (projection.kind === 'passkey' && target.kind === 'passkey') {
    return {
      kind: RECORD_KIND,
      version: RECORD_VERSION,
      stage: 'server_promoted',
      recoveryOperationId: identity.recoveryOperationId,
      walletId: identity.walletId,
      reservationId: identity.reservationId,
      targetDeviceId: identity.targetDeviceId,
      targetAuthorityId: identity.targetAuthorityId,
      targetWalletAuthMethodId: identity.targetWalletAuthMethodId,
      target,
      localMaterial: identity.localMaterial,
      createdAtMs: identity.createdAtMs,
      updatedAtMs: identity.updatedAtMs,
      projection,
    };
  }
  if (projection.kind === 'google_email_otp' && target.kind === 'google_email_otp') {
    return {
      kind: RECORD_KIND,
      version: RECORD_VERSION,
      stage: 'server_promoted',
      recoveryOperationId: identity.recoveryOperationId,
      walletId: identity.walletId,
      reservationId: identity.reservationId,
      targetDeviceId: identity.targetDeviceId,
      targetAuthorityId: identity.targetAuthorityId,
      targetWalletAuthMethodId: identity.targetWalletAuthMethodId,
      target,
      localMaterial: identity.localMaterial,
      createdAtMs: identity.createdAtMs,
      updatedAtMs: identity.updatedAtMs,
      projection,
    };
  }
  return null;
}

export async function buildPendingWalletRecoveryCommitV1(
  input: PendingWalletRecoveryCommitV1,
): Promise<PendingWalletRecoveryCommitV1> {
  const parsed = await parsePendingWalletRecoveryCommitV1(input);
  if (!parsed) throw new Error('pending wallet recovery commit is invalid');
  return parsed;
}

export type PendingWalletRecoveryCommitAppStateRow = {
  readonly key: string;
  readonly value: PendingWalletRecoveryCommitStorageRow;
};

export async function toPendingWalletRecoveryCommitAppStateRow(
  record: PendingWalletRecoveryCommitV1,
): Promise<PendingWalletRecoveryCommitAppStateRow> {
  const parsed = await buildPendingWalletRecoveryCommitV1(record);
  const value: PendingWalletRecoveryCommitStorageRow = {
    recovery_operation_id: parsed.recoveryOperationId,
    stage: parsed.stage,
    wallet_id: parsed.walletId,
    target_authority_id: parsed.targetAuthorityId,
    target_wallet_auth_method_id: parsed.targetWalletAuthMethodId,
    updated_at_ms: parsed.updatedAtMs,
    record: parsed,
  };
  return {
    key: pendingWalletRecoveryCommitAppStateKey(parsed.recoveryOperationId),
    value,
  };
}

export async function parsePendingWalletRecoveryCommitAppStateRow(
  raw: unknown,
): Promise<PendingWalletRecoveryCommitStorageRow | null> {
  const rowFields = decodeExactPendingRecoveryFields(raw, ['key', 'value']);
  if (!rowFields) return null;
  const key = rowFields.get('key');
  if (typeof key !== 'string' || !key.startsWith(APP_STATE_PREFIX)) return null;
  const valueFields = decodeExactPendingRecoveryFields(rowFields.get('value'), [
    'recovery_operation_id',
    'stage',
    'wallet_id',
    'target_authority_id',
    'target_wallet_auth_method_id',
    'updated_at_ms',
    'record',
  ]);
  if (!valueFields) return null;
  const record = await parsePendingWalletRecoveryCommitV1(valueFields.get('record'));
  if (!record) return null;
  if (
    key !== pendingWalletRecoveryCommitAppStateKey(record.recoveryOperationId) ||
    valueFields.get('recovery_operation_id') !== record.recoveryOperationId ||
    valueFields.get('stage') !== record.stage ||
    valueFields.get('wallet_id') !== record.walletId ||
    valueFields.get('target_authority_id') !== record.targetAuthorityId ||
    valueFields.get('target_wallet_auth_method_id') !== record.targetWalletAuthMethodId ||
    valueFields.get('updated_at_ms') !== record.updatedAtMs
  ) {
    return null;
  }
  return {
    recovery_operation_id: record.recoveryOperationId,
    stage: record.stage,
    wallet_id: record.walletId,
    target_authority_id: record.targetAuthorityId,
    target_wallet_auth_method_id: record.targetWalletAuthMethodId,
    updated_at_ms: record.updatedAtMs,
    record,
  };
}

function samePendingRecoveryByteArray(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function samePendingRecoveryEncryptedMaterialV1(
  left: PendingWalletRecoveryEncryptedMaterialV1,
  right: PendingWalletRecoveryEncryptedMaterialV1,
): boolean {
  return (
    left.kind === right.kind &&
    samePendingRecoveryByteArray(left.iv, right.iv) &&
    samePendingRecoveryByteArray(left.ciphertext, right.ciphertext)
  );
}

function samePendingRecoveryEnrollmentReferenceV1(
  raw: unknown,
  expected: WalletRecoveryEmailOtpEnrollmentReferenceV1,
): boolean {
  const fields = decodeExactPendingRecoveryFields(raw, PENDING_RECOVERY_ENROLLMENT_FIELDS);
  return (
    fields !== null &&
    fields.get('kind') === expected.kind &&
    fields.get('enrollmentId') === expected.enrollmentId &&
    fields.get('enrollmentSealKeyVersion') === expected.enrollmentSealKeyVersion
  );
}

function samePendingRecoveryPasskeyTargetFields(
  raw: unknown,
  expectedRpId: WebAuthnRpId,
  expectedCredentialIdB64u: WebAuthnCredentialIdB64u,
): boolean {
  const fields = decodeExactPendingRecoveryFields(raw, PENDING_RECOVERY_PASSKEY_TARGET_FIELDS);
  return (
    fields !== null &&
    fields.get('kind') === 'passkey' &&
    fields.get('rpId') === expectedRpId &&
    fields.get('credentialIdB64u') === expectedCredentialIdB64u
  );
}

function samePendingRecoveryCommitTargetV1(
  raw: unknown,
  expected: PendingWalletRecoveryTargetIdentityV1,
): boolean {
  if (expected.kind === 'passkey') {
    return samePendingRecoveryPasskeyTargetFields(raw, expected.rpId, expected.credentialIdB64u);
  }
  const fields = decodeExactPendingRecoveryFields(
    raw,
    PENDING_RECOVERY_COMMIT_GOOGLE_EMAIL_OTP_TARGET_FIELDS,
  );
  return (
    fields !== null &&
    fields.get('kind') === expected.kind &&
    fields.get('providerSubject') === expected.providerSubject &&
    fields.get('emailHashHex') === expected.emailHashHex &&
    fields.get('registrationAuthorityId') === expected.registrationAuthorityId &&
    samePendingRecoveryEnrollmentReferenceV1(fields.get('enrollment'), expected.enrollment)
  );
}

function samePendingRecoveryProjectionTargetV1(
  raw: unknown,
  expected: WalletRecoveryCommittedProjectionV1['target'],
): boolean {
  if (expected.kind === 'passkey') {
    return samePendingRecoveryPasskeyTargetFields(raw, expected.rpId, expected.credentialIdB64u);
  }
  const fields = decodeExactPendingRecoveryFields(
    raw,
    PENDING_RECOVERY_GOOGLE_EMAIL_OTP_TARGET_FIELDS,
  );
  return (
    fields !== null &&
    fields.get('kind') === expected.kind &&
    fields.get('provider') === 'google' &&
    fields.get('providerSubject') === expected.providerSubject &&
    fields.get('emailHashHex') === expected.emailHashHex &&
    fields.get('registrationAuthorityId') === expected.registrationAuthorityId &&
    samePendingRecoveryEnrollmentReferenceV1(fields.get('enrollment'), expected.enrollment)
  );
}

function samePendingRecoveryAuthMethodV1(
  raw: unknown,
  expected: Extract<WalletAuthMethodRecordV2, { readonly status: 'active' }>,
): boolean {
  const fields = decodeExactPendingRecoveryFields(
    raw,
    expected.kind === 'passkey'
      ? PENDING_RECOVERY_PASSKEY_AUTH_METHOD_FIELDS
      : PENDING_RECOVERY_EMAIL_OTP_AUTH_METHOD_FIELDS,
  );
  if (!fields) return false;
  if (
    fields.get('version') !== expected.version ||
    fields.get('walletAuthMethodId') !== expected.walletAuthMethodId ||
    fields.get('walletId') !== expected.walletId ||
    fields.get('walletAuthorityId') !== expected.walletAuthorityId ||
    fields.get('status') !== expected.status ||
    fields.get('createdAtMs') !== expected.createdAtMs ||
    fields.get('updatedAtMs') !== expected.updatedAtMs ||
    fields.get('activatedAtMs') !== expected.activatedAtMs
  ) {
    return false;
  }
  if (expected.kind === 'passkey') {
    if (
      fields.get('kind') !== expected.kind ||
      fields.get('rpId') !== expected.rpId ||
      fields.get('credentialIdB64u') !== expected.credentialIdB64u ||
      fields.get('credentialPublicKeyB64u') !== expected.credentialPublicKeyB64u ||
      fields.get('counter') !== expected.counter
    ) {
      return false;
    }
  } else if (
    fields.get('kind') !== expected.kind ||
    fields.get('emailHashHex') !== expected.emailHashHex ||
    fields.get('registrationAuthorityId') !== expected.registrationAuthorityId
  ) {
    return false;
  }
  const actual = parseWalletAuthMethodRecordV2(raw);
  return actual !== null && sameWalletAuthMethodRecordV2(actual, expected);
}

function samePendingRecoveryProjectionV1(
  raw: unknown,
  expected: WalletRecoveryCommittedProjectionV1,
): boolean {
  const fields = decodeExactPendingRecoveryFields(raw, PENDING_RECOVERY_PROJECTION_FIELDS);
  if (
    fields === null ||
    fields.get('version') !== expected.version ||
    fields.get('kind') !== expected.kind ||
    fields.get('storeVersion') !== expected.storeVersion ||
    fields.get('walletId') !== expected.walletId ||
    fields.get('recoveryOperationId') !== expected.recoveryOperationId ||
    fields.get('targetDeviceId') !== expected.targetDeviceId ||
    fields.get('targetAuthorityId') !== expected.targetAuthorityId ||
    fields.get('targetWalletAuthMethodId') !== expected.targetWalletAuthMethodId
  ) {
    return false;
  }
  const authorityResult = parseWalletAuthorityV1(fields.get('authority'));
  if (
    !authorityResult.ok ||
    authorityResult.value.state !== 'active' ||
    !isActiveRecoveredWalletAuthorityV1(authorityResult.value)
  ) {
    return false;
  }
  return (
    samePendingRecoveryAuthorityV1(authorityResult.value, expected.authority) &&
    samePendingRecoveryAuthMethodV1(fields.get('authMethod'), expected.authMethod) &&
    samePendingRecoveryProjectionTargetV1(fields.get('target'), expected.target)
  );
}

function samePendingRecoveryAuthorityV1(
  left: ActiveRecoveredWalletAuthorityV1,
  right: ActiveRecoveredWalletAuthorityV1,
): boolean {
  return (
    left.kind === right.kind &&
    left.authorityId === right.authorityId &&
    left.walletId === right.walletId &&
    left.principal.kind === right.principal.kind &&
    left.principal.deviceId === right.principal.deviceId &&
    left.provenance.kind === right.provenance.kind &&
    left.provenance.recoveryOperationId === right.provenance.recoveryOperationId &&
    left.provenance.continuityAuthorityId === right.provenance.continuityAuthorityId &&
    samePendingRecoveryPermissionSetV1(left.permissions, right.permissions) &&
    samePendingRecoverySignerActivationSetV1(left.signerActivations, right.signerActivations) &&
    left.signerActivationSetDigestB64u === right.signerActivationSetDigestB64u &&
    left.authorityDigestB64u === right.authorityDigestB64u &&
    left.revocationEpoch === right.revocationEpoch &&
    left.createdAtMs === right.createdAtMs &&
    left.updatedAtMs === right.updatedAtMs &&
    left.state === right.state &&
    left.activatedAtMs === right.activatedAtMs
  );
}

function samePendingRecoveryPermissionSetV1(
  left: ActiveRecoveredWalletAuthorityV1['permissions'],
  right: ActiveRecoveredWalletAuthorityV1['permissions'],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function samePendingRecoverySignerActivationSetV1(
  left: WalletSignerActivationSetV1,
  right: WalletSignerActivationSetV1,
): boolean {
  if (
    left.kind !== right.kind ||
    left.keyFamilies.length !== right.keyFamilies.length ||
    left.keyFamilies.some((family, index) => family !== right.keyFamilies[index])
  ) {
    return false;
  }
  if (left.keyFamilies.length === 1) {
    const family = left.keyFamilies[0];
    switch (family) {
      case 'ed25519':
        return (
          right.keyFamilies[0] === 'ed25519' &&
          left.ed25519 !== undefined &&
          right.ed25519 !== undefined &&
          samePendingRecoveryEd25519SignerActivationV1(left.ed25519, right.ed25519)
        );
      case 'ecdsa_secp256k1':
        return (
          right.keyFamilies[0] === 'ecdsa_secp256k1' &&
          left.ecdsa !== undefined &&
          right.ecdsa !== undefined &&
          samePendingRecoveryEcdsaSignerActivationV1(left.ecdsa, right.ecdsa)
        );
      default:
        return assertNeverPendingRecoverySignerFamily(family);
    }
  }
  if (
    left.keyFamilies.length !== 2 ||
    left.keyFamilies[0] !== 'ed25519' ||
    left.keyFamilies[1] !== 'ecdsa_secp256k1' ||
    right.keyFamilies.length !== 2 ||
    right.keyFamilies[0] !== 'ed25519' ||
    right.keyFamilies[1] !== 'ecdsa_secp256k1' ||
    left.ed25519 === undefined ||
    right.ed25519 === undefined ||
    left.ecdsa === undefined ||
    right.ecdsa === undefined
  ) {
    return false;
  }
  return (
    samePendingRecoveryEd25519SignerActivationV1(left.ed25519, right.ed25519) &&
    samePendingRecoveryEcdsaSignerActivationV1(left.ecdsa, right.ecdsa)
  );
}

function samePendingRecoveryEd25519SignerActivationV1(
  left: WalletEd25519SignerActivationV1,
  right: WalletEd25519SignerActivationV1,
): boolean {
  return (
    left.kind === right.kind &&
    left.signer.kind === right.signer.kind &&
    left.signer.keyFamily === right.signer.keyFamily &&
    left.signer.walletId === right.signer.walletId &&
    left.signer.walletKeyId === right.signer.walletKeyId &&
    left.signer.registeredPublicKeyB64u === right.signer.registeredPublicKeyB64u &&
    mpcMaterialActivationRefsEqual(left.materialActivation, right.materialActivation)
  );
}

function samePendingRecoveryEcdsaSignerActivationV1(
  left: WalletEcdsaSignerActivationV1,
  right: WalletEcdsaSignerActivationV1,
): boolean {
  return (
    left.kind === right.kind &&
    left.signer.kind === right.signer.kind &&
    left.signer.keyFamily === right.signer.keyFamily &&
    left.signer.walletId === right.signer.walletId &&
    left.signer.walletKeyId === right.signer.walletKeyId &&
    left.signer.thresholdPublicKey33B64u === right.signer.thresholdPublicKey33B64u &&
    left.signer.evmAddress === right.signer.evmAddress &&
    mpcMaterialActivationRefsEqual(left.materialActivation, right.materialActivation)
  );
}

function assertNeverPendingRecoverySignerFamily(value: never): never {
  throw new Error(`unsupported pending recovery signer family: ${String(value)}`);
}

function samePendingRecoveryCommitRecordV1(
  actualFields: PendingRecoveryObjectFields,
  expected: PendingWalletRecoveryCommitV1,
): boolean {
  if (
    actualFields.get('kind') !== expected.kind ||
    actualFields.get('version') !== expected.version ||
    actualFields.get('stage') !== expected.stage ||
    actualFields.get('recoveryOperationId') !== expected.recoveryOperationId ||
    actualFields.get('walletId') !== expected.walletId ||
    actualFields.get('reservationId') !== expected.reservationId ||
    actualFields.get('targetDeviceId') !== expected.targetDeviceId ||
    actualFields.get('targetAuthorityId') !== expected.targetAuthorityId ||
    actualFields.get('targetWalletAuthMethodId') !== expected.targetWalletAuthMethodId ||
    actualFields.get('createdAtMs') !== expected.createdAtMs ||
    actualFields.get('updatedAtMs') !== expected.updatedAtMs
  ) {
    return false;
  }
  const actualMaterial = parseEncryptedMaterial(actualFields.get('localMaterial'));
  if (
    actualMaterial === null ||
    !samePendingRecoveryEncryptedMaterialV1(actualMaterial, expected.localMaterial) ||
    !samePendingRecoveryCommitTargetV1(actualFields.get('target'), expected.target)
  ) {
    return false;
  }
  switch (expected.stage) {
    case 'awaiting_server_promotion':
      return true;
    case 'server_promoted':
      return samePendingRecoveryProjectionV1(actualFields.get('projection'), expected.projection);
    default:
      return assertNeverPendingRecovery(expected);
  }
}

function assertNeverPendingRecovery(_value: never): never {
  throw new Error('unsupported pending wallet recovery branch');
}

/**
 * Compare an app-state row while it is still inside an IndexedDB transaction.
 * Projection validation happens before opening the transaction because its
 * digest check is asynchronous; this synchronous comparison closes the CAS
 * over the row's public fields and encrypted bytes.
 */
export function pendingWalletRecoveryCommitAppStateRowsMatch(
  raw: unknown,
  expected: PendingWalletRecoveryCommitAppStateRow,
): boolean {
  const rowFields = decodeExactPendingRecoveryFields(raw, ['key', 'value']);
  if (!rowFields || rowFields.get('key') !== expected.key) return false;
  const valueFields = decodeExactPendingRecoveryFields(rowFields.get('value'), [
    'recovery_operation_id',
    'stage',
    'wallet_id',
    'target_authority_id',
    'target_wallet_auth_method_id',
    'updated_at_ms',
    'record',
  ]);
  if (!valueFields) return false;
  const expectedValue = expected.value;
  if (
    valueFields.get('recovery_operation_id') !== expectedValue.recovery_operation_id ||
    valueFields.get('stage') !== expectedValue.stage ||
    valueFields.get('wallet_id') !== expectedValue.wallet_id ||
    valueFields.get('target_authority_id') !== expectedValue.target_authority_id ||
    valueFields.get('target_wallet_auth_method_id') !==
      expectedValue.target_wallet_auth_method_id ||
    valueFields.get('updated_at_ms') !== expectedValue.updated_at_ms
  ) {
    return false;
  }
  const expectedRecord = expectedValue.record;
  const baseKeys = [
    'kind',
    'version',
    'stage',
    'recoveryOperationId',
    'walletId',
    'reservationId',
    'targetDeviceId',
    'targetAuthorityId',
    'targetWalletAuthMethodId',
    'target',
    'localMaterial',
    'createdAtMs',
    'updatedAtMs',
  ] as const;
  const recordKeys =
    expectedRecord.stage === 'server_promoted' ? [...baseKeys, 'projection'] : baseKeys;
  const actualRecordFields = decodeExactPendingRecoveryFields(
    valueFields.get('record'),
    recordKeys,
  );
  return actualRecordFields !== null && samePendingRecoveryCommitRecordV1(actualRecordFields, expectedRecord);
}

export function pendingWalletRecoveryProjectionExpectation(
  record: Extract<PendingWalletRecoveryCommitV1, { readonly stage: 'server_promoted' }>,
): WalletRecoveryCommittedProjectionExpectationV1 {
  return projectionExpectation(record);
}
