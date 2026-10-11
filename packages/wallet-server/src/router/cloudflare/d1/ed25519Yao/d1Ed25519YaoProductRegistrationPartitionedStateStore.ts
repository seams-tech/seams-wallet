import { D1WalletCeremonyActivity, ceremonySettled } from './d1WalletCeremonyActivity';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { WalletId } from '@shared/utils/domainIds';
import {
  collectChangedStateWallets,
  lifecycleWriteFenceStatements,
} from './d1Ed25519YaoStateWriteFence';
import {
  createCloudflareD1VersionedJsonRecordStore,
  type CloudflareD1VersionedJsonRecordStore,
  type CloudflareD1VersionedJsonRecordStoreOptions,
} from '../versionedJson/d1VersionedJsonRecordStore';
import type { VersionedJsonObject } from '../../../framework/versionedJsonRecordStore';
import {
  createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1,
  ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1,
  parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1,
  parseRouterAbEd25519YaoProductRegistrationPartitionRecordJsonV1,
  type RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1,
  type RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
} from '../../../domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore';

export type RouterAbEd25519YaoProductRegistrationPartitionedStateD1OptionsV1 = Omit<
  CloudflareD1VersionedJsonRecordStoreOptions<VersionedJsonObject>,
  'encode' | 'parse'
>;

export function createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1(
  options: RouterAbEd25519YaoProductRegistrationPartitionedStateD1OptionsV1,
): RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1 {
  const records = createLifecycleRecords(options);
  const store = new D1LifecycleRecords(options, records);
  return createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(store);
}

class D1LifecycleRecords implements RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1 {
  private observed = new Map<string, { version: string; value: VersionedJsonObject }>();

  constructor(
    private readonly options: RouterAbEd25519YaoProductRegistrationPartitionedStateD1OptionsV1,
    private readonly records: CloudflareD1VersionedJsonRecordStore<VersionedJsonObject>,
  ) {}

  async readMany(keys: readonly string[]) {
    const entries = await this.records.readMany(keys);
    this.observed.clear();
    for (const entry of entries) {
      if (entry.result.kind === 'present') {
        this.observed.set(entry.key, {
          version: entry.result.version,
          value: structuredClone(entry.result.value),
        });
      }
    }
    return entries;
  }

  async putMany(
    mutations: Parameters<
      RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1['putMany']
    >[0],
    companion: Parameters<
      RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1['putMany']
    >[1],
  ): ReturnType<RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1['putMany']> {
    const keys: string[] = [];
    const wallets = new Set<WalletId>();
    const previousValues = new Map<string, VersionedJsonObject>();
    for (const mutation of mutations) {
      if (mutation.expectedVersion === null) continue;
      const observed = this.observed.get(mutation.key);
      if (observed?.version === mutation.expectedVersion) {
        previousValues.set(mutation.key, observed.value);
      } else {
        keys.push(mutation.key);
      }
    }
    this.observed.clear();
    // An insert has no prior state. Its CAS rejects any concurrent creation
    // before the accompanying ownership and ceremony effects can commit. An
    // update can use its exact-version snapshot; the same CAS detects a race.
    const previous = keys.length === 0 ? [] : await this.records.readMany(keys);
    for (const entry of previous) {
      if (entry.result.kind === 'present') previousValues.set(entry.key, entry.result.value);
    }
    const activity = new D1WalletCeremonyActivity(this.options.database, this.options.scope);
    const projections: D1PreparedStatementLike[] = [];
    for (const mutation of mutations) {
      const previousValue = previousValues.get(mutation.key);
      const before = previousValue === undefined ? null : readPartition(previousValue);
      const after = readPartition(mutation.value);
      const changedWallets = new Set<WalletId>();
      collectChangedStateWallets(before, after, changedWallets);
      for (const walletId of changedWallets) wallets.add(walletId);
      if (after.kind === 'router_ab_ed25519_yao_product_registration_ceremony_record_v1') {
        if (changedWallets.size > 1) throw new Error('Ceremony wallet owner changed');
        for (const walletId of changedWallets) {
          projections.push(
            activity.project(
              this.records.storageKey(mutation.key),
              walletId,
              ceremonySettled(after.value),
            ),
          );
        }
      }
    }
    // The record CAS protects the versions inspected above. The local fence and
    // companion effects commit in that same batch, or the whole batch rolls back.
    return this.records.putManyWithAdditionalStatements(
      mutations,
      [
        ...lifecycleWriteFenceStatements(this.options, wallets),
        ...projections,
        ...(companion?.statements ?? []),
      ],
      companion?.executeBatch,
    );
  }
}

function identityVersionedJsonObject(value: VersionedJsonObject): VersionedJsonObject {
  return value;
}

function readPartition(value: VersionedJsonObject) {
  const record = parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(value);
  if (!record) throw new Error('Lifecycle mutation contains an invalid partition record');
  return record;
}

// Retire only this wallet's regional cache. Canonical signer records rehydrate it
// after a later relocation, and unrelated wallets retain their shared state.
export async function evictWalletEd25519CapabilityCache(
  options: RouterAbEd25519YaoProductRegistrationPartitionedStateD1OptionsV1,
  walletId: string,
): Promise<void> {
  const records = createLifecycleRecords(options);
  const key = ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1;
  const current = await records.read(key);
  if (current.kind !== 'present') return;
  const partition = readPartition(current.value);
  if (partition.kind !== 'router_ab_ed25519_yao_product_registration_shared_record_v1')
    throw new Error('Capability cache has an invalid partition kind');
  const capabilities = new Map(partition.value.recoveryCapabilities);
  const identities = new Map(partition.value.recoveryIdentityCapabilities);
  const removed = new Set<string>();
  for (const [capabilityKey, capability] of capabilities) {
    if (capability.identity.applicationBinding.wallet_id !== walletId) continue;
    if (capability.kind === 'suspended')
      throw new Error('Relocation cleanup cannot evict an unsettled capability');
    capabilities.delete(capabilityKey);
    removed.add(capabilityKey);
  }
  if (removed.size === 0) return;
  for (const [identity, capabilityKey] of identities) {
    if (removed.has(capabilityKey)) identities.delete(identity);
  }
  const value = encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1({
    kind: 'router_ab_ed25519_yao_product_registration_shared_record_v1',
    value: {
      kind: partition.value.kind,
      recoveryCapabilities: capabilities,
      recoveryIdentityCapabilities: identities,
      recoverySessions: partition.value.recoverySessions,
      exportAuthorizationNonceOwners: partition.value.exportAuthorizationNonceOwners,
      exportAuthorizationUncertainOwners: partition.value.exportAuthorizationUncertainOwners,
    },
  });
  const result = await records.putMany([{ key, value, expectedVersion: current.version }]);
  if (result.kind !== 'stored') throw new Error('Capability cache changed during cleanup');
}

function createLifecycleRecords(
  options: RouterAbEd25519YaoProductRegistrationPartitionedStateD1OptionsV1,
) {
  return createCloudflareD1VersionedJsonRecordStore<VersionedJsonObject>({
    ...options,
    encode: identityVersionedJsonObject,
    parse: parseRouterAbEd25519YaoProductRegistrationPartitionRecordJsonV1,
  });
}
