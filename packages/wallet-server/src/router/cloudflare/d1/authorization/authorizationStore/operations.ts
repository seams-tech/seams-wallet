import { prepareWalletOperationCompletion } from '../walletOperationPersistence';
import type { EcdsaMaterialReadSnapshot } from '../../../../../core/ecdsaMaterialReadSnapshot';
import type {
  EcdsaWalletSessionAdmissionInput,
  EcdsaWalletSessionAdmissionResult,
  EcdsaWalletSessionResolutionResult,
  PinnedOwnerWalletScope,
} from '../../../../../authorization/ecdsaWalletSessionAdmission';
import type {
  Ed25519WalletSessionAdmissionInput,
  Ed25519WalletSessionAdmissionResult,
  Ed25519WalletSessionResolutionInput,
  Ed25519WalletSessionResolutionResult,
} from '../../../../../authorization/ed25519WalletSessionAdmission';
import { type WalletId } from '@shared/utils/domainIds';
import {
  CAPABILITY_KINDS,
  parseAuthorizationAuditEventId,
  parseAuthorizationGrantRef,
  parseAuthorizedOperationId,
  parseCapabilityId,
  parseCapabilityOperationId,
  parseCapabilityOperationRef,
  parseMpcWalletSigningQuotaId,
  parsePrincipalId,
  parseTenantId,
  type AuthorizedOperationId,
  type TenantId,
} from '@shared/authorization/capabilityKinds';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import type {
  AuthorizedOperation,
  AuthorizedOperationInput,
  AuthorizedOperationReplayResponse,
  CompletedCapabilityOperationResult,
} from '../../../../../authorization/domain';
import {
  computeAuthorizedOperationResultDigest,
  parseAuthorizedOperationReplayResponse,
} from '../../../../../authorization/domain';
import { buildAuthorizedOperation } from '../../../../../authorization/domain';
import {
  buildCapabilityOperationEnvelope,
  computeCapabilityOperationFingerprintDigest,
  parseCapabilityOperationFingerprintDigest,
  type CapabilityOperationFingerprintDigest,
} from '@shared/authorization/operationFingerprint';
import type {
  AuthorizedOperationAdmissionRejection,
  AuthorizedOperationMaterialScope,
  AuthorizedOperationAdmissionResult,
  PreparedAuthorizedOperationAdmission,
} from '../../../../../authorization/service';
import {
  prepareAuthorizedOperationAdmissionRead,
  prepareAuthorizedOperationCommittedRead,
  prepareAuthorizedOperationInsert,
  prepareAuthorizedOperationRead,
} from '../authorizedOperationStatements';
import type { D1WalletStoreScope } from '../../../../../core/d1WalletStore';
import { d1ChangedRows, type D1Row } from '../../../../../storage/d1Sql';
import type { D1ResultLike } from '../../../../../storage/tenantRoute';
import {
  requireString,
  requireParsed,
  requirePositiveInteger,
  integerColumn,
  requiredText,
} from './rowValues';
import type { D1AuthorizationContext } from './context';

type AuthorizedOperationAdmissionRecord = {
  readonly row: D1Row;
  readonly operation: AuthorizedOperation;
  readonly sourceActive: boolean;
  readonly materialActive: boolean;
};

/** How a stored operation answers an admission or a resolution, with its row. */
type ExistingAuthorizedOperationAnswer =
  | {
      readonly kind: 'replayed' | 'operation_in_progress';
      readonly operation: AuthorizedOperation;
      readonly row: D1Row;
    }
  | AuthorizedOperationAdmissionRejection;

/** What one admission did, with the row it read back in the same batch. */
type AuthorizedOperationAdmissionOutcome =
  | { readonly kind: 'claimed'; readonly operation: AuthorizedOperation; readonly row: D1Row }
  | ExistingAuthorizedOperationAnswer;

async function parseAuthorizedOperationAdmissionRecord(
  row: D1Row,
): Promise<AuthorizedOperationAdmissionRecord> {
  if (row.authorization_source_active !== 0 && row.authorization_source_active !== 1) {
    throw new Error('Authorized operation source status must be a SQL boolean');
  }
  return {
    row,
    operation: await parseAuthorizedOperationRow(row),
    sourceActive: row.authorization_source_active === 1,
    materialActive: row.material_snapshot_active === 1,
  };
}

function authorizedOperationMaterialScopeMatches(
  operation: AuthorizedOperation,
  material: AuthorizedOperationMaterialScope | undefined,
  snapshot: EcdsaMaterialReadSnapshot | null,
): boolean {
  if (snapshot && snapshot.walletId !== material?.walletId) return false;
  const requiresMaterial =
    operation.operation.operation.capabilityKind === CAPABILITY_KINDS.evmEcdsaMpcSigning;
  if (!material) return !requiresMaterial;
  return (
    requiresMaterial &&
    material.runtimePolicyScope.orgId === operation.tenantId &&
    material.materialActivation.capability === operation.operation.capabilityId &&
    material.materialActivation.material_owner === material.walletId
  );
}

type AuthorizedOperationReplayMismatch =
  | { readonly kind: 'authorization_grant_rejected' }
  | { readonly kind: 'verified_step_up_rejected' }
  | { readonly kind: 'material_mismatch' };

function classifyAuthorizedOperationAdmissionError(
  error: unknown,
):
  | { readonly kind: 'authorization_grant_rejected' }
  | { readonly kind: 'verified_step_up_rejected' }
  | { readonly kind: 'wallet_session_quota_exhausted' }
  | { readonly kind: 'billing_credit_exhausted' }
  | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('billing_credit_exhausted')) return { kind: 'billing_credit_exhausted' };
  if (message.includes('authorization_wallet_session_quota_rejected')) {
    return { kind: 'wallet_session_quota_exhausted' };
  }
  if (message.includes('authorization_wallet_session_rejected')) {
    return { kind: 'authorization_grant_rejected' };
  }
  if (message.includes('authorization_evidence_claim_rejected')) {
    return { kind: 'verified_step_up_rejected' };
  }
  return null;
}

function authorizedOperationReplayMismatch(input: {
  readonly existing: D1Row;
  readonly incoming: AuthorizedOperation;
  readonly material?: AuthorizedOperationMaterialScope;
  readonly scope: D1WalletStoreScope;
}): AuthorizedOperationReplayMismatch | null {
  const sourceKind = requireString(
    input.existing.authorization_source_kind,
    'operation.authorization.kind',
  );
  if (sourceKind !== input.incoming.authorization.kind) {
    return authorizationSourceRejected(input.incoming.authorization);
  }
  if (input.incoming.authorization.kind === 'authorization_grant') {
    if (
      input.existing.owner_scope_org_id !== input.scope.orgId ||
      input.existing.owner_scope_project_id !== input.scope.projectId ||
      input.existing.owner_scope_env_id !== input.scope.envId
    ) {
      return { kind: 'authorization_grant_rejected' };
    }
    const expectedGrantKind = input.incoming.authorization.authorizationGrantRef.kind;
    if (input.existing.authorization_grant_kind !== expectedGrantKind) {
      return { kind: 'authorization_grant_rejected' };
    }
    if (
      input.existing.authorization_id !==
      input.incoming.authorization.authorizationGrantRef.authorizationId
    ) {
      return { kind: 'authorization_grant_rejected' };
    }
  } else if (
    input.existing.evidence_set_digest !== input.incoming.authorization.evidenceSetDigest ||
    input.existing.step_up_org_id !== input.scope.orgId ||
    input.existing.step_up_project_id !== input.scope.projectId ||
    input.existing.step_up_env_id !== input.scope.envId
  ) {
    return { kind: 'verified_step_up_rejected' };
  }

  const existingQuotaKind = requireString(input.existing.quota_kind, 'operation.quota.kind');
  if (existingQuotaKind !== input.incoming.quota.kind) {
    return authorizationSourceRejected(input.incoming.authorization);
  }
  if (
    existingQuotaKind === 'consume_reusable_wallet_session' &&
    input.existing.quota_id !== input.incoming.quota.quotaId
  ) {
    return { kind: 'authorization_grant_rejected' };
  }
  if (existingQuotaKind === 'quota_neutral' && input.existing.quota_id !== null) {
    return { kind: 'authorization_grant_rejected' };
  }

  if (!authorizedOperationMaterialMatches(input.existing, input.material)) {
    return { kind: 'material_mismatch' };
  }
  return null;
}

function authorizedOperationMaterialMatches(
  existing: D1Row,
  incoming: AuthorizedOperationMaterialScope | undefined,
): boolean {
  const material = incoming?.materialActivation;
  return (
    existing.material_activation_id === (material?.activation_id ?? null) &&
    existing.material_activation_capability === (material?.capability ?? null) &&
    existing.material_activation_owner === (material?.material_owner ?? null) &&
    existing.material_activation_key_binding === (material?.key_binding ?? null) &&
    existing.material_activation_lifecycle_binding === (material?.lifecycle_binding ?? null) &&
    existing.material_activation_signing_worker === (material?.signing_worker ?? null)
  );
}

function authorizationSourceRejected(
  source: AuthorizedOperation['authorization'],
): AuthorizedOperationReplayMismatch {
  return source.kind === 'verified_step_up'
    ? { kind: 'verified_step_up_rejected' }
    : { kind: 'authorization_grant_rejected' };
}

async function parseAuthorizedOperationRow(row: D1Row): Promise<AuthorizedOperation> {
  const tenantId = requireParsed(row.tenant_id, parseTenantId, 'operation.tenantId');
  const operation = buildCapabilityOperationEnvelope({
    tenantId,
    principalId: requireParsed(row.principal_id, parsePrincipalId, 'operation.principalId'),
    capabilityId: requireParsed(row.capability_id, parseCapabilityId, 'operation.capabilityId'),
    operationId: requireParsed(
      row.operation_id,
      parseCapabilityOperationId,
      'operation.operationId',
    ),
    operation: requireParsed(
      { capabilityKind: row.capability_kind, operationKind: row.operation_kind },
      parseCapabilityOperationRef,
      'operation.operation',
    ),
    digests: {
      laneDigest: parseDigestB64u(requireString(row.lane_digest, 'operation.laneDigest')),
      intentDigest: parseDigestB64u(requireString(row.intent_digest, 'operation.intentDigest')),
      displayDigest: parseDigestB64u(requireString(row.display_digest, 'operation.displayDigest')),
    },
  });
  const sourceKind = requireString(row.authorization_source_kind, 'operation.authorization.kind');
  let authorization: AuthorizedOperation['authorization'];
  if (sourceKind === 'authorization_grant') {
    if (row.evidence_set_digest != null) {
      throw new Error('operation.authorization grant row cannot contain evidenceSetDigest');
    }
    if (row.authorization_grant_kind !== 'wallet_session_authorization') {
      throw new Error('operation.authorization grant kind is invalid');
    }
    authorization = {
      kind: 'authorization_grant',
      authorizationGrantRef: requireParsed(
        {
          kind: 'wallet_session_authorization',
          authorizationId: row.authorization_id,
        },
        parseAuthorizationGrantRef,
        'operation.authorization.authorizationGrantRef',
      ),
    };
  } else if (sourceKind === 'verified_step_up') {
    if (row.authorization_id != null) {
      throw new Error('operation.authorization step-up row cannot contain authorizationId');
    }
    authorization = {
      kind: 'verified_step_up' as const,
      evidenceSetDigest: parseDigestB64u(
        requireString(row.evidence_set_digest, 'operation.authorization.evidenceSetDigest'),
      ),
    };
  } else {
    throw new Error('operation.authorization.kind is invalid');
  }
  const lifecycle = requireString(row.lifecycle_kind, 'operation.lifecycle');
  const base = {
    kind: 'authorized_operation' as const,
    tenantId,
    authorizedOperationId: requireParsed(
      row.authorized_operation_id,
      parseAuthorizedOperationId,
      'operation.authorizedOperationId',
    ),
    auditEventId: requireParsed(
      row.audit_event_id,
      parseAuthorizationAuditEventId,
      'operation.auditEventId',
    ),
    operation,
    operationFingerprintDigest: parseOperationFingerprint(row.operation_fingerprint_digest),
    authorization,
    claimedAtMs: requirePositiveInteger(row.claimed_at_ms, 'operation.claimedAtMs'),
    quota: (() => {
      const quotaKind = requireString(row.quota_kind, 'operation.quota.kind');
      if (quotaKind === 'consume_reusable_wallet_session') {
        return {
          kind: 'consume_reusable_wallet_session' as const,
          quotaId: requireParsed(row.quota_id, parseMpcWalletSigningQuotaId, 'operation.quotaId'),
        };
      }
      if (quotaKind === 'quota_neutral') {
        if (row.quota_id != null)
          throw new Error('operation.quota-neutral row cannot contain quotaId');
        return { kind: 'quota_neutral' as const };
      }
      throw new Error('operation.quota.kind is invalid');
    })(),
  };
  const expectedFingerprint = await computeCapabilityOperationFingerprintDigest(operation);
  if (expectedFingerprint !== base.operationFingerprintDigest) {
    throw new Error('operation.operationFingerprintDigest does not match operation envelope');
  }
  if (lifecycle === 'claimed') return { ...base, lifecycle: 'claimed' };
  if (lifecycle !== 'completed') throw new Error('operation.lifecycle is invalid');
  const result = requireString(row.result_kind, 'operation.result');
  if (
    result !== 'succeeded' &&
    result !== 'failed_before_side_effect' &&
    result !== 'failed_after_side_effect'
  ) {
    throw new Error('operation.result is invalid');
  }
  const response = parseAuthorizedOperationReplayResponse({
    status: integerColumn(row.result_status, 'operation.response.status'),
    contentType: requiredText(row.result_content_type, 'operation.response.contentType'),
    bodyText: requiredText(row.result_body_text, 'operation.response.bodyText'),
  });
  const resultDigest = parseDigestB64u(requireString(row.result_digest, 'operation.resultDigest'));
  const expectedResultDigest = await computeAuthorizedOperationResultDigest(response);
  if (expectedResultDigest !== resultDigest) {
    throw new Error('operation.resultDigest does not match replay response');
  }
  return {
    ...base,
    lifecycle: 'completed',
    result,
    response,
    resultDigest,
    completedAtMs: requirePositiveInteger(row.completed_at_ms, 'operation.completedAtMs'),
  };
}

function parseOperationFingerprint(value: unknown): CapabilityOperationFingerprintDigest {
  try {
    return parseCapabilityOperationFingerprintDigest(value);
  } catch (error) {
    throw new Error(
      `operation.operationFingerprintDigest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function readAuthorizedOperation(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: TenantId;
    readonly operationFingerprintDigest: CapabilityOperationFingerprintDigest;
  },
): Promise<AuthorizedOperation | null> {
  const row = await prepareAuthorizedOperationRead(
    context.database,
    context.namespace,
    input,
  ).first<D1Row>();
  return row ? await parseAuthorizedOperationRow(row) : null;
}

export async function readAuthorizedOperationById(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: TenantId;
    readonly authorizedOperationId: AuthorizedOperationId;
  },
): Promise<AuthorizedOperation | null> {
  const row = await context.database
    .prepare(
      `SELECT * FROM authorized_operations
          WHERE namespace = ? AND tenant_id = ? AND authorized_operation_id = ?
          LIMIT 1`,
    )
    .bind(context.namespace, input.tenantId, input.authorizedOperationId)
    .first<D1Row>();
  return row ? await parseAuthorizedOperationRow(row) : null;
}

export async function readPinnedOwnerWalletScope(
  context: D1AuthorizationContext,
  input: {
    readonly operation: AuthorizedOperation;
    readonly walletId: WalletId;
  },
): Promise<PinnedOwnerWalletScope> {
  const { operation, walletId } = input;
  if (
    operation.operation.operation.capabilityKind !== CAPABILITY_KINDS.nearEd25519MpcSigning &&
    operation.operation.operation.capabilityKind !== CAPABILITY_KINDS.evmEcdsaMpcSigning
  ) {
    throw new Error('Pinned owner wallet scope requires a signing operation');
  }
  const row = await prepareAuthorizedOperationCommittedRead(
    context.database,
    context.namespace,
    operation,
  ).first<D1Row>();
  if (
    !row ||
    row.authorized_operation_id !== operation.authorizedOperationId ||
    row.authorization_source_kind !== operation.authorization.kind
  ) {
    throw new Error('Pinned owner operation is not claimed');
  }
  if (operation.authorization.kind === 'verified_step_up') {
    if (
      row.evidence_set_digest !== operation.authorization.evidenceSetDigest ||
      row.pinned_owner_wallet_id !== walletId ||
      row.step_up_org_id !== context.walletSignerScope.orgId ||
      row.step_up_project_id !== context.walletSignerScope.projectId ||
      row.step_up_env_id !== context.walletSignerScope.envId
    ) {
      throw new Error('Verified step-up operation is not claimed');
    }
    return {
      ownershipGeneration: requirePositiveInteger(
        row.ownership_generation,
        'operation.ownershipGeneration',
      ),
      orgId: context.walletSignerScope.orgId,
      projectId: context.walletSignerScope.projectId,
      projectEnvironmentId: context.walletSignerScope.envId,
    };
  }
  if (row.authorization_id !== operation.authorization.authorizationGrantRef.authorizationId) {
    throw new Error('Pinned owner Wallet Session scope is unavailable');
  }
  return pinnedWalletSessionOwnerScope(row, walletId);
}

function pinnedWalletSessionOwnerScope(row: D1Row, walletId: WalletId): PinnedOwnerWalletScope {
  if (row.pinned_owner_wallet_id !== walletId) {
    throw new Error('Pinned owner Wallet Session scope is unavailable');
  }
  return {
    ownershipGeneration: requirePositiveInteger(
      row.ownership_generation,
      'operation.ownershipGeneration',
    ),
    orgId: requireString(row.owner_scope_org_id, 'operation.ownerScope.orgId'),
    projectId: requireString(row.owner_scope_project_id, 'operation.ownerScope.projectId'),
    projectEnvironmentId: requireString(
      row.owner_scope_env_id,
      'operation.ownerScope.projectEnvironmentId',
    ),
  };
}

async function readAuthorizedOperationForAdmission(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: TenantId;
    readonly operationFingerprintDigest: CapabilityOperationFingerprintDigest;
    readonly nowMs: number;
    readonly materialSnapshot: EcdsaMaterialReadSnapshot | null;
  },
): Promise<AuthorizedOperationAdmissionRecord | null> {
  const row = await prepareAuthorizedOperationAdmissionRead({
    database: context.database,
    namespace: context.namespace,
    walletSignerScope: context.walletSignerScope,
    materialSnapshot: input.materialSnapshot,
    tenantId: input.tenantId,
    operationFingerprintDigest: input.operationFingerprintDigest,
    nowMs: requirePositiveInteger(input.nowMs, 'operation replay time'),
  }).first<D1Row>();
  return row ? parseAuthorizedOperationAdmissionRecord(row) : null;
}

/** How an operation already admitted for this fingerprint answers another admission. */
function answerExistingAuthorizedOperation(
  context: D1AuthorizationContext,
  existing: AuthorizedOperationAdmissionRecord,
  operation: AuthorizedOperation,
  material: AuthorizedOperationMaterialScope | undefined,
): ExistingAuthorizedOperationAnswer {
  if (!existing.materialActive) return { kind: 'material_mismatch' };
  const replayMismatch = authorizedOperationReplayMismatch({
    existing: existing.row,
    incoming: operation,
    material,
    scope: context.walletSignerScope,
  });
  if (replayMismatch) return replayMismatch;
  if (existing.operation.lifecycle === 'completed') {
    if (existing.operation.authorization.kind === 'authorization_grant' && !existing.sourceActive) {
      return { kind: 'authorization_grant_rejected' };
    }
    return { kind: 'replayed', operation: existing.operation, row: existing.row };
  }
  if (!existing.sourceActive) {
    return authorizationSourceRejected(operation.authorization);
  }
  return { kind: 'operation_in_progress', operation: existing.operation, row: existing.row };
}

/**
 * The admission `admitAuthorizedOperation` would make, prepared for a batch
 * another store owns, after the same reads. It admits no ECDSA material:
 * that admission is conditional on the signer row, not a plain insert.
 */
export async function prepareAuthorizedOperationAdmission(
  context: D1AuthorizationContext,
  input: {
    readonly operation: AuthorizedOperationInput;
  },
): Promise<PreparedAuthorizedOperationAdmission> {
  const operation = await buildAuthorizedOperation(input.operation);
  if (operation.operation.operation.capabilityKind === CAPABILITY_KINDS.evmEcdsaMpcSigning) {
    return { kind: 'material_mismatch' };
  }
  const existing = await readAuthorizedOperationForAdmission(context, {
    tenantId: operation.tenantId,
    operationFingerprintDigest: operation.operationFingerprintDigest,
    nowMs: operation.claimedAtMs,
    materialSnapshot: null,
  });
  if (existing) {
    const result = answerExistingAuthorizedOperation(context, existing, operation, undefined);
    if (result.kind === 'replayed' || result.kind === 'operation_in_progress') {
      return { kind: result.kind, operation: result.operation };
    }
    return result;
  }
  return {
    kind: 'prepared',
    statements: [
      prepareAuthorizedOperationInsert({
        database: context.database,
        namespace: context.namespace,
        walletSignerScope: context.walletSignerScope,
        operation,
        material: null,
        materialSnapshot: null,
        existingOperation: 'reject',
      }),
    ],
  };
}

export function classifyAuthorizedOperationAdmissionFailure(
  error: unknown,
): AuthorizedOperationAdmissionRejection | null {
  return classifyAuthorizedOperationAdmissionError(error);
}

export async function admitAuthorizedOperation(
  context: D1AuthorizationContext,
  input: {
    readonly operation: AuthorizedOperationInput;
    readonly material?: AuthorizedOperationMaterialScope;
  },
): Promise<AuthorizedOperationAdmissionResult> {
  const result = await admitAuthorizedOperationRecord(context, {
    operation: input.operation,
    material: input.material,
    materialSnapshot: null,
  });
  if (
    result.kind === 'claimed' ||
    result.kind === 'replayed' ||
    result.kind === 'operation_in_progress'
  ) {
    return { kind: result.kind, operation: result.operation };
  }
  return result;
}

export async function resolveEcdsaWalletSessionOperation(
  context: D1AuthorizationContext,
  input: EcdsaWalletSessionAdmissionInput,
): Promise<EcdsaWalletSessionResolutionResult> {
  const operation = await buildAuthorizedOperation(input.operation);
  if (
    !authorizedOperationMaterialScopeMatches(operation, input.material, input.material.readSnapshot)
  ) {
    return { kind: 'material_mismatch' };
  }
  const existing = await readAuthorizedOperationForAdmission(context, {
    tenantId: operation.tenantId,
    operationFingerprintDigest: operation.operationFingerprintDigest,
    nowMs: operation.claimedAtMs,
    materialSnapshot: input.material.readSnapshot,
  });
  if (!existing) return { kind: 'authorized_operation_missing' };
  return pinExistingWalletSessionOperation(
    answerExistingAuthorizedOperation(context, existing, operation, input.material),
    input.material.walletId,
  );
}

/**
 * The stored operation answers for itself: its own grant must still be
 * active, as when a finalize request admitted it again.
 */
export async function resolveEd25519WalletSessionOperation(
  context: D1AuthorizationContext,
  input: Ed25519WalletSessionResolutionInput,
): Promise<Ed25519WalletSessionResolutionResult> {
  const existing = await readAuthorizedOperationForAdmission(context, {
    tenantId: input.tenantId,
    operationFingerprintDigest: input.operationFingerprintDigest,
    nowMs: input.nowMs,
    materialSnapshot: null,
  });
  if (!existing) return { kind: 'authorized_operation_missing' };
  if (existing.operation.authorization.kind !== 'authorization_grant') {
    return { kind: 'authorization_grant_rejected' };
  }
  return pinExistingWalletSessionOperation(
    answerExistingAuthorizedOperation(context, existing, existing.operation, undefined),
    input.walletId,
  );
}

function pinExistingWalletSessionOperation(
  result: ExistingAuthorizedOperationAnswer,
  walletId: WalletId,
): Exclude<EcdsaWalletSessionResolutionResult, { readonly kind: 'authorized_operation_missing' }> {
  switch (result.kind) {
    case 'operation_in_progress':
      return {
        kind: result.kind,
        operation: result.operation,
        ownerScope: pinnedWalletSessionOwnerScope(result.row, walletId),
      };
    case 'replayed':
      return { kind: result.kind, operation: result.operation };
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
    case 'billing_credit_exhausted':
    case 'wallet_session_quota_exhausted':
    case 'material_mismatch':
      return result;
    default: {
      const unexpected: never = result;
      throw new Error(`Unexpected Wallet Session resolution: ${unexpected}`);
    }
  }
}

export async function admitEcdsaWalletSessionOperation(
  context: D1AuthorizationContext,
  input: EcdsaWalletSessionAdmissionInput,
): Promise<EcdsaWalletSessionAdmissionResult> {
  return pinWalletSessionAdmission(
    await admitAuthorizedOperationRecord(context, {
      operation: input.operation,
      material: input.material,
      materialSnapshot: input.material.readSnapshot,
    }),
    input.material.walletId,
  );
}

export async function admitEd25519WalletSessionOperation(
  context: D1AuthorizationContext,
  input: Ed25519WalletSessionAdmissionInput,
): Promise<Ed25519WalletSessionAdmissionResult> {
  return pinWalletSessionAdmission(
    await admitAuthorizedOperationRecord(context, {
      operation: input.operation,
      material: undefined,
      materialSnapshot: null,
    }),
    input.walletId,
  );
}

/** A live operation's owner scope comes from the row its own admission read back. */
function pinWalletSessionAdmission(
  result: AuthorizedOperationAdmissionOutcome,
  walletId: WalletId,
): EcdsaWalletSessionAdmissionResult {
  if (result.kind !== 'claimed') return pinExistingWalletSessionOperation(result, walletId);
  return {
    kind: 'claimed',
    operation: result.operation,
    ownerScope: pinnedWalletSessionOwnerScope(result.row, walletId),
  };
}

async function admitAuthorizedOperationRecord(
  context: D1AuthorizationContext,
  input: {
    readonly operation: AuthorizedOperationInput;
  } & (
    | {
        readonly material: AuthorizedOperationMaterialScope | undefined;
        readonly materialSnapshot: null;
      }
    | {
        readonly material: EcdsaWalletSessionAdmissionInput['material'];
        readonly materialSnapshot: EcdsaMaterialReadSnapshot;
      }
  ),
): Promise<AuthorizedOperationAdmissionOutcome> {
  const operation = await buildAuthorizedOperation(input.operation);
  if (!authorizedOperationMaterialScopeMatches(operation, input.material, input.materialSnapshot)) {
    return { kind: 'material_mismatch' };
  }
  let committedRow: D1Row | null;
  let claimed: boolean;
  try {
    const statement = prepareAuthorizedOperationInsert({
      database: context.database,
      namespace: context.namespace,
      walletSignerScope: context.walletSignerScope,
      operation,
      material: input.material ?? null,
      materialSnapshot: input.materialSnapshot,
      existingOperation: 'preserve',
    });
    const [result, readback] = await context.database.batch<D1ResultLike<D1Row>>([
      statement,
      prepareAuthorizedOperationAdmissionRead({
        database: context.database,
        namespace: context.namespace,
        walletSignerScope: context.walletSignerScope,
        tenantId: operation.tenantId,
        operationFingerprintDigest: operation.operationFingerprintDigest,
        nowMs: operation.claimedAtMs,
        materialSnapshot: input.materialSnapshot,
      }),
    ]);
    if (!result?.success || !readback?.success) {
      throw new Error('authorized operation admission batch returned incomplete results');
    }
    claimed = d1ChangedRows(result) !== 0;
    committedRow = readback.results?.[0] ?? null;
  } catch (error: unknown) {
    const raced = await readAuthorizedOperationForAdmission(context, {
      tenantId: operation.tenantId,
      operationFingerprintDigest: operation.operationFingerprintDigest,
      nowMs: operation.claimedAtMs,
      materialSnapshot: input.materialSnapshot,
    });
    if (raced) {
      return answerExistingAuthorizedOperation(context, raced, operation, input.material);
    }
    const triggerFailure = classifyAuthorizedOperationAdmissionError(error);
    if (triggerFailure) return triggerFailure;
    throw error;
  }
  if (!committedRow) {
    if (!claimed && input.material) return { kind: 'material_mismatch' };
    if (!claimed && operation.authorization.kind === 'verified_step_up')
      return { kind: 'verified_step_up_rejected' };
    throw new Error('authorized operation admission could not be read back');
  }
  const admitted = await parseAuthorizedOperationAdmissionRecord(committedRow);
  if (!claimed)
    return answerExistingAuthorizedOperation(context, admitted, operation, input.material);
  return {
    kind: 'claimed',
    operation: admitted.operation,
    row: committedRow,
  };
}

export async function completeAuthorizedOperation(
  context: D1AuthorizationContext,
  input: {
    readonly operation: AuthorizedOperation;
    readonly result: CompletedCapabilityOperationResult;
    readonly response: AuthorizedOperationReplayResponse;
    readonly completedAtMs: number;
  },
): Promise<AuthorizedOperation> {
  const operation = input.operation;
  const statement = await prepareWalletOperationCompletion(
    context.database,
    context.namespace,
    input,
  );
  const completed = await statement.first<D1Row>();
  if (completed) return await parseAuthorizedOperationRow(completed);
  const existing = await readAuthorizedOperation(context, {
    tenantId: operation.tenantId,
    operationFingerprintDigest: operation.operationFingerprintDigest,
  });
  if (!existing) throw new Error('authorized operation completion claim is missing');
  return existing;
}
