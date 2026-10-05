import type { RouterAbEd25519YaoProductRegistrationSharedStateV1 } from '../../../domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitioning';
import { parseRouterAbEd25519YaoRecoveryAdmissionRequestV1 } from '@shared/utils/routerAbEd25519Yao';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { VersionedJsonObject } from '../../../framework/versionedJsonRecordStore';
import type { CloudflareD1VersionedJsonRecordStoreOptions } from '../versionedJson/d1VersionedJsonRecordStore';
import {
  parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1,
  type RouterAbEd25519YaoProductRegistrationPartitionRecordV1,
} from '../../../domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore';

// Compare shared replay entries so unchanged frozen wallets do not block other wallets.
export function collectChangedStateWallets(
  previous: VersionedJsonObject | null,
  next: VersionedJsonObject,
  wallets: Set<WalletId>,
): void {
  const before = previous === null ? null : readPartition(previous);
  const after = readPartition(next);
  if (before && before.kind !== after.kind) throw new Error('Lifecycle partition kind changed');
  if (after.kind === 'router_ab_ed25519_yao_product_registration_ceremony_record_v1') {
    collectCeremonyWallets(after, wallets);
    if (before) collectCeremonyWallets(before, wallets);
    return;
  }
  if (before?.kind === 'router_ab_ed25519_yao_product_registration_ceremony_record_v1') {
    throw new Error('Lifecycle partition kind changed');
  }
  collectChangedRecoveryCapabilities(before?.value ?? null, after.value, wallets);
  const empty = new Map<string, string>();
  collectChangedOwners(
    before?.value.exportAuthorizationNonceOwners ?? empty,
    after.value.exportAuthorizationNonceOwners,
    walletOwner,
    wallets,
  );
  collectChangedOwners(
    before?.value.exportAuthorizationUncertainOwners ?? empty,
    after.value.exportAuthorizationUncertainOwners,
    walletOwner,
    wallets,
  );
  collectChangedOwners(
    before?.value.recoverySessions ?? empty,
    after.value.recoverySessions,
    recoverySessionOwner,
    wallets,
  );
}

function collectChangedRecoveryCapabilities(
  before: RouterAbEd25519YaoProductRegistrationSharedStateV1 | null,
  after: RouterAbEd25519YaoProductRegistrationSharedStateV1,
  wallets: Set<WalletId>,
): void {
  // Cache eviction does not change the canonical signer record. Installing or
  // changing a cached capability must still obey that wallet's source fence.
  for (const [key, capability] of after.recoveryCapabilities) {
    const previous = before?.recoveryCapabilities.get(key);
    if (JSON.stringify(previous) === JSON.stringify(capability)) continue;
    if (previous) wallets.add(walletOwner(previous.identity.applicationBinding.wallet_id));
    wallets.add(walletOwner(capability.identity.applicationBinding.wallet_id));
  }
  for (const [key, capability] of before?.recoveryCapabilities ?? []) {
    if (capability.kind === 'suspended' && !after.recoveryCapabilities.has(key)) {
      wallets.add(walletOwner(capability.identity.applicationBinding.wallet_id));
    }
  }
  const identities = new Set([
    ...(before?.recoveryIdentityCapabilities.keys() ?? []),
    ...after.recoveryIdentityCapabilities.keys(),
  ]);
  for (const identity of identities) {
    const previousKey = before?.recoveryIdentityCapabilities.get(identity);
    const nextKey = after.recoveryIdentityCapabilities.get(identity);
    if (previousKey === nextKey) continue;
    // The bounded cache removes an index together with its evicted capability.
    if (
      nextKey === undefined &&
      previousKey !== undefined &&
      !after.recoveryCapabilities.has(previousKey)
    )
      continue;
    if (previousKey !== undefined) {
      const previous = before?.recoveryCapabilities.get(previousKey);
      if (!previous) throw new Error('Recovery identity index has no capability owner');
      wallets.add(walletOwner(previous.identity.applicationBinding.wallet_id));
    }
    if (nextKey !== undefined) {
      const next = after.recoveryCapabilities.get(nextKey);
      if (!next) throw new Error('Recovery identity index has no capability owner');
      wallets.add(walletOwner(next.identity.applicationBinding.wallet_id));
    }
  }
}

function readPartition(
  value: VersionedJsonObject,
): RouterAbEd25519YaoProductRegistrationPartitionRecordV1 {
  const record = parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(value);
  if (!record) throw new Error('Lifecycle mutation contains an invalid partition record');
  return record;
}

function walletOwner(value: string): WalletId {
  const parsed = parseWalletId(value);
  if (!parsed.ok) throw new Error('Lifecycle wallet owner is invalid');
  return parsed.value;
}

function recoverySessionOwner(value: string): WalletId {
  const parsed = parseRouterAbEd25519YaoRecoveryAdmissionRequestV1(JSON.parse(value));
  if (!parsed.ok) throw new Error('Stored recovery session request is invalid');
  return walletOwner(parsed.value.application_binding.wallet_id);
}

function collectChangedOwners(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
  owner: (value: string) => WalletId,
  wallets: Set<WalletId>,
): void {
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const oldValue = before.get(key);
    const newValue = after.get(key);
    if (oldValue === newValue) continue;
    if (oldValue !== undefined) wallets.add(owner(oldValue));
    if (newValue !== undefined) wallets.add(owner(newValue));
  }
}

// Use both record versions so deleting the final authority cannot bypass its fence.
function collectCeremonyWallets(
  record: RouterAbEd25519YaoProductRegistrationPartitionRecordV1,
  wallets: Set<WalletId>,
): void {
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
    wallets.add(walletOwner(owner));
  }
}

export function lifecycleWriteFenceStatements(
  options: Pick<
    CloudflareD1VersionedJsonRecordStoreOptions<VersionedJsonObject>,
    'database' | 'scope'
  >,
  wallets: ReadonlySet<WalletId>,
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
