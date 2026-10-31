import {
  parseTenantId,
  parseWalletSessionAuthorizationId,
  parseWalletSessionId,
  type TenantId,
} from '@shared/authorization/capabilityKinds';
import type {
  IssuedWalletSessionAuthorizationV2,
  IssuedHostedWalletSeamsSessionExchangeV2,
  RedeemHostedWalletSeamsSessionExchangeV2Input,
  PersistedHostedWalletSeamsSessionExchangeV2Result,
  ResolvedHostedWalletSessionOperationCredentialV2,
} from '../../../../../authorization/domain';
import {
  parseSessionOrigin,
  parseHostedWalletSessionCredentialId,
} from '../../../../../authorization/domain';
import { d1ChangedRows, parseD1JsonColumn } from '../../../../../storage/d1Sql';
import type { D1ResultLike } from '../../../../../storage/tenantRoute';
import { parsePersistedWalletSessionAuthorizationV2 } from '../persistedWalletSessionAuthorization';
import {
  integerColumn,
  requirePositiveInteger,
  requireOneChangedRow,
  requireParsed,
} from './rowValues';
import { ACTIVE_V2_HOSTED_PARENT_PROVENANCE_SQL } from './sessionBindings';
import { readWalletSessionAuthorizationV2ByAuthorizationId } from './sessions';
import type { D1AuthorizationContext } from './context';

type HostedWalletExchangeV2Row = {
  readonly namespace?: unknown;
  readonly org_id?: unknown;
  readonly project_id?: unknown;
  readonly env_id?: unknown;
  readonly tenant_id?: unknown;
  readonly exchange_code_id?: unknown;
  readonly authorization_id?: unknown;
  readonly wallet_session_id?: unknown;
  readonly quota_id?: unknown;
  readonly principal_id?: unknown;
  readonly wallet_id?: unknown;
  readonly authority_id?: unknown;
  readonly wallet_auth_method_id?: unknown;
  readonly code_hash?: unknown;
  readonly nonce_digest?: unknown;
  readonly app_origin?: unknown;
  readonly wallet_origin?: unknown;
  readonly issued_at_ms?: unknown;
  readonly lifecycle_kind?: unknown;
  readonly expires_at_ms?: unknown;
  readonly hosted_credential_id?: unknown;
  readonly consumed_at_ms?: unknown;
  readonly credential_digest_b64u?: unknown;
  readonly session_record_json?: unknown;
  readonly credential_lifecycle_kind?: unknown;
  readonly credential_retired_at_ms?: unknown;
  readonly session_operation_credential_hash?: unknown;
  readonly session_retired_at_ms?: unknown;
  readonly session_expires_at_ms?: unknown;
  readonly quota_remaining_uses?: unknown;
  readonly quota_lifecycle_kind?: unknown;
  readonly quota_expires_at_ms?: unknown;
};

function classifyHostedWalletExchangeV2(
  row: HostedWalletExchangeV2Row | null,
  input: RedeemHostedWalletSeamsSessionExchangeV2Input,
): PersistedHostedWalletSeamsSessionExchangeV2Result | null {
  if (!row) return { kind: 'invalid_code' };
  if (row.lifecycle_kind === 'consumed') return { kind: 'already_consumed' };
  if (row.lifecycle_kind !== 'issued') return { kind: 'invalid_code' };
  if (integerColumn(row.expires_at_ms, 'exchange.expiresAtMs') <= input.redeemedAtMs) {
    return { kind: 'expired' };
  }
  if (row.nonce_digest !== input.nonceDigest) return { kind: 'nonce_mismatch' };
  if (row.app_origin !== input.appOrigin) return { kind: 'app_origin_mismatch' };
  if (row.wallet_origin !== input.walletOrigin) return { kind: 'wallet_origin_mismatch' };
  if (
    row.session_operation_credential_hash === null ||
    row.session_operation_credential_hash === undefined ||
    (row.session_retired_at_ms !== null && row.session_retired_at_ms !== undefined) ||
    row.quota_lifecycle_kind !== 'active' ||
    integerColumn(row.quota_remaining_uses, 'exchange.quotaRemainingUses') <= 0 ||
    integerColumn(row.session_expires_at_ms, 'exchange.sessionExpiresAtMs') <= input.redeemedAtMs ||
    integerColumn(row.session_expires_at_ms, 'exchange.sessionExpiresAtMs') <
      integerColumn(row.expires_at_ms, 'exchange.expiresAtMs') ||
    integerColumn(row.quota_expires_at_ms, 'exchange.quotaExpiresAtMs') <= input.redeemedAtMs ||
    integerColumn(row.quota_expires_at_ms, 'exchange.quotaExpiresAtMs') <
      integerColumn(row.expires_at_ms, 'exchange.expiresAtMs')
  ) {
    return { kind: 'wallet_session_unavailable' };
  }
  return null;
}

export async function putIssuedHostedWalletSeamsSessionExchange(
  context: D1AuthorizationContext,
  exchange: IssuedHostedWalletSeamsSessionExchangeV2,
): Promise<void> {
  if (exchange.kind !== 'issued_hosted_wallet_session_exchange_v2') {
    throw new Error('hosted-wallet exchange kind is invalid');
  }
  const result = await context.database
    .prepare(
      `INSERT INTO wallet_session_hosted_exchange_codes_v2 (
          namespace,
          org_id,
          project_id,
          env_id,
          tenant_id,
          exchange_code_id,
          authorization_id,
          wallet_session_id,
          quota_id,
          principal_id,
          wallet_id,
          authority_id,
          wallet_auth_method_id,
          code_hash,
          nonce_digest,
          app_origin,
          wallet_origin,
          issued_at_ms,
          expires_at_ms,
          lifecycle_kind,
          hosted_credential_id,
          consumed_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', NULL, NULL
          FROM wallet_session_authorizations_v2 AS session
          JOIN authorization_wallet_session_quotas AS quota
            ON quota.namespace = session.namespace
           AND quota.tenant_id = session.tenant_id
           AND quota.quota_id = session.quota_id
           AND quota.wallet_session_id = session.wallet_session_id
           AND quota.principal_id = session.principal_id
         WHERE session.namespace = ?
           AND session.org_id = ?
           AND session.project_id = ?
           AND session.env_id = ?
           AND session.tenant_id = ?
           AND session.authorization_id = ?
           AND session.wallet_session_id = ?
           AND session.quota_id = ?
           AND session.principal_id = ?
           AND session.wallet_id = ?
           AND session.authority_id = ?
           AND session.wallet_auth_method_id = ?
           AND session.operation_credential_hash IS NOT NULL
           AND session.retired_at_ms IS NULL
           AND session.expires_at_ms >= ?
           AND quota.lifecycle_kind = 'active'
           AND quota.remaining_uses > 0
           AND quota.expires_at_ms >= ?
           AND ${ACTIVE_V2_HOSTED_PARENT_PROVENANCE_SQL}`,
    )
    .bind(
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      exchange.tenantId,
      exchange.exchangeCodeId,
      exchange.authorizationId,
      exchange.walletSessionId,
      exchange.quotaId,
      exchange.principalId,
      exchange.walletId,
      exchange.authorityId,
      exchange.walletAuthMethodId,
      exchange.codeHash,
      exchange.nonceDigest,
      exchange.appOrigin,
      exchange.walletOrigin,
      requirePositiveInteger(exchange.issuedAtMs, 'exchange.issuedAtMs'),
      requirePositiveInteger(exchange.expiresAtMs, 'exchange.expiresAtMs'),
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      exchange.tenantId,
      exchange.authorizationId,
      exchange.walletSessionId,
      exchange.quotaId,
      exchange.principalId,
      exchange.walletId,
      exchange.authorityId,
      exchange.walletAuthMethodId,
      exchange.expiresAtMs,
      exchange.expiresAtMs,
    )
    .run();
  requireOneChangedRow(result, 'hosted-wallet Seams session exchange code');
}

export async function redeemHostedWalletSeamsSessionExchange(
  context: D1AuthorizationContext,
  input: RedeemHostedWalletSeamsSessionExchangeV2Input,
  publishCredentialLocator?: () => Promise<void>,
): Promise<PersistedHostedWalletSeamsSessionExchangeV2Result> {
  const current = await readHostedWalletExchangeV2(context, input.codeHash);
  const rejected = classifyHostedWalletExchangeV2(current, input);
  if (rejected) return rejected;
  if (!current) throw new Error('hosted-wallet exchange disappeared');
  // Publish after validation and before consuming the one-use exchange.
  await publishCredentialLocator?.();
  try {
    const insertCredential = context.database
      .prepare(
        `INSERT INTO wallet_session_hosted_credentials_v2 (
            namespace,
            org_id,
            project_id,
            env_id,
            tenant_id,
            hosted_credential_id,
            authorization_id,
            wallet_session_id,
            quota_id,
            principal_id,
            wallet_id,
            authority_id,
            wallet_auth_method_id,
            credential_digest_b64u,
            app_origin,
            wallet_origin,
            issued_at_ms,
            expires_at_ms,
            lifecycle_kind,
            retired_at_ms
          )
          SELECT exchange.namespace,
                 exchange.org_id,
                 exchange.project_id,
                 exchange.env_id,
                 exchange.tenant_id,
                 ?,
                 exchange.authorization_id,
                 exchange.wallet_session_id,
                 exchange.quota_id,
                 exchange.principal_id,
                 exchange.wallet_id,
                 exchange.authority_id,
                 exchange.wallet_auth_method_id,
                 ?,
                 exchange.app_origin,
                 exchange.wallet_origin,
                 exchange.issued_at_ms,
                 exchange.expires_at_ms,
                 'active',
                 NULL
            FROM wallet_session_hosted_exchange_codes_v2 AS exchange
            JOIN wallet_session_authorizations_v2 AS session
              ON session.namespace = exchange.namespace
             AND session.org_id = exchange.org_id
             AND session.project_id = exchange.project_id
             AND session.env_id = exchange.env_id
             AND session.tenant_id = exchange.tenant_id
             AND session.authorization_id = exchange.authorization_id
             AND session.wallet_session_id = exchange.wallet_session_id
             AND session.quota_id = exchange.quota_id
             AND session.principal_id = exchange.principal_id
             AND session.wallet_id = exchange.wallet_id
             AND session.authority_id = exchange.authority_id
             AND session.wallet_auth_method_id = exchange.wallet_auth_method_id
            JOIN authorization_wallet_session_quotas AS quota
              ON quota.namespace = exchange.namespace
             AND quota.tenant_id = exchange.tenant_id
             AND quota.quota_id = exchange.quota_id
             AND quota.wallet_session_id = exchange.wallet_session_id
             AND quota.principal_id = exchange.principal_id
           WHERE exchange.namespace = ?
             AND exchange.org_id = ?
             AND exchange.project_id = ?
             AND exchange.env_id = ?
             AND exchange.tenant_id = ?
             AND exchange.code_hash = ?
             AND exchange.nonce_digest = ?
             AND exchange.app_origin = ?
             AND exchange.wallet_origin = ?
             AND exchange.lifecycle_kind = 'issued'
             AND exchange.hosted_credential_id IS NULL
             AND exchange.consumed_at_ms IS NULL
             AND exchange.expires_at_ms > ?
             AND session.operation_credential_hash IS NOT NULL
             AND session.retired_at_ms IS NULL
             AND session.expires_at_ms >= exchange.expires_at_ms
             AND quota.lifecycle_kind = 'active'
             AND quota.remaining_uses > 0
             AND quota.expires_at_ms >= exchange.expires_at_ms
             AND ${ACTIVE_V2_HOSTED_PARENT_PROVENANCE_SQL}`,
      )
      .bind(
        input.hostedCredentialId,
        input.tokenHash,
        context.namespace,
        context.walletSignerScope.orgId,
        context.walletSignerScope.projectId,
        context.walletSignerScope.envId,
        current.tenant_id,
        input.codeHash,
        input.nonceDigest,
        input.appOrigin,
        input.walletOrigin,
        requirePositiveInteger(input.redeemedAtMs, 'exchange.redeemedAtMs'),
      );
    const updateStatement = context.database
      .prepare(
        `UPDATE wallet_session_hosted_exchange_codes_v2 AS exchange
              SET lifecycle_kind = 'consumed',
                  hosted_credential_id = ?,
                  consumed_at_ms = ?
            WHERE exchange.namespace = ?
              AND exchange.org_id = ?
              AND exchange.project_id = ?
              AND exchange.env_id = ?
              AND exchange.tenant_id = ?
              AND exchange.code_hash = ?
              AND exchange.nonce_digest = ?
              AND exchange.app_origin = ?
              AND exchange.wallet_origin = ?
              AND exchange.lifecycle_kind = 'issued'
              AND exchange.hosted_credential_id IS NULL
              AND exchange.consumed_at_ms IS NULL
              AND exchange.expires_at_ms > ?
              AND EXISTS (
                SELECT 1
                  FROM wallet_session_authorizations_v2 AS session
                 WHERE session.namespace = exchange.namespace
                   AND session.org_id = exchange.org_id
                   AND session.project_id = exchange.project_id
                   AND session.env_id = exchange.env_id
                   AND session.tenant_id = exchange.tenant_id
                   AND session.authorization_id = exchange.authorization_id
                   AND session.wallet_session_id = exchange.wallet_session_id
                   AND session.quota_id = exchange.quota_id
                   AND session.principal_id = exchange.principal_id
                   AND session.wallet_id = exchange.wallet_id
                   AND session.authority_id = exchange.authority_id
                   AND session.wallet_auth_method_id = exchange.wallet_auth_method_id
                   AND session.operation_credential_hash IS NOT NULL
                   AND session.retired_at_ms IS NULL
                   AND session.expires_at_ms >= exchange.expires_at_ms
                   AND session.expires_at_ms > ?
                   AND ${ACTIVE_V2_HOSTED_PARENT_PROVENANCE_SQL}
              )
              AND EXISTS (
                SELECT 1
                  FROM authorization_wallet_session_quotas AS quota
                 WHERE quota.namespace = exchange.namespace
                   AND quota.tenant_id = exchange.tenant_id
                   AND quota.quota_id = exchange.quota_id
                   AND quota.wallet_session_id = exchange.wallet_session_id
                   AND quota.principal_id = exchange.principal_id
                   AND quota.lifecycle_kind = 'active'
                   AND quota.remaining_uses > 0
                   AND quota.expires_at_ms >= exchange.expires_at_ms
              )
              AND EXISTS (
                SELECT 1
                  FROM wallet_session_hosted_credentials_v2 AS credential
                 WHERE credential.namespace = exchange.namespace
                   AND credential.org_id = exchange.org_id
                   AND credential.project_id = exchange.project_id
                   AND credential.env_id = exchange.env_id
                   AND credential.tenant_id = exchange.tenant_id
                   AND credential.hosted_credential_id = ?
                   AND credential.authorization_id = exchange.authorization_id
                   AND credential.wallet_session_id = exchange.wallet_session_id
                   AND credential.quota_id = exchange.quota_id
                   AND credential.principal_id = exchange.principal_id
                   AND credential.wallet_id = exchange.wallet_id
                   AND credential.authority_id = exchange.authority_id
                   AND credential.wallet_auth_method_id = exchange.wallet_auth_method_id
                   AND credential.credential_digest_b64u = ?
                   AND credential.lifecycle_kind = 'active'
                   AND credential.retired_at_ms IS NULL
                   AND credential.expires_at_ms >= exchange.expires_at_ms
              )`,
      )
      .bind(
        input.hostedCredentialId,
        requirePositiveInteger(input.redeemedAtMs, 'exchange.redeemedAtMs'),
        context.namespace,
        context.walletSignerScope.orgId,
        context.walletSignerScope.projectId,
        context.walletSignerScope.envId,
        current.tenant_id,
        input.codeHash,
        input.nonceDigest,
        input.appOrigin,
        input.walletOrigin,
        input.redeemedAtMs,
        input.redeemedAtMs,
        input.hostedCredentialId,
        input.tokenHash,
      );
    // A zero-row CAS result is not a D1 statement error, so remove a child
    // inserted by this batch if the exchange CAS no longer accepts it.
    const deleteOrphanedCredential = context.database
      .prepare(
        `DELETE FROM wallet_session_hosted_credentials_v2 AS credential
            WHERE credential.namespace = ?
              AND credential.org_id = ?
              AND credential.project_id = ?
              AND credential.env_id = ?
              AND credential.tenant_id = ?
              AND credential.hosted_credential_id = ?
              AND credential.authorization_id = ?
              AND credential.wallet_session_id = ?
              AND credential.quota_id = ?
              AND credential.principal_id = ?
              AND credential.wallet_id = ?
              AND credential.authority_id = ?
              AND credential.wallet_auth_method_id = ?
              AND credential.credential_digest_b64u = ?
              AND EXISTS (
                SELECT 1
                  FROM wallet_session_hosted_exchange_codes_v2 AS exchange
                 WHERE exchange.namespace = credential.namespace
                   AND exchange.org_id = credential.org_id
                   AND exchange.project_id = credential.project_id
                   AND exchange.env_id = credential.env_id
                   AND exchange.tenant_id = credential.tenant_id
                   AND exchange.code_hash = ?
                   AND exchange.lifecycle_kind = 'issued'
                   AND exchange.hosted_credential_id IS NULL
                   AND exchange.consumed_at_ms IS NULL
              )`,
      )
      .bind(
        context.namespace,
        context.walletSignerScope.orgId,
        context.walletSignerScope.projectId,
        context.walletSignerScope.envId,
        current.tenant_id,
        input.hostedCredentialId,
        current.authorization_id,
        current.wallet_session_id,
        current.quota_id,
        current.principal_id,
        current.wallet_id,
        current.authority_id,
        current.wallet_auth_method_id,
        input.tokenHash,
        input.codeHash,
      );
    const results = await context.database.batch([
      insertCredential,
      updateStatement,
      deleteOrphanedCredential,
    ]);
    const inserted = results[0] as D1ResultLike;
    const updated = results[1] as D1ResultLike;
    if (d1ChangedRows(inserted) !== 1 || d1ChangedRows(updated) !== 1) {
      return (
        classifyHostedWalletExchangeV2(
          await readHostedWalletExchangeV2(context, input.codeHash),
          input,
        ) ?? { kind: 'wallet_session_unavailable' }
      );
    }
  } catch {
    return { kind: 'wallet_session_unavailable' };
  }
  if (!current) throw new Error('hosted-wallet Seams session exchange disappeared');
  return {
    kind: 'redeemed',
    tenantId: requireParsed(current.tenant_id, parseTenantId, 'exchange.tenantId'),
    authorizationId: requireParsed(
      current.authorization_id,
      parseWalletSessionAuthorizationId,
      'exchange.authorizationId',
    ),
    walletSessionId: requireParsed(
      current.wallet_session_id,
      parseWalletSessionId,
      'exchange.walletSessionId',
    ),
    hostedCredentialId: parseHostedWalletSessionCredentialId(input.hostedCredentialId),
    expiresAtMs: integerColumn(current.expires_at_ms, 'exchange.expiresAtMs'),
  };
}

export async function readHostedWalletSessionOperationCredentialV2(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: TenantId;
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly requestOrigin: import('../../../../../authorization/domain').SessionOrigin;
    readonly nowMs: number;
  },
): Promise<ResolvedHostedWalletSessionOperationCredentialV2 | null> {
  const row = await context.database
    .prepare(
      `SELECT credential.hosted_credential_id,
                credential.authorization_id,
                credential.wallet_session_id,
                credential.quota_id,
                credential.principal_id,
                credential.wallet_id,
                credential.authority_id,
                credential.wallet_auth_method_id,
                credential.app_origin,
                credential.wallet_origin,
                credential.expires_at_ms,
                credential.retired_at_ms,
                session.record_json AS session_record_json,
                session.retired_at_ms AS session_retired_at_ms,
                session.expires_at_ms AS session_expires_at_ms,
                session.operation_credential_hash AS session_operation_credential_hash,
                quota.lifecycle_kind AS quota_lifecycle_kind,
                quota.remaining_uses AS quota_remaining_uses,
                quota.expires_at_ms AS quota_expires_at_ms
           FROM wallet_session_hosted_credentials_v2 AS credential
           LEFT JOIN wallet_session_authorizations_v2 AS session
             ON session.namespace = credential.namespace
            AND session.org_id = credential.org_id
            AND session.project_id = credential.project_id
            AND session.env_id = credential.env_id
            AND session.tenant_id = credential.tenant_id
            AND session.authorization_id = credential.authorization_id
            AND session.wallet_session_id = credential.wallet_session_id
            AND session.quota_id = credential.quota_id
            AND session.principal_id = credential.principal_id
            AND session.wallet_id = credential.wallet_id
            AND session.authority_id = credential.authority_id
            AND session.wallet_auth_method_id = credential.wallet_auth_method_id
           LEFT JOIN authorization_wallet_session_quotas AS quota
             ON quota.namespace = credential.namespace
            AND quota.tenant_id = credential.tenant_id
            AND quota.quota_id = credential.quota_id
            AND quota.wallet_session_id = credential.wallet_session_id
            AND quota.principal_id = credential.principal_id
          WHERE credential.namespace = ?
            AND credential.org_id = ?
            AND credential.project_id = ?
            AND credential.env_id = ?
            AND credential.tenant_id = ?
            AND credential.credential_digest_b64u = ?
            AND credential.lifecycle_kind = 'active'
            AND credential.retired_at_ms IS NULL
          LIMIT 1`,
    )
    .bind(
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      input.tenantId,
      input.tokenHash,
    )
    .first<HostedWalletExchangeV2Row>();
  if (!row) return null;
  const appOrigin = parseSessionOrigin(row.app_origin);
  const walletOrigin = parseSessionOrigin(row.wallet_origin);
  if (walletOrigin !== input.requestOrigin) return null;
  if (
    row.session_record_json === null ||
    row.session_record_json === undefined ||
    row.session_operation_credential_hash === null ||
    row.session_operation_credential_hash === undefined ||
    (row.session_retired_at_ms !== null && row.session_retired_at_ms !== undefined) ||
    (row.credential_retired_at_ms !== null && row.credential_retired_at_ms !== undefined) ||
    row.quota_lifecycle_kind !== 'active' ||
    integerColumn(row.quota_remaining_uses, 'hosted credential quota remaining uses') <= 0 ||
    integerColumn(row.expires_at_ms, 'hosted credential expiry') <= input.nowMs ||
    integerColumn(row.session_expires_at_ms, 'hosted parent expiry') <= input.nowMs ||
    integerColumn(row.session_expires_at_ms, 'hosted parent expiry') <
      integerColumn(row.expires_at_ms, 'hosted credential expiry') ||
    integerColumn(row.quota_expires_at_ms, 'hosted quota expiry') <= input.nowMs ||
    integerColumn(row.quota_expires_at_ms, 'hosted quota expiry') <
      integerColumn(row.expires_at_ms, 'hosted credential expiry')
  ) {
    return null;
  }
  const expected = parsePersistedWalletSessionAuthorizationV2(
    parseD1JsonColumn(row.session_record_json),
  );
  let authorization: IssuedWalletSessionAuthorizationV2 | null;
  try {
    authorization = await readWalletSessionAuthorizationV2ByAuthorizationId(context, {
      expected,
      nowMs: input.nowMs,
    });
  } catch {
    return null;
  }
  if (!authorization) return null;
  return {
    kind: 'resolved_hosted_wallet_session_operation_credential_v2',
    authorization,
    hostedCredentialId: parseHostedWalletSessionCredentialId(row.hosted_credential_id),
    appOrigin,
    walletOrigin,
    expiresAtMs: integerColumn(row.expires_at_ms, 'hosted credential expiry'),
  };
}

async function readHostedWalletExchangeV2(
  context: D1AuthorizationContext,
  codeHash: RedeemHostedWalletSeamsSessionExchangeV2Input['codeHash'],
): Promise<HostedWalletExchangeV2Row | null> {
  return await context.database
    .prepare(
      `SELECT exchange.*,
                session.operation_credential_hash AS session_operation_credential_hash,
                session.retired_at_ms AS session_retired_at_ms,
                session.expires_at_ms AS session_expires_at_ms,
                quota.remaining_uses AS quota_remaining_uses,
                quota.lifecycle_kind AS quota_lifecycle_kind,
                quota.expires_at_ms AS quota_expires_at_ms
           FROM wallet_session_hosted_exchange_codes_v2 AS exchange
           LEFT JOIN wallet_session_authorizations_v2 AS session
             ON session.namespace = exchange.namespace
            AND session.org_id = exchange.org_id
            AND session.project_id = exchange.project_id
            AND session.env_id = exchange.env_id
            AND session.tenant_id = exchange.tenant_id
            AND session.authorization_id = exchange.authorization_id
            AND session.wallet_session_id = exchange.wallet_session_id
            AND session.quota_id = exchange.quota_id
            AND session.principal_id = exchange.principal_id
            AND session.wallet_id = exchange.wallet_id
            AND session.authority_id = exchange.authority_id
            AND session.wallet_auth_method_id = exchange.wallet_auth_method_id
           LEFT JOIN authorization_wallet_session_quotas AS quota
             ON quota.namespace = exchange.namespace
            AND quota.tenant_id = exchange.tenant_id
            AND quota.quota_id = exchange.quota_id
            AND quota.wallet_session_id = exchange.wallet_session_id
            AND quota.principal_id = exchange.principal_id
          WHERE exchange.namespace = ?
            AND exchange.org_id = ?
            AND exchange.project_id = ?
            AND exchange.env_id = ?
            AND exchange.code_hash = ?
          LIMIT 1`,
    )
    .bind(
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      codeHash,
    )
    .first<HostedWalletExchangeV2Row>();
}
