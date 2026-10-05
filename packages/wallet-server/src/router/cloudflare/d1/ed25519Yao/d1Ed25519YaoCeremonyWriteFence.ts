import { parseWalletId } from '@shared/utils/domainIds';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { VersionedJsonObject } from '../../../framework/versionedJsonRecordStore';
import type { CloudflareD1VersionedJsonRecordStoreOptions } from '../versionedJson/d1VersionedJsonRecordStore';
import { parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1 } from '../../../domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore';

// Use both record versions so deleting the final authority cannot bypass its fence.
export function collectCeremonyWallets(value: VersionedJsonObject, wallets: Set<string>): void {
  const record = parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(value);
  if (!record) throw new Error('Ceremony mutation contains an invalid partition record');
  if (record.kind === 'router_ab_ed25519_yao_product_registration_shared_record_v1') return;
  const state = record.value;
  const owners = new Set<string>();
  for (const authority of state.authorization.authorities) {
    owners.add(authority.admissionRequest.application_binding.wallet_id);
  }
  for (const registration of state.registration.states.values()) {
    owners.add(registration.admissionRequest.application_binding.wallet_id);
  }
  for (const recovery of state.recovery.recoveries.values()) {
    owners.add(recovery.context.authorization.walletId);
  }
  for (const exported of state.export.exports.values()) {
    owners.add(exported.request.application_binding.wallet_id);
  }
  if (
    owners.size > 1 ||
    (owners.size === 0 &&
      (state.registration.admissionClaims.size > 0 ||
        state.registration.dispatchRoots.size > 0 ||
        state.registration.lifecycleSessions.size > 0))
  )
    throw new Error('Ceremony mutation has no unique wallet owner');
  for (const owner of owners) {
    const parsed = parseWalletId(owner);
    if (!parsed.ok) throw new Error('Ceremony wallet owner is invalid');
    wallets.add(parsed.value);
  }
}

export function ceremonyWriteFenceStatements(
  options: Pick<
    CloudflareD1VersionedJsonRecordStoreOptions<VersionedJsonObject>,
    'database' | 'scope'
  >,
  wallets: ReadonlySet<string>,
): D1PreparedStatementLike[] {
  const statements: D1PreparedStatementLike[] = [];
  for (const walletId of wallets) {
    statements.push(
      options.database
        .prepare(
          `
      INSERT INTO router_ab_yao_versioned_json_cas_guard (guard_id)
      SELECT 1 WHERE EXISTS (
        SELECT 1 FROM wallet_relocation_authorization_fences
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5
      )`,
        )
        .bind(
          options.scope.namespace,
          options.scope.orgId,
          options.scope.projectId,
          options.scope.envId,
          walletId,
        ),
    );
  }
  return statements;
}
