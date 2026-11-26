import type { DirectWalletSessionCommitPurpose } from '../../../../../authorization/service';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../../storage/d1Sql';
import { D1RegistrationSessionTransaction } from '../../registration/d1RegistrationSessionTransaction';
import type { D1RegistrationCommitBatch } from '../../registration/d1WalletRegistrationCommitStore';
import { type WalletId } from '@shared/utils/domainIds';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import type {
  WalletSessionAuthorizationV2,
  ActiveWalletSessionQuota,
  PersistedActiveWalletSessionAuthorizationV2,
  DirectV2CommitResult,
  WalletSessionAuthorizationV2MintLookup,
  ExactWalletSessionQuotaProjectionV1,
} from '../../../../../authorization/domain';
import type { D1WalletStoreScope } from '../../../../../core/d1WalletStore';
import { prepareD1WalletSessionAuthorityProjectionStatements } from '../walletSessionAuthorityProjection';
import { d1ChangedRows, type D1Row } from '../../../../../storage/d1Sql';
import type { D1PreparedStatementLike, D1ResultLike } from '../../../../../storage/tenantRoute';
import {
  ACTIVE_V2_AUTHORITY_METHOD_EXISTS_SQL,
  activeV2AuthorityMethodBindings,
} from './sessionBindings';
import { requirePositiveInteger } from './rowValues';
import {
  prepareWalletSessionAuthorizationV2ByMintRead,
  parseWalletSessionAuthorizationV2MintRow,
  readLiveWalletSessionAuthorizationProjectionV2,
} from './sessions';
import { prepareRetireHostedChildrenForParentSelection } from './retirement';
import type { D1AuthorizationContext } from './context';

type DirectV2CommitMode = { readonly kind: 'strict' } | { readonly kind: 'replayable' };

function requireExactWalletSessionAuthorizationV2Quota(input: {
  readonly session: WalletSessionAuthorizationV2;
  readonly quota: ActiveWalletSessionQuota | ExactWalletSessionQuotaProjectionV1;
}): void {
  if (
    input.session.tenantId !== input.quota.tenantId ||
    input.session.principalId !== input.quota.principalId ||
    input.session.walletSessionId !== input.quota.walletSessionId ||
    input.session.quotaId !== input.quota.quotaId ||
    input.session.expiresAtMs !== input.quota.expiresAtMs
  ) {
    throw new Error('V2 Wallet Session authorization and quota must have one exact identity');
  }
}

function requireExactPersistedActiveWalletSessionAuthorizationV2(
  input: PersistedActiveWalletSessionAuthorizationV2,
): void {
  if (input.kind !== 'persisted_active_wallet_session_authorization_v2') {
    throw new Error('Direct V2 Wallet Session aggregate kind is invalid');
  }
  requireExactWalletSessionAuthorizationV2Quota(input);
  parseDigestB64u(input.primaryOperationCredentialDigestB64u);
  if (input.retiredAtMs !== undefined) {
    throw new Error('Direct V2 Wallet Session aggregate cannot be retired');
  }
}

function directV2IdentityAvailabilitySql(): string {
  return `${directV2SessionIdentityAvailabilitySql()}
      AND NOT EXISTS (
        SELECT 1
          FROM authorization_wallet_session_quotas AS existing_quota
         WHERE existing_quota.namespace = ?
           AND existing_quota.tenant_id = ?
           AND existing_quota.quota_id = ?
      )`;
}

function directV2IdentityAvailabilityBindings(
  namespace: string,
  scope: D1WalletStoreScope,
  session: WalletSessionAuthorizationV2,
): readonly unknown[] {
  return [
    ...directV2SessionIdentityAvailabilityBindings(namespace, scope, session),
    namespace,
    String(session.tenantId),
    String(session.quotaId),
  ];
}

function directV2SessionIdentityAvailabilitySql(): string {
  return `
      ${ACTIVE_V2_AUTHORITY_METHOD_EXISTS_SQL}
      AND EXISTS (
        SELECT 1 FROM wallet_execution_generations
         WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
           AND wallet_id = ? AND state IN ('registering', 'active')
      )
      AND NOT EXISTS (
        SELECT 1
          FROM (
            SELECT ? AS namespace, ? AS org_id, ? AS project_id, ? AS env_id, ? AS tenant_id,
                   ? AS authorization_id, ? AS mint_id, ? AS wallet_session_id, ? AS quota_id
          ) AS candidate
         WHERE ${existingSessionWithCandidateSql('authorization_id')}
            OR ${existingSessionWithCandidateSql('mint_id')}
            OR ${existingSessionWithCandidateSql('wallet_session_id')}
            OR ${existingSessionWithCandidateSql('quota_id')}
      )`;
}

/**
 * Each of the four session identifiers has its own unique key. One lookup for
 * each key reads one row. A single lookup with the four identifiers in an OR
 * reads every session of the tenant.
 */
function existingSessionWithCandidateSql(
  identifier: 'authorization_id' | 'mint_id' | 'wallet_session_id' | 'quota_id',
): string {
  return `EXISTS (
              SELECT 1
                FROM wallet_session_authorizations_v2 AS existing
               WHERE existing.namespace = candidate.namespace
                 AND existing.org_id = candidate.org_id
                 AND existing.project_id = candidate.project_id
                 AND existing.env_id = candidate.env_id
                 AND existing.tenant_id = candidate.tenant_id
                 AND existing.${identifier} = candidate.${identifier}
            )`;
}

function directV2SessionIdentityAvailabilityBindings(
  namespace: string,
  scope: D1WalletStoreScope,
  session: WalletSessionAuthorizationV2,
): readonly unknown[] {
  return [
    ...activeV2AuthorityMethodBindings(scope, session),
    namespace,
    scope.orgId,
    scope.projectId,
    scope.envId,
    String(session.walletId),
    namespace,
    scope.orgId,
    scope.projectId,
    scope.envId,
    String(session.tenantId),
    String(session.authorizationId),
    String(session.mintId),
    String(session.walletSessionId),
    String(session.quotaId),
  ];
}

function assertNeverDirectV2CommitMode(value: never): never {
  throw new Error(`Unsupported direct V2 Wallet Session commit mode: ${String(value)}`);
}

function assertNeverDirectWalletSessionCommitPurpose(value: never): never {
  throw new Error(`Unsupported Wallet Session commit purpose: ${String(value)}`);
}

export async function commitDirectWalletSessionAuthorizationV2(
  context: D1AuthorizationContext,
  input: {
    readonly persisted: PersistedActiveWalletSessionAuthorizationV2;
  },
): Promise<DirectV2CommitResult> {
  return await commitDirectWalletSessionAuthorizationV2WithMode(context, {
    persisted: input.persisted,
    mode: { kind: 'strict' },
    purpose: { kind: 'ordinary' },
  });
}

export async function readWalletSessionIssuanceGeneration(
  context: D1AuthorizationContext,
  walletId: WalletId,
): Promise<number> {
  const row = await prepareWalletSessionIssuanceGenerationRead(context, walletId).first<D1Row>();
  if (!row) throw new Error('Wallet session issuance requires an open execution generation');
  return requirePositiveInteger(row.generation, 'Wallet Session ownership generation');
}

function prepareWalletSessionIssuanceGenerationRead(
  context: D1AuthorizationContext,
  walletId: WalletId,
): D1PreparedStatementLike {
  return context.database
    .prepare(
      `SELECT generation, state FROM wallet_execution_generations
       WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
         AND wallet_id = ? AND state IN ('registering', 'active')`,
    )
    .bind(
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      walletId,
    );
}

/** The service validates the committed winner against its caller-specific replay contract. */
export async function commitDirectReplayableWalletSessionAuthorizationV2(
  context: D1AuthorizationContext,
  input: {
    readonly persisted: PersistedActiveWalletSessionAuthorizationV2;
    readonly purpose: DirectWalletSessionCommitPurpose;
  },
): Promise<DirectV2CommitResult> {
  return await commitDirectWalletSessionAuthorizationV2WithMode(context, {
    persisted: input.persisted,
    mode: { kind: 'replayable' },
    purpose: input.purpose,
  });
}

export async function commitRegistrationWalletSessionAuthorizationV2(
  context: D1AuthorizationContext,
  commitWallet: (executeBatch: D1RegistrationCommitBatch) => Promise<void>,
  input: {
    readonly persisted: PersistedActiveWalletSessionAuthorizationV2;
    readonly purpose: DirectWalletSessionCommitPurpose;
  },
): Promise<DirectV2CommitResult> {
  if (input.purpose.kind !== 'registration') {
    throw new Error('A wallet registration transaction requires a registration session');
  }
  const transaction = new D1RegistrationSessionTransaction(context.database, commitWallet);
  return commitDirectWalletSessionAuthorizationV2WithMode(
    context,
    { persisted: input.persisted, purpose: input.purpose, mode: { kind: 'replayable' } },
    transaction.execute.bind(transaction),
  );
}

async function commitDirectWalletSessionAuthorizationV2WithMode(
  context: D1AuthorizationContext,
  input: {
    readonly persisted: PersistedActiveWalletSessionAuthorizationV2;
    readonly mode: DirectV2CommitMode;
    readonly purpose: DirectWalletSessionCommitPurpose;
  },
  executeBatch?: (
    statements: readonly D1PreparedStatementLike[],
  ) => Promise<readonly D1ResultLike<D1Row>[]>,
): Promise<DirectV2CommitResult> {
  const { persisted, mode } = input;
  requireExactPersistedActiveWalletSessionAuthorizationV2(persisted);
  const lookup: WalletSessionAuthorizationV2MintLookup = {
    tenantId: persisted.session.tenantId,
    principalId: persisted.session.principalId,
    walletId: persisted.session.walletId,
    authorityId: persisted.session.authorityId,
    walletAuthMethodId: persisted.session.walletAuthMethodId,
    mintId: persisted.session.mintId,
  };
  const completionStatements = prepareRegistrationSessionCompletion(context, input.purpose, lookup);
  const statements = [
    ...prepareDirectWalletSessionAuthorizationV2Statements(context, persisted),
    prepareWalletSessionAuthorizationV2ByMintRead(context, lookup),
    prepareWalletSessionIssuanceGenerationRead(context, persisted.session.walletId),
    ...completionStatements,
  ];
  const results = executeBatch
    ? await executeBatch(statements)
    : await context.database.batch<D1ResultLike<D1Row>>(statements);
  if (results.length !== 8 + completionStatements.length) {
    throw new Error('Direct V2 Wallet Session transaction returned incomplete results');
  }
  const quotaResult = results[4];
  const sessionResult = results[5];
  const committedResult = results[6];
  if (!quotaResult || !sessionResult || !committedResult?.success) {
    throw new Error('Direct V2 Wallet Session transaction returned incomplete results');
  }
  const quotaChanges = d1ChangedRows(quotaResult);
  const sessionChanges = d1ChangedRows(sessionResult);
  if (quotaChanges !== sessionChanges) {
    throw new Error('Direct V2 Wallet Session transaction persisted an incomplete identity');
  }
  // Read the committed winner in the same transaction, including a concurrent mint replay.
  const committed = parseWalletSessionAuthorizationV2MintRow(
    committedResult.results?.[0] ?? null,
    lookup,
  );
  const generationResult = results[7];
  const generation = generationResult?.results?.[0];
  let registration: DirectV2CommitResult['registration'] = null;
  if (input.purpose.kind === 'registration') {
    if (
      !generationResult?.success ||
      (generation?.state !== 'registering' && generation?.state !== 'active')
    ) {
      throw new Error('Registration session commit requires an open execution generation');
    }
    registration = {
      ceremonyId: input.purpose.ceremonyId,
      walletId: lookup.walletId,
      state: generation.state,
    };
  }
  if (!committed) {
    if (!generationResult?.success || !generation) {
      throw new Error('Wallet session issuance requires an open execution generation');
    }
    throw new Error('Direct V2 Wallet Session authorization commit was not readable');
  }
  if (sessionChanges === 0) {
    switch (mode.kind) {
      case 'strict':
        break;
      case 'replayable':
        return { kind: 'already_committed', committed, registration };
      default:
        return assertNeverDirectV2CommitMode(mode);
    }
  }
  if (committed.session.walletSessionId !== persisted.session.walletSessionId) {
    throw new Error('Direct V2 Wallet Session commit returned a different session identity');
  }
  if (
    committed.primaryOperationCredentialDigestB64u !==
    persisted.primaryOperationCredentialDigestB64u
  ) {
    throw new Error('Direct V2 Wallet Session commit returned a different credential digest');
  }
  if (sessionChanges === 0) {
    return { kind: 'already_committed', committed, registration };
  }
  if (sessionChanges !== 1) {
    throw new Error('Direct V2 Wallet Session transaction changed more than one session');
  }
  if (!generationResult?.success || !generation) {
    throw new Error('Wallet session issuance requires an open execution generation');
  }
  return {
    kind: 'inserted',
    registration,
    ownershipGeneration: requirePositiveInteger(
      generation.generation,
      'Wallet Session ownership generation',
    ),
  };
}

function prepareRegistrationSessionCompletion(
  context: D1AuthorizationContext,
  purpose: DirectWalletSessionCommitPurpose,
  session: WalletSessionAuthorizationV2MintLookup,
): readonly D1PreparedStatementLike[] {
  switch (purpose.kind) {
    case 'ordinary':
      return [];
    case 'registration':
      return [
        context.database
          .prepare(
            `UPDATE wallet_execution_generations SET registration_completion = 'established'
             WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
               AND wallet_id = ?5 AND origin = 'registration' AND origin_id = ?6
               AND state IN ('registering', 'active')
               AND registration_completion IN ('pending', 'established')
               AND EXISTS (
                 SELECT 1 FROM wallet_session_authorizations_v2
                 WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
                   AND wallet_id = ?5 AND tenant_id = ?7 AND principal_id = ?8
                   AND authority_id = ?9 AND wallet_auth_method_id = ?10 AND mint_id = ?11
               )`,
          )
          .bind(
            context.namespace,
            context.walletSignerScope.orgId,
            context.walletSignerScope.projectId,
            context.walletSignerScope.envId,
            session.walletId,
            purpose.ceremonyId,
            session.tenantId,
            String(session.principalId),
            session.authorityId,
            session.walletAuthMethodId,
            session.mintId,
          ),
        context.database.prepare(D1_BATCH_CAS_GUARD_SQL),
      ];
    default:
      return assertNeverDirectWalletSessionCommitPurpose(purpose);
  }
}

/**
 * Builds the one batch used by direct issuance. Every predecessor mutation
 * is gated by the candidate identity check, so a same-mint replay leaves
 * the committed session and its predecessor state untouched.
 */
export function prepareDirectWalletSessionAuthorizationV2Statements(
  context: D1AuthorizationContext,
  persisted: PersistedActiveWalletSessionAuthorizationV2,
): readonly [
  D1PreparedStatementLike,
  D1PreparedStatementLike,
  D1PreparedStatementLike,
  D1PreparedStatementLike,
  D1PreparedStatementLike,
  D1PreparedStatementLike,
] {
  requireExactPersistedActiveWalletSessionAuthorizationV2(persisted);
  const { session, quota, primaryOperationCredentialDigestB64u } = persisted;
  const capabilitySubjectsJson = JSON.stringify(session.capabilitySubjects);
  const recordJson = JSON.stringify(session);
  if (!capabilitySubjectsJson || !recordJson) {
    throw new Error('Direct V2 Wallet Session authorization serialization is required');
  }
  const availabilitySql = directV2IdentityAvailabilitySql();
  const availabilityBindings = directV2IdentityAvailabilityBindings(
    context.namespace,
    context.walletSignerScope,
    session,
  );
  const sessionIdentityAvailabilitySql = directV2SessionIdentityAvailabilitySql();
  const sessionIdentityAvailabilityBindings = directV2SessionIdentityAvailabilityBindings(
    context.namespace,
    context.walletSignerScope,
    session,
  );
  const retirePredecessorSessions = context.database
    .prepare(
      `UPDATE wallet_session_authorizations_v2
            SET retired_at_ms = MAX(issued_at_ms, ?)
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND tenant_id = ?
            AND wallet_id = ?
            AND authority_id = ?
            AND wallet_auth_method_id = ?
            AND retired_at_ms IS NULL
            AND mint_id != ?
            AND ${availabilitySql}`,
    )
    .bind(
      requirePositiveInteger(session.createdAtMs, 'Direct V2 issuance time'),
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      session.tenantId,
      String(session.walletId),
      String(session.authorityId),
      String(session.walletAuthMethodId),
      String(session.mintId),
      ...availabilityBindings,
    );
  const exhaustPredecessorQuotas = context.database
    .prepare(
      `UPDATE authorization_wallet_session_quotas
            SET remaining_uses = 0,
                lifecycle_kind = 'exhausted'
          WHERE namespace = ?
            AND tenant_id = ?
            AND quota_id IN (
              SELECT predecessor.quota_id
                FROM wallet_session_authorizations_v2 AS predecessor
               WHERE predecessor.namespace = ?
                 AND predecessor.org_id = ?
                 AND predecessor.project_id = ?
                 AND predecessor.env_id = ?
                 AND predecessor.tenant_id = ?
                 AND predecessor.wallet_id = ?
                 AND predecessor.authority_id = ?
                 AND predecessor.wallet_auth_method_id = ?
                 AND predecessor.mint_id != ?
                 AND predecessor.retired_at_ms IS NULL
            )
            AND ${availabilitySql}`,
    )
    .bind(
      context.namespace,
      session.tenantId,
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      session.tenantId,
      String(session.walletId),
      String(session.authorityId),
      String(session.walletAuthMethodId),
      String(session.mintId),
      ...availabilityBindings,
    );
  const quotaStatement = context.database
    .prepare(
      `INSERT OR IGNORE INTO authorization_wallet_session_quotas (
          namespace,
          tenant_id,
          quota_id,
          wallet_session_id,
          principal_id,
          remaining_uses,
          lifecycle_kind,
          expires_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, 'active', ?
         WHERE ${availabilitySql}`,
    )
    .bind(
      context.namespace,
      quota.tenantId,
      String(quota.quotaId),
      String(quota.walletSessionId),
      String(quota.principalId),
      requirePositiveInteger(quota.remainingUses, 'Direct V2 quota.remainingUses'),
      requirePositiveInteger(quota.expiresAtMs, 'Direct V2 quota.expiresAtMs'),
      ...availabilityBindings,
    );
  const sessionStatement = context.database
    .prepare(
      `INSERT OR IGNORE INTO wallet_session_authorizations_v2 (
          namespace,
          org_id,
          project_id,
          env_id,
          tenant_id,
          authorization_id,
          mint_id,
          wallet_session_id,
          quota_id,
          principal_id,
          wallet_id,
          authority_id,
          wallet_auth_method_id,
          authority_digest_b64u,
          authority_revocation_epoch,
          capability_subjects_json,
          issued_at_ms,
          expires_at_ms,
          retired_at_ms,
          record_json,
          operation_credential_hash
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?
         WHERE ${sessionIdentityAvailabilitySql}
           AND EXISTS (
             SELECT 1
               FROM authorization_wallet_session_quotas AS quota
              WHERE quota.namespace = ?
                AND quota.tenant_id = ?
                AND quota.quota_id = ?
                AND quota.wallet_session_id = ?
                AND quota.principal_id = ?
                AND quota.remaining_uses = ?
                AND quota.lifecycle_kind = 'active'
                AND quota.expires_at_ms = ?
           )`,
    )
    .bind(
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      session.tenantId,
      String(session.authorizationId),
      String(session.mintId),
      String(session.walletSessionId),
      String(session.quotaId),
      String(session.principalId),
      String(session.walletId),
      String(session.authorityId),
      String(session.walletAuthMethodId),
      String(session.authorityDigestB64u),
      session.authorityRevocationEpoch,
      capabilitySubjectsJson,
      requirePositiveInteger(session.createdAtMs, 'Direct V2 session.createdAtMs'),
      requirePositiveInteger(session.expiresAtMs, 'Direct V2 session.expiresAtMs'),
      recordJson,
      String(primaryOperationCredentialDigestB64u),
      ...sessionIdentityAvailabilityBindings,
      context.namespace,
      quota.tenantId,
      String(quota.quotaId),
      String(quota.walletSessionId),
      String(quota.principalId),
      requirePositiveInteger(quota.remainingUses, 'Direct V2 quota.remainingUses'),
      requirePositiveInteger(quota.expiresAtMs, 'Direct V2 quota.expiresAtMs'),
    );
  const [deleteHostedExchanges, retireHostedCredentials] =
    prepareRetireHostedChildrenForParentSelection(context, {
      tenantId: session.tenantId,
      nowMs: session.createdAtMs,
      parentSelectionSql: `
          predecessor.wallet_id = ?
          AND predecessor.authority_id = ?
          AND predecessor.wallet_auth_method_id = ?
          AND predecessor.mint_id != ?
          AND predecessor.retired_at_ms IS NULL
          AND ${availabilitySql}`,
      parentSelectionBindings: [
        session.walletId,
        session.authorityId,
        session.walletAuthMethodId,
        session.mintId,
        ...availabilityBindings,
      ],
    });
  return [
    exhaustPredecessorQuotas,
    deleteHostedExchanges,
    retireHostedCredentials,
    retirePredecessorSessions,
    quotaStatement,
    sessionStatement,
  ];
}

export async function replaceWalletSessionAuthorizationV2AuthorityProjection(
  context: D1AuthorizationContext,
  input: {
    readonly session: WalletSessionAuthorizationV2;
    readonly quota: ActiveWalletSessionQuota | ExactWalletSessionQuotaProjectionV1;
  },
): Promise<void> {
  requireExactWalletSessionAuthorizationV2Quota(input);
  const statements = prepareWalletSessionAuthorizationV2AuthorityProjectionStatements(context, {
    session: input.session,
    promotionAtMs: input.session.createdAtMs,
  });
  const results = await context.database.batch(statements);
  if (results.length !== statements.length) {
    throw new Error(
      'V2 Wallet Session authority projection transaction returned incomplete results',
    );
  }
  const result = results.at(-1) as D1ResultLike | undefined;
  if (!result || d1ChangedRows(result) === 0) {
    throw new Error('V2 Wallet Session authority projection was not replaced');
  }
  const persisted = await readLiveWalletSessionAuthorizationProjectionV2(context, {
    expected: input.session,
    nowMs: input.session.createdAtMs,
  });
  if (!persisted || persisted.quota.remainingUses > input.quota.remainingUses) {
    throw new Error('V2 Wallet Session authority projection was not replaced');
  }
}

export function prepareWalletSessionAuthorizationV2AuthorityProjectionStatements(
  context: D1AuthorizationContext,
  input: {
    readonly session: WalletSessionAuthorizationV2;
    readonly promotionAtMs: number;
  },
): readonly [D1PreparedStatementLike, D1PreparedStatementLike, D1PreparedStatementLike] {
  return prepareD1WalletSessionAuthorityProjectionStatements({
    database: context.database,
    scope: context.walletSignerScope,
    projection: {
      walletId: input.session.walletId,
      authorityId: input.session.authorityId,
      authorityDigestB64u: input.session.authorityDigestB64u,
      authorityRevocationEpoch: input.session.authorityRevocationEpoch,
      capabilitySubjects: input.session.capabilitySubjects,
      promotionAtMs: input.promotionAtMs,
    },
  });
}
