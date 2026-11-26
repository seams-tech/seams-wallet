import {
  type WalletAuthorityId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import { type TenantId } from '@shared/authorization/capabilityKinds';
import type { D1PreparedStatementLike } from '../../../../../storage/tenantRoute';
import { requirePositiveInteger } from './rowValues';
import type { D1AuthorizationContext } from './context';

export async function retireWalletSessionAuthorizationsForAuthMethod(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: TenantId;
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly nowMs: number;
  },
): Promise<void> {
  await context.database.batch(
    prepareRetireWalletSessionAuthorizationsForAuthMethod(context, input),
  );
}

export function prepareRetireWalletSessionAuthorizationsForAuthMethod(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: TenantId;
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly nowMs: number;
  },
): readonly D1PreparedStatementLike[] {
  requirePositiveInteger(input.nowMs, 'auth-method session retirement time');
  const exhaustExactQuotas = context.database
    .prepare(
      `UPDATE authorization_wallet_session_quotas
            SET remaining_uses = 0,
                lifecycle_kind = 'exhausted'
          WHERE namespace = ?
            AND tenant_id = ?
            AND lifecycle_kind = 'active'
            AND quota_id IN (
              SELECT quota_id
                FROM wallet_session_authorizations_v2
               WHERE namespace = ?
                 AND org_id = ?
                 AND project_id = ?
                 AND env_id = ?
                 AND tenant_id = ?
                 AND wallet_id = ?
                 AND wallet_auth_method_id = ?
                 AND retired_at_ms IS NULL
            )`,
    )
    .bind(
      context.namespace,
      input.tenantId,
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      input.tenantId,
      input.walletId,
      input.walletAuthMethodId,
    );
  const retireExactSessions = context.database
    .prepare(
      `UPDATE wallet_session_authorizations_v2
            SET retired_at_ms = MAX(issued_at_ms, ?)
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND tenant_id = ?
            AND wallet_id = ?
            AND wallet_auth_method_id = ?
            AND retired_at_ms IS NULL`,
    )
    .bind(
      input.nowMs,
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      input.tenantId,
      input.walletId,
      input.walletAuthMethodId,
    );
  const [deleteHostedExchanges, retireHostedCredentials] =
    prepareRetireHostedChildrenForParentSelection(context, {
      tenantId: input.tenantId,
      nowMs: input.nowMs,
      parentSelectionSql: `
          predecessor.wallet_id = ?
          AND predecessor.wallet_auth_method_id = ?
          AND predecessor.retired_at_ms IS NULL`,
      parentSelectionBindings: [input.walletId, input.walletAuthMethodId],
    });
  return [exhaustExactQuotas, deleteHostedExchanges, retireHostedCredentials, retireExactSessions];
}

export function prepareRetireWalletSessionAuthorizationsV2ForAuthority(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: TenantId;
    readonly walletId: WalletId;
    readonly authorityId: WalletAuthorityId;
    readonly nowMs: number;
  },
): readonly D1PreparedStatementLike[] {
  requirePositiveInteger(input.nowMs, 'authority session revocation time');
  const remainingMethodFilter = `
      SELECT 1
        FROM wallet_auth_methods AS remaining_method
       WHERE remaining_method.namespace = ?
         AND remaining_method.org_id = ?
         AND remaining_method.project_id = ?
         AND remaining_method.env_id = ?
         AND remaining_method.wallet_id = ?
         AND remaining_method.wallet_authority_id = ?
         AND remaining_method.status = 'active'`;
  const remainingMethodBindings = [
    context.namespace,
    context.walletSignerScope.orgId,
    context.walletSignerScope.projectId,
    context.walletSignerScope.envId,
    input.walletId,
    input.authorityId,
  ] as const;
  const exhaustExactQuotas = context.database
    .prepare(
      `UPDATE authorization_wallet_session_quotas
            SET remaining_uses = 0,
                lifecycle_kind = 'exhausted'
          WHERE namespace = ?
            AND tenant_id = ?
            AND lifecycle_kind = 'active'
            AND quota_id IN (
              SELECT session.quota_id
                FROM wallet_session_authorizations_v2 AS session
               WHERE session.namespace = ?
                 AND session.org_id = ?
                 AND session.project_id = ?
                 AND session.env_id = ?
                 AND session.tenant_id = ?
                 AND session.wallet_id = ?
                 AND session.authority_id = ?
                 AND session.retired_at_ms IS NULL
                 AND NOT EXISTS (${remainingMethodFilter})
            )`,
    )
    .bind(
      context.namespace,
      input.tenantId,
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      input.tenantId,
      input.walletId,
      input.authorityId,
      ...remainingMethodBindings,
    );
  const retireExactSessions = context.database
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
            AND retired_at_ms IS NULL
            AND NOT EXISTS (${remainingMethodFilter})`,
    )
    .bind(
      input.nowMs,
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      input.tenantId,
      input.walletId,
      input.authorityId,
      ...remainingMethodBindings,
    );
  const [deleteHostedExchanges, retireHostedCredentials] =
    prepareRetireHostedChildrenForParentSelection(context, {
      tenantId: input.tenantId,
      nowMs: input.nowMs,
      parentSelectionSql: `
          predecessor.wallet_id = ?
          AND predecessor.authority_id = ?
          AND predecessor.retired_at_ms IS NULL
          AND NOT EXISTS (${remainingMethodFilter})`,
      parentSelectionBindings: [input.walletId, input.authorityId, ...remainingMethodBindings],
    });
  return [exhaustExactQuotas, deleteHostedExchanges, retireHostedCredentials, retireExactSessions];
}

export function prepareRetireHostedChildrenForParentSelection(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: TenantId;
    readonly nowMs: number;
    readonly parentSelectionSql: string;
    readonly parentSelectionBindings: readonly unknown[];
  },
): readonly [D1PreparedStatementLike, D1PreparedStatementLike] {
  const parentIdentityJoin = `
      predecessor.namespace = hosted.namespace
      AND predecessor.org_id = hosted.org_id
      AND predecessor.project_id = hosted.project_id
      AND predecessor.env_id = hosted.env_id
      AND predecessor.tenant_id = hosted.tenant_id
      AND predecessor.authorization_id = hosted.authorization_id
      AND predecessor.wallet_session_id = hosted.wallet_session_id
      AND predecessor.quota_id = hosted.quota_id
      AND predecessor.principal_id = hosted.principal_id
      AND predecessor.wallet_id = hosted.wallet_id
      AND predecessor.authority_id = hosted.authority_id
      AND predecessor.wallet_auth_method_id = hosted.wallet_auth_method_id`;
  const scopeBindings = [
    context.namespace,
    context.walletSignerScope.orgId,
    context.walletSignerScope.projectId,
    context.walletSignerScope.envId,
    input.tenantId,
  ] as const;
  const deleteHostedExchanges = context.database
    .prepare(
      `DELETE FROM wallet_session_hosted_exchange_codes_v2 AS hosted
          WHERE hosted.namespace = ?
            AND hosted.org_id = ?
            AND hosted.project_id = ?
            AND hosted.env_id = ?
            AND hosted.tenant_id = ?
            AND hosted.lifecycle_kind = 'issued'
            AND EXISTS (
              SELECT 1
                FROM wallet_session_authorizations_v2 AS predecessor
               WHERE ${parentIdentityJoin}
                 AND ${input.parentSelectionSql}
            )`,
    )
    .bind(...scopeBindings, ...input.parentSelectionBindings);
  const retireHostedCredentials = context.database
    .prepare(
      `UPDATE wallet_session_hosted_credentials_v2 AS hosted
            SET lifecycle_kind = 'retired',
                retired_at_ms = MAX(hosted.issued_at_ms, ?)
          WHERE hosted.namespace = ?
            AND hosted.org_id = ?
            AND hosted.project_id = ?
            AND hosted.env_id = ?
            AND hosted.tenant_id = ?
            AND hosted.lifecycle_kind = 'active'
            AND hosted.retired_at_ms IS NULL
            AND EXISTS (
              SELECT 1
                FROM wallet_session_authorizations_v2 AS predecessor
               WHERE ${parentIdentityJoin}
                 AND ${input.parentSelectionSql}
            )`,
    )
    .bind(input.nowMs, ...scopeBindings, ...input.parentSelectionBindings);
  return [deleteHostedExchanges, retireHostedCredentials];
}
