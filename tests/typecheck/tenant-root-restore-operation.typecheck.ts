import type { TenantRootIdentityV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import {
  TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1,
  type TenantRootOperationRecordInputV1,
  type TenantRootOperationRecordV1,
  type TenantRootRestoreRoleImportKeyIssueOperationInputV1,
} from '../../packages/shared-ts/src/tenant-root/tenantRootOperationRecord';

declare const identity: TenantRootIdentityV1;

const restoreInput: TenantRootRestoreRoleImportKeyIssueOperationInputV1 = {
  operationKind: TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1,
  identity,
  tenantRootIdentityDigest: 'identity-digest',
  custodyLineageId: 'destination-lineage',
  subject: { kind: 'recovery_set', recoverySetId: 'recovery-set' },
  role: 'deriver_a',
  requesterActorId: 'owner-1',
  idempotencyKey: 'operation-1',
  nonceB64u: 'nonce',
  issuedAt: '2026-09-07T00:00:00.000Z',
  expiresAt: '2026-09-07T00:05:00.000Z',
  manifestDigestB64u: 'manifest',
  destinationFingerprintB64u: 'fingerprint',
  restoreSessionIdB64u: 'session',
  importKeyId: 'import-key',
  generation: 1,
};
void restoreInput;

const activeInput = {
  operationKind: 'tenant_root_operational_share_rotation_v1' as const,
  identity,
  tenantRootIdentityDigest: 'identity-digest',
  custodyLineageId: 'destination-lineage',
  expectedLifecycleRevision: 1,
  recoveryGovernanceDigest: 'governance-digest',
  subject: { kind: 'tenant_root' as const },
  requesterActorId: 'owner-1',
  idempotencyKey: 'operation-1',
  issuedAt: '2026-09-07T00:00:00.000Z',
  expiresAt: '2026-09-07T00:05:00.000Z',
  expectedRootCommitment: 'root-commitment',
} satisfies TenantRootOperationRecordInputV1;
void activeInput;

const broadRestoreInput = {
  ...restoreInput,
  expectedLifecycleRevision: 1,
  recoveryGovernanceDigest: 'governance-digest',
};
// @ts-expect-error Restore issuance cannot be widened into active-root lifecycle state.
const invalidRestoreInput: TenantRootOperationRecordInputV1 = broadRestoreInput;
void invalidRestoreInput;

const broadActiveInput = {
  ...activeInput,
  manifestDigestB64u: 'manifest',
};
// @ts-expect-error Active-root operations cannot carry restore-only bindings.
const invalidActiveInput: TenantRootOperationRecordInputV1 = broadActiveInput;
void invalidActiveInput;

const restoreRecord: TenantRootOperationRecordV1 = {
  formatVersion: 'tenant_root_operation_record_v1',
  operationKind: TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_ISSUE_OPERATION_KIND_V1,
  tenantRootIdentityDigest: 'identity-digest',
  orgId: 'org-1',
  projectId: 'project-1',
  envId: 'production',
  custodyLineageId: 'destination-lineage',
  subject: { kind: 'recovery_set', recoverySetId: 'recovery-set' },
  role: 'deriver_b',
  requesterActorId: 'owner-1',
  idempotencyKey: 'operation-2',
  nonceB64u: 'nonce',
  issuedAt: '2026-09-07T00:00:00.000Z',
  expiresAt: '2026-09-07T00:05:00.000Z',
  manifestDigestB64u: 'manifest',
  destinationFingerprintB64u: 'fingerprint',
  restoreSessionIdB64u: 'session',
  importKeyId: 'import-key',
  generation: 1,
};

const broadRestoreRecord = {
  ...restoreRecord,
  expectedLifecycleRevision: 1,
};
// @ts-expect-error Restore records reject active-root lifecycle fields.
const invalidRestoreRecord: TenantRootOperationRecordV1 = broadRestoreRecord;
void invalidRestoreRecord;

const activeRecord: TenantRootOperationRecordV1 = {
  formatVersion: 'tenant_root_operation_record_v1',
  operationKind: 'tenant_root_operational_share_rotation_v1',
  tenantRootIdentityDigest: 'identity-digest',
  orgId: 'org-1',
  projectId: 'project-1',
  envId: 'production',
  custodyLineageId: 'destination-lineage',
  expectedLifecycleRevision: 1,
  recoveryGovernanceDigest: 'governance-digest',
  subject: { kind: 'tenant_root' },
  requesterActorId: 'owner-1',
  idempotencyKey: 'operation-3',
  issuedAt: '2026-09-07T00:00:00.000Z',
  expiresAt: '2026-09-07T00:05:00.000Z',
  expectedRootCommitment: 'root-commitment',
};

const broadActiveRecord = {
  ...activeRecord,
  restoreSessionIdB64u: 'session',
};
// @ts-expect-error Active-root records reject restore-only fields.
const invalidActiveRecord: TenantRootOperationRecordV1 = broadActiveRecord;
void invalidActiveRecord;
