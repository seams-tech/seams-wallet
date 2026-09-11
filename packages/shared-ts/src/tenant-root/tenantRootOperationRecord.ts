import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { alphabetizeStringify, sha256Bytes } from '../utils/digests';
import {
  isTenantRootIdentityFieldCanonicalV1,
  type TenantRootIdentityV1,
} from './tenantRootIdentity';

/**
 * The console operation record (Refactor 121).
 *
 * The console builds these records in TypeScript and the control plane
 * consumes their digests in Rust, so both sides must produce identical
 * canonical bytes. The encoding is pinned by the cross-runtime fixtures in
 * `crates/router-ab-core/tests/fixtures/tenant-root-operation`.
 *
 * A record is the unit of authorization: changing any field changes the
 * digest, so a capability minted for one record cannot be carried to another
 * tenant, environment, role, or lifecycle revision.
 */

const TENANT_ROOT_OPERATION_DOMAIN_V1 = 'seams/tenant-root-operation/v1';
const TENANT_ROOT_OPERATION_RECORD_FORMAT_V1 = 'tenant_root_operation_record_v1';

/** Maximum authorization lifetime for most operations. */
export const TENANT_ROOT_OPERATION_MAX_LIFETIME_MS_V1 = 600_000;
/** Maximum authorization lifetime for a ciphertext download. */
export const TENANT_ROOT_DOWNLOAD_MAX_LIFETIME_MS_V1 = 300_000;

/** One console operation on a tenant derivation root. */
export type TenantRootOperationKindV1 =
  | 'tenant_root_operational_share_rotation_v1'
  | 'tenant_root_recovery_governance_change_v1'
  | 'tenant_root_recovery_recipient_pair_enroll_v1'
  | 'tenant_root_recovery_recipient_pair_replace_v1'
  | 'tenant_root_recovery_backup_create_v1'
  | 'tenant_root_recovery_backup_replace_v1'
  | 'tenant_root_recovery_role_package_download_v1'
  | 'tenant_root_recovery_manifest_download_v1'
  | 'tenant_root_restore_session_start_v1'
  | 'tenant_root_restore_manifest_register_v1'
  | 'tenant_root_restore_role_import_key_issue_v1'
  | 'tenant_root_restore_role_import_v1'
  | 'tenant_root_restore_activate_v1'
  | 'tenant_root_source_lineage_retire_v1';

/** What one operation acts on. */
export type TenantRootOperationSubjectV1 =
  | { readonly kind: 'tenant_root' }
  | { readonly kind: 'recovery_set'; readonly recoverySetId: string }
  | { readonly kind: 'recipient_pair'; readonly recipientPairDigest: string };

/** The single Deriver role a role-local operation acts on. */
export type TenantRootDeriverRoleV1 = 'deriver_a' | 'deriver_b';

export const TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1 =
  'tenant_root_restore_role_import_key_issue_v1' as const;

type TenantRootOperationRecordWithActiveRootV1 = {
  readonly formatVersion: typeof TENANT_ROOT_OPERATION_RECORD_FORMAT_V1;
  readonly operationKind: Exclude<
    TenantRootOperationKindV1,
    typeof TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1
  >;
  readonly tenantRootIdentityDigest: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly custodyLineageId: string;
  readonly expectedLifecycleRevision: number;
  readonly recoveryGovernanceDigest: string;
  readonly subject: TenantRootOperationSubjectV1;
  readonly role?: TenantRootDeriverRoleV1;
  readonly requesterActorId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly expectedRootCommitment: string;
  readonly manifestDigestB64u?: never;
  readonly destinationFingerprintB64u?: never;
  readonly restoreSessionIdB64u?: never;
  readonly importKeyId?: never;
  readonly generation?: never;
  readonly nonceB64u?: never;
};

/**
 * The restore import-key issue branch is scoped to an empty destination. It
 * carries the destination identity and restore binding, so active-root
 * lifecycle and governance state do not belong in this record.
 */
export type TenantRootRestoreRoleImportKeyIssueOperationRecordV1 = {
  readonly formatVersion: typeof TENANT_ROOT_OPERATION_RECORD_FORMAT_V1;
  readonly operationKind: typeof TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1;
  readonly tenantRootIdentityDigest: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly custodyLineageId: string;
  readonly expectedLifecycleRevision?: never;
  readonly recoveryGovernanceDigest?: never;
  readonly subject: Extract<TenantRootOperationSubjectV1, { readonly kind: 'recovery_set' }>;
  readonly role: TenantRootDeriverRoleV1;
  readonly requesterActorId: string;
  readonly idempotencyKey: string;
  readonly nonceB64u: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly expectedRootCommitment?: never;
  readonly manifestDigestB64u: string;
  readonly destinationFingerprintB64u: string;
  readonly restoreSessionIdB64u: string;
  readonly importKeyId: string;
  readonly generation: number;
};

/** One exact server-generated operation record. */
export type TenantRootOperationRecordV1 =
  | TenantRootOperationRecordWithActiveRootV1
  | TenantRootRestoreRoleImportKeyIssueOperationRecordV1;

/** Why one record could not be built. */
export type TenantRootOperationRecordErrorV1 =
  | { readonly kind: 'subject_does_not_match_operation' }
  | { readonly kind: 'role_does_not_match_operation' }
  | { readonly kind: 'lifecycle_revision_not_positive' }
  | {
      readonly kind: 'restore_binding_invalid';
      readonly field:
        | 'tenantRootIdentityDigest'
        | 'recoverySetId'
        | 'manifestDigestB64u'
        | 'custodyLineageId'
        | 'destinationFingerprintB64u'
        | 'nonceB64u';
    }
  | { readonly kind: 'restore_session_id_invalid' }
  | { readonly kind: 'restore_import_key_id_invalid' }
  | { readonly kind: 'restore_generation_not_positive' }
  | { readonly kind: 'timestamp_not_canonical'; readonly field: 'issuedAt' | 'expiresAt' }
  | { readonly kind: 'expiry_not_after_issue' }
  | { readonly kind: 'lifetime_exceeds_maximum'; readonly maximumMs: number };

/** Result of building one record. */
export type TenantRootOperationRecordResultV1 =
  | { readonly ok: true; readonly record: TenantRootOperationRecordV1 }
  | { readonly ok: false; readonly error: TenantRootOperationRecordErrorV1 };

/** Inputs the console resolves before building a record. */
type TenantRootOperationRecordInputWithActiveRootV1 = {
  readonly operationKind: Exclude<
    TenantRootOperationKindV1,
    typeof TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1
  >;
  readonly identity: TenantRootIdentityV1;
  readonly tenantRootIdentityDigest: string;
  readonly custodyLineageId: string;
  readonly expectedLifecycleRevision: number;
  readonly recoveryGovernanceDigest: string;
  readonly subject: TenantRootOperationSubjectV1;
  readonly role?: TenantRootDeriverRoleV1;
  readonly requesterActorId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly expectedRootCommitment: string;
  readonly manifestDigestB64u?: never;
  readonly destinationFingerprintB64u?: never;
  readonly restoreSessionIdB64u?: never;
  readonly importKeyId?: never;
  readonly generation?: never;
  readonly nonceB64u?: never;
};

/** Input for the destination-scoped restore import-key issue branch. */
export type TenantRootRestoreRoleImportKeyIssueOperationInputV1 = {
  readonly operationKind: typeof TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1;
  readonly identity: TenantRootIdentityV1;
  readonly tenantRootIdentityDigest: string;
  readonly custodyLineageId: string;
  readonly subject: Extract<TenantRootOperationSubjectV1, { readonly kind: 'recovery_set' }>;
  readonly role: TenantRootDeriverRoleV1;
  readonly requesterActorId: string;
  readonly idempotencyKey: string;
  readonly nonceB64u: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly manifestDigestB64u: string;
  readonly destinationFingerprintB64u: string;
  readonly restoreSessionIdB64u: string;
  readonly importKeyId: string;
  readonly generation: number;
  readonly expectedLifecycleRevision?: never;
  readonly recoveryGovernanceDigest?: never;
  readonly expectedRootCommitment?: never;
};

/** Inputs the console resolves before building a record. */
export type TenantRootOperationRecordInputV1 =
  | TenantRootOperationRecordInputWithActiveRootV1
  | TenantRootRestoreRoleImportKeyIssueOperationInputV1;

const ROLE_LOCAL_OPERATIONS: ReadonlySet<TenantRootOperationKindV1> = new Set([
  'tenant_root_recovery_role_package_download_v1',
  'tenant_root_restore_role_import_key_issue_v1',
  'tenant_root_restore_role_import_v1',
]);

const RECIPIENT_PAIR_OPERATIONS: ReadonlySet<TenantRootOperationKindV1> = new Set([
  'tenant_root_recovery_recipient_pair_enroll_v1',
  'tenant_root_recovery_recipient_pair_replace_v1',
]);

const RECOVERY_SET_OPERATIONS: ReadonlySet<TenantRootOperationKindV1> = new Set([
  'tenant_root_recovery_backup_replace_v1',
  'tenant_root_recovery_role_package_download_v1',
  'tenant_root_recovery_manifest_download_v1',
  'tenant_root_restore_manifest_register_v1',
  'tenant_root_restore_role_import_key_issue_v1',
  'tenant_root_restore_role_import_v1',
  'tenant_root_restore_activate_v1',
]);

const DOWNLOAD_OPERATIONS: ReadonlySet<TenantRootOperationKindV1> = new Set([
  'tenant_root_recovery_role_package_download_v1',
  'tenant_root_recovery_manifest_download_v1',
]);

const OPERATION_KINDS: ReadonlySet<string> = new Set<TenantRootOperationKindV1>([
  'tenant_root_operational_share_rotation_v1',
  'tenant_root_recovery_governance_change_v1',
  'tenant_root_recovery_recipient_pair_enroll_v1',
  'tenant_root_recovery_recipient_pair_replace_v1',
  'tenant_root_recovery_backup_create_v1',
  'tenant_root_recovery_backup_replace_v1',
  'tenant_root_recovery_role_package_download_v1',
  'tenant_root_recovery_manifest_download_v1',
  'tenant_root_restore_session_start_v1',
  'tenant_root_restore_manifest_register_v1',
  'tenant_root_restore_role_import_key_issue_v1',
  'tenant_root_restore_role_import_v1',
  'tenant_root_restore_activate_v1',
  'tenant_root_source_lineage_retire_v1',
]);

/** Returns the four operations that follow the tenant's recovery governance. */
export function tenantRootOperationFollowsGovernanceV1(kind: TenantRootOperationKindV1): boolean {
  return (
    kind === 'tenant_root_recovery_governance_change_v1' ||
    kind === 'tenant_root_recovery_recipient_pair_enroll_v1' ||
    kind === 'tenant_root_recovery_recipient_pair_replace_v1' ||
    kind === 'tenant_root_source_lineage_retire_v1'
  );
}

/** Returns the maximum authorization lifetime for one operation. */
export function tenantRootOperationMaxLifetimeMsV1(kind: TenantRootOperationKindV1): number {
  if (DOWNLOAD_OPERATIONS.has(kind)) return TENANT_ROOT_DOWNLOAD_MAX_LIFETIME_MS_V1;
  return TENANT_ROOT_OPERATION_MAX_LIFETIME_MS_V1;
}

/** Returns true when a string names a known operation kind. */
export function isTenantRootOperationKindV1(value: unknown): value is TenantRootOperationKindV1 {
  return typeof value === 'string' && OPERATION_KINDS.has(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseSubject(value: unknown): TenantRootOperationSubjectV1 | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.kind === 'tenant_root' && keys.length === 1) return { kind: 'tenant_root' };
  if (record.kind === 'recovery_set' && keys.length === 2) {
    const recoverySetId = text(record.recoverySetId);
    return recoverySetId === null ? null : { kind: 'recovery_set', recoverySetId };
  }
  if (record.kind === 'recipient_pair' && keys.length === 2) {
    const recipientPairDigest = text(record.recipientPairDigest);
    return recipientPairDigest === null ? null : { kind: 'recipient_pair', recipientPairDigest };
  }
  return null;
}

function isCanonicalNonzeroBase64Url(value: unknown, expectedLength: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return false;
  try {
    const bytes = base64UrlDecode(value);
    return (
      bytes.length === expectedLength &&
      bytes.some((byte) => byte !== 0) &&
      base64UrlEncode(bytes) === value
    );
  } catch {
    return false;
  }
}

function isCanonicalIdentifier(value: unknown): value is string {
  return typeof value === 'string' && isTenantRootIdentityFieldCanonicalV1('orgId', value);
}

function isCanonicalRestoreImportKeyId(value: unknown): value is string {
  return (
    isCanonicalIdentifier(value) &&
    new TextEncoder().encode(value).length <= 128 &&
    !value.includes(' ')
  );
}

const RESTORE_ROLE_IMPORT_KEY_RECORD_KEYS_V1 = [
  'custodyLineageId',
  'destinationFingerprintB64u',
  'envId',
  'expiresAt',
  'formatVersion',
  'generation',
  'idempotencyKey',
  'importKeyId',
  'issuedAt',
  'manifestDigestB64u',
  'nonceB64u',
  'operationKind',
  'orgId',
  'projectId',
  'requesterActorId',
  'role',
  'restoreSessionIdB64u',
  'subject',
  'tenantRootIdentityDigest',
] as const;

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function parseRestoreRoleImportKeyIssueRecord(
  raw: Record<string, unknown>,
): TenantRootRestoreRoleImportKeyIssueOperationRecordV1 | null {
  if (!hasExactKeys(raw, RESTORE_ROLE_IMPORT_KEY_RECORD_KEYS_V1)) return null;
  if (raw.formatVersion !== TENANT_ROOT_OPERATION_RECORD_FORMAT_V1) return null;
  const subject = parseSubject(raw.subject);
  if (subject === null || subject.kind !== 'recovery_set') return null;
  const tenantRootIdentityDigest = raw.tenantRootIdentityDigest;
  const custodyLineageId = raw.custodyLineageId;
  const manifestDigestB64u = raw.manifestDigestB64u;
  const destinationFingerprintB64u = raw.destinationFingerprintB64u;
  const nonceB64u = raw.nonceB64u;
  if (!isCanonicalNonzeroBase64Url(tenantRootIdentityDigest, 32)) return null;
  if (!isCanonicalNonzeroBase64Url(custodyLineageId, 16)) return null;
  if (!isCanonicalNonzeroBase64Url(subject.recoverySetId, 16)) return null;
  if (!isCanonicalNonzeroBase64Url(manifestDigestB64u, 32)) return null;
  if (!isCanonicalNonzeroBase64Url(destinationFingerprintB64u, 32)) return null;
  if (!isCanonicalNonzeroBase64Url(nonceB64u, 32)) return null;
  if (
    typeof raw.role !== 'string' ||
    (raw.role !== 'deriver_a' && raw.role !== 'deriver_b') ||
    !isCanonicalIdentifier(raw.orgId) ||
    !isCanonicalIdentifier(raw.projectId) ||
    !isCanonicalIdentifier(raw.envId) ||
    !isCanonicalNonzeroBase64Url(raw.restoreSessionIdB64u, 16) ||
    !isCanonicalRestoreImportKeyId(raw.importKeyId) ||
    !isCanonicalIdentifier(raw.requesterActorId) ||
    !isCanonicalIdentifier(raw.idempotencyKey) ||
    typeof raw.issuedAt !== 'string' ||
    typeof raw.expiresAt !== 'string'
  ) {
    return null;
  }
  const generation = raw.generation;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) {
    return null;
  }
  if (parseCanonicalTimestamp(raw.issuedAt) === null) return null;
  if (parseCanonicalTimestamp(raw.expiresAt) === null) return null;
  const issued = parseCanonicalTimestamp(raw.issuedAt);
  const expires = parseCanonicalTimestamp(raw.expiresAt);
  if (issued === null || expires === null || expires <= issued) return null;
  if (
    expires - issued >
    tenantRootOperationMaxLifetimeMsV1(TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1)
  ) {
    return null;
  }
  const record: TenantRootRestoreRoleImportKeyIssueOperationRecordV1 = {
    formatVersion: TENANT_ROOT_OPERATION_RECORD_FORMAT_V1,
    operationKind: TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1,
    tenantRootIdentityDigest,
    orgId: raw.orgId,
    projectId: raw.projectId,
    envId: raw.envId,
    custodyLineageId,
    subject,
    role: raw.role,
    requesterActorId: raw.requesterActorId,
    idempotencyKey: raw.idempotencyKey,
    nonceB64u,
    issuedAt: raw.issuedAt,
    expiresAt: raw.expiresAt,
    manifestDigestB64u,
    destinationFingerprintB64u,
    restoreSessionIdB64u: raw.restoreSessionIdB64u,
    importKeyId: raw.importKeyId,
    generation,
  };
  return canonicalTenantRootOperationRecordJsonV1(record) === JSON.stringify(raw) ? record : null;
}

/**
 * Parses one stored canonical record back into the exact object it encodes.
 *
 * A stored record is reused for a retry so the digest a second owner approved,
 * or the control plane already consumed, is the digest the retry presents.
 * Anything that does not re-encode to exactly the stored bytes is refused.
 */
export function parseTenantRootOperationRecordV1(
  canonicalJson: string,
): TenantRootOperationRecordV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalJson);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.formatVersion !== TENANT_ROOT_OPERATION_RECORD_FORMAT_V1) return null;
  if (!isTenantRootOperationKindV1(raw.operationKind)) return null;
  if (raw.operationKind === TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1) {
    return parseRestoreRoleImportKeyIssueRecord(raw);
  }
  const subject = parseSubject(raw.subject);
  const fields = {
    tenantRootIdentityDigest: text(raw.tenantRootIdentityDigest),
    orgId: text(raw.orgId),
    projectId: text(raw.projectId),
    envId: text(raw.envId),
    custodyLineageId: text(raw.custodyLineageId),
    recoveryGovernanceDigest: text(raw.recoveryGovernanceDigest),
    requesterActorId: text(raw.requesterActorId),
    idempotencyKey: text(raw.idempotencyKey),
    issuedAt: text(raw.issuedAt),
    expiresAt: text(raw.expiresAt),
    expectedRootCommitment: text(raw.expectedRootCommitment),
  };
  if (subject === null || Object.values(fields).some((value) => value === null)) return null;
  const revision = raw.expectedLifecycleRevision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
    return null;
  }
  const role = raw.role;
  if (role !== undefined && role !== 'deriver_a' && role !== 'deriver_b') return null;
  const record: TenantRootOperationRecordV1 = {
    formatVersion: TENANT_ROOT_OPERATION_RECORD_FORMAT_V1,
    operationKind: raw.operationKind,
    tenantRootIdentityDigest: fields.tenantRootIdentityDigest as string,
    orgId: fields.orgId as string,
    projectId: fields.projectId as string,
    envId: fields.envId as string,
    custodyLineageId: fields.custodyLineageId as string,
    expectedLifecycleRevision: revision,
    recoveryGovernanceDigest: fields.recoveryGovernanceDigest as string,
    subject,
    ...(role === undefined ? {} : { role }),
    requesterActorId: fields.requesterActorId as string,
    idempotencyKey: fields.idempotencyKey as string,
    issuedAt: fields.issuedAt as string,
    expiresAt: fields.expiresAt as string,
    expectedRootCommitment: fields.expectedRootCommitment as string,
  };
  return canonicalTenantRootOperationRecordJsonV1(record) === canonicalJson ? record : null;
}

function expectedSubjectKind(
  kind: TenantRootOperationKindV1,
): TenantRootOperationSubjectV1['kind'] {
  if (RECIPIENT_PAIR_OPERATIONS.has(kind)) return 'recipient_pair';
  if (RECOVERY_SET_OPERATIONS.has(kind)) return 'recovery_set';
  return 'tenant_root';
}

const RFC3339_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseCanonicalTimestamp(value: string): number | null {
  if (!RFC3339_MILLIS.test(value)) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  // Date.parse normalizes an impossible day (February 31) into the next month,
  // so round-tripping is what actually rejects it.
  return new Date(parsed).toISOString() === value ? parsed : null;
}

/**
 * Builds one operation record from resolved server state.
 *
 * The organization, project, and environment ids come from the trusted
 * identity rather than from a caller, so the record's ids and its identity
 * digest cannot disagree.
 */
export function buildTenantRootOperationRecordV1(
  input: TenantRootOperationRecordInputV1,
): TenantRootOperationRecordResultV1 {
  if (input.operationKind === TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1) {
    if (input.subject.kind !== 'recovery_set') {
      return { ok: false, error: { kind: 'subject_does_not_match_operation' } };
    }
    const restoreBindingError = validateRestoreBindingInput(input);
    if (restoreBindingError !== null) {
      return { ok: false, error: restoreBindingError };
    }
    const timestamps = validateOperationTimestamps(input);
    if (!timestamps.ok) return timestamps;
    const record: TenantRootRestoreRoleImportKeyIssueOperationRecordV1 = {
      formatVersion: TENANT_ROOT_OPERATION_RECORD_FORMAT_V1,
      operationKind: TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1,
      tenantRootIdentityDigest: input.tenantRootIdentityDigest,
      orgId: input.identity.orgId,
      projectId: input.identity.projectId,
      envId: input.identity.envId,
      custodyLineageId: input.custodyLineageId,
      subject: input.subject,
      role: input.role,
      requesterActorId: input.requesterActorId,
      idempotencyKey: input.idempotencyKey,
      nonceB64u: input.nonceB64u,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      manifestDigestB64u: input.manifestDigestB64u,
      destinationFingerprintB64u: input.destinationFingerprintB64u,
      restoreSessionIdB64u: input.restoreSessionIdB64u,
      importKeyId: input.importKeyId,
      generation: input.generation,
    };
    return { ok: true, record };
  }
  if (input.subject.kind !== expectedSubjectKind(input.operationKind)) {
    return { ok: false, error: { kind: 'subject_does_not_match_operation' } };
  }
  if (ROLE_LOCAL_OPERATIONS.has(input.operationKind) !== (input.role !== undefined)) {
    return { ok: false, error: { kind: 'role_does_not_match_operation' } };
  }
  if (
    !Number.isSafeInteger(input.expectedLifecycleRevision) ||
    input.expectedLifecycleRevision < 1
  ) {
    return { ok: false, error: { kind: 'lifecycle_revision_not_positive' } };
  }
  const issued = parseCanonicalTimestamp(input.issuedAt);
  if (issued === null) {
    return { ok: false, error: { kind: 'timestamp_not_canonical', field: 'issuedAt' } };
  }
  const expires = parseCanonicalTimestamp(input.expiresAt);
  if (expires === null) {
    return { ok: false, error: { kind: 'timestamp_not_canonical', field: 'expiresAt' } };
  }
  if (expires <= issued) {
    return { ok: false, error: { kind: 'expiry_not_after_issue' } };
  }
  const maximumMs = tenantRootOperationMaxLifetimeMsV1(input.operationKind);
  if (expires - issued > maximumMs) {
    return { ok: false, error: { kind: 'lifetime_exceeds_maximum', maximumMs } };
  }

  const record: TenantRootOperationRecordV1 = {
    formatVersion: TENANT_ROOT_OPERATION_RECORD_FORMAT_V1,
    operationKind: input.operationKind,
    tenantRootIdentityDigest: input.tenantRootIdentityDigest,
    orgId: input.identity.orgId,
    projectId: input.identity.projectId,
    envId: input.identity.envId,
    custodyLineageId: input.custodyLineageId,
    expectedLifecycleRevision: input.expectedLifecycleRevision,
    recoveryGovernanceDigest: input.recoveryGovernanceDigest,
    subject: input.subject,
    ...(input.role === undefined ? {} : { role: input.role }),
    requesterActorId: input.requesterActorId,
    idempotencyKey: input.idempotencyKey,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    expectedRootCommitment: input.expectedRootCommitment,
  };
  return { ok: true, record };
}

function validateRestoreBindingInput(
  input: TenantRootRestoreRoleImportKeyIssueOperationInputV1,
):
  | Extract<TenantRootOperationRecordErrorV1, { readonly kind: 'restore_binding_invalid' }>
  | Extract<TenantRootOperationRecordErrorV1, { readonly kind: 'restore_session_id_invalid' }>
  | Extract<TenantRootOperationRecordErrorV1, { readonly kind: 'restore_import_key_id_invalid' }>
  | Extract<TenantRootOperationRecordErrorV1, { readonly kind: 'restore_generation_not_positive' }>
  | null {
  if (!isCanonicalNonzeroBase64Url(input.tenantRootIdentityDigest, 32)) {
    return { kind: 'restore_binding_invalid', field: 'tenantRootIdentityDigest' };
  }
  if (!isCanonicalNonzeroBase64Url(input.custodyLineageId, 16)) {
    return { kind: 'restore_binding_invalid', field: 'custodyLineageId' };
  }
  if (!isCanonicalNonzeroBase64Url(input.subject.recoverySetId, 16)) {
    return { kind: 'restore_binding_invalid', field: 'recoverySetId' };
  }
  if (!isCanonicalNonzeroBase64Url(input.manifestDigestB64u, 32)) {
    return { kind: 'restore_binding_invalid', field: 'manifestDigestB64u' };
  }
  if (!isCanonicalNonzeroBase64Url(input.destinationFingerprintB64u, 32)) {
    return { kind: 'restore_binding_invalid', field: 'destinationFingerprintB64u' };
  }
  if (!isCanonicalNonzeroBase64Url(input.nonceB64u, 32)) {
    return { kind: 'restore_binding_invalid', field: 'nonceB64u' };
  }
  if (!isCanonicalNonzeroBase64Url(input.restoreSessionIdB64u, 16)) {
    return { kind: 'restore_session_id_invalid' };
  }
  if (!isCanonicalRestoreImportKeyId(input.importKeyId)) {
    return { kind: 'restore_import_key_id_invalid' };
  }
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    return { kind: 'restore_generation_not_positive' };
  }
  return null;
}

type TenantRootOperationTimestampValidationV1 =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: Extract<
        TenantRootOperationRecordErrorV1,
        | { readonly kind: 'timestamp_not_canonical' }
        | { readonly kind: 'expiry_not_after_issue' }
        | { readonly kind: 'lifetime_exceeds_maximum' }
      >;
    };

function validateOperationTimestamps(
  input: Pick<TenantRootOperationRecordInputV1, 'operationKind' | 'issuedAt' | 'expiresAt'>,
): TenantRootOperationTimestampValidationV1 {
  const issued = parseCanonicalTimestamp(input.issuedAt);
  if (issued === null) {
    return { ok: false, error: { kind: 'timestamp_not_canonical', field: 'issuedAt' } };
  }
  const expires = parseCanonicalTimestamp(input.expiresAt);
  if (expires === null) {
    return { ok: false, error: { kind: 'timestamp_not_canonical', field: 'expiresAt' } };
  }
  if (expires <= issued) {
    return { ok: false, error: { kind: 'expiry_not_after_issue' } };
  }
  const maximumMs = tenantRootOperationMaxLifetimeMsV1(input.operationKind);
  if (expires - issued > maximumMs) {
    return { ok: false, error: { kind: 'lifetime_exceeds_maximum', maximumMs } };
  }
  return { ok: true };
}

/**
 * Returns the exact canonical bytes the digest covers.
 *
 * Object keys are sorted by UTF-16 code unit, matching the Rust encoder. An
 * absent role is absent from the object rather than present as null.
 */
export function canonicalTenantRootOperationRecordJsonV1(
  record: TenantRootOperationRecordV1,
): string {
  return alphabetizeStringify(record);
}

/** Returns SHA-256 over the operation domain and the canonical record bytes. */
export async function tenantRootOperationDigestB64uV1(
  record: TenantRootOperationRecordV1,
): Promise<string> {
  const canonical = new TextEncoder().encode(canonicalTenantRootOperationRecordJsonV1(record));
  const domain = new TextEncoder().encode(TENANT_ROOT_OPERATION_DOMAIN_V1);
  const input = new Uint8Array(domain.length + canonical.length);
  input.set(domain, 0);
  input.set(canonical, domain.length);
  return base64UrlEncode(await sha256Bytes(input));
}
