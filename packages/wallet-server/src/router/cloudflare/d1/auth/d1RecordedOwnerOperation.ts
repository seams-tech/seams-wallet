import { CAPABILITY_KINDS, type TenantId } from '@shared/authorization/capabilityKinds';
import { walletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import type { AuthorizationService } from '../../../../authorization/service';
import type { D1WalletAuthMethodStore } from '../../../../core/d1WalletAuthMethodStore';
import type { D1Row } from '../../../../storage/d1Sql';
import type { RouterApiAuthorizedOperationService } from '../../../framework/authServicePort';
import type { CloudflareD1WalletAuthMethodService } from '../wallet/d1WalletAuthMethodService';
import type { NormalizedCloudflareD1RouterApiAuthServiceOptions } from './d1RouterApiAuthConfig';

type RecordedOwnerOperationSource = {
  readonly options: Pick<
    NormalizedCloudflareD1RouterApiAuthServiceOptions,
    'database' | 'namespace' | 'orgId' | 'projectId' | 'envId'
  >;
  readonly authorizationService: AuthorizationService;
  readonly walletAuthMethodStore: D1WalletAuthMethodStore;
  readonly walletAuthMethods: CloudflareD1WalletAuthMethodService;
};

/** A continuation uses only the factor digest and exact operation recorded after owner verification. */
export async function resolveRecordedPasskeyOwnerOperation(
  source: RecordedOwnerOperationSource,
  tenantId: TenantId,
  input: Parameters<RouterApiAuthorizedOperationService['resolveRecordedPasskeyOwnerOperation']>[0],
): ReturnType<RouterApiAuthorizedOperationService['resolveRecordedPasskeyOwnerOperation']> {
  const operation = await source.authorizationService.readAuthorizedOperationById({
    tenantId,
    authorizedOperationId: input.authorizedOperationId,
  });
  if (
    !operation ||
    operation.authorization.kind !== 'verified_step_up' ||
    operation.quota.kind !== 'quota_neutral' ||
    operation.operation.operation.capabilityKind !== CAPABILITY_KINDS.nearEd25519MpcSigning
  )
    return null;
  const scope = source.options;
  const evidence = await scope.database
    .prepare(
      `SELECT authority_digest, expires_at_ms
       FROM verified_wallet_operation_evidence_sets
      WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
        AND tenant_id = ? AND wallet_id = ? AND principal_id = ?
        AND evidence_set_digest = ? AND request_origin = ? AND audience = ?
        AND lane_digest = ? AND intent_digest = ? AND display_digest = ?
        AND capability_kind = ? AND operation_kind = ?
        AND verified_at_ms <= ? AND expires_at_ms > ? AND assurance = 'step_up'
      LIMIT 1`,
    )
    .bind(
      scope.namespace,
      scope.orgId,
      scope.projectId,
      scope.envId,
      tenantId,
      input.walletId,
      operation.operation.principalId,
      operation.authorization.evidenceSetDigest,
      input.requestOrigin,
      input.requestOrigin,
      operation.operation.digests.laneDigest,
      operation.operation.digests.intentDigest,
      operation.operation.digests.displayDigest,
      operation.operation.operation.capabilityKind,
      operation.operation.operation.operationKind,
      input.nowMs,
      input.nowMs,
    )
    .first<D1Row>();
  if (
    !evidence ||
    typeof evidence.authority_digest !== 'string' ||
    typeof evidence.expires_at_ms !== 'number'
  )
    return null;
  const methods = await source.walletAuthMethodStore.listForWalletV2({ walletId: input.walletId });
  for (const method of methods) {
    if (method.kind !== 'passkey' || method.status !== 'active') continue;
    const resolved =
      await source.walletAuthMethods.resolveActivePasskeyAuthorityForVerifiedCredential({
        walletId: input.walletId,
        rpId: method.rpId,
        credentialIdB64u: method.credentialIdB64u,
      });
    if (!resolved.ok) continue;
    const authorityRef = await walletAuthAuthorityRef({ authority: resolved.authority });
    if (authorityRef.authorityDigest !== evidence.authority_digest) continue;
    return { operation, authority: resolved.authority, expiresAtMs: evidence.expires_at_ms };
  }
  return null;
}
