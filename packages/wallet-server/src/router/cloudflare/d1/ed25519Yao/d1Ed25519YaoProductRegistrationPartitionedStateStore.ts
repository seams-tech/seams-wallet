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
  const records = createCloudflareD1VersionedJsonRecordStore<VersionedJsonObject>({
    ...options,
    encode: identityVersionedJsonObject,
    parse: parseRouterAbEd25519YaoProductRegistrationPartitionRecordJsonV1,
  });
  const store = new D1LifecycleRecords(options, records);
  return createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(store);
}

class D1LifecycleRecords implements RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1 {
  constructor(
    private readonly options: RouterAbEd25519YaoProductRegistrationPartitionedStateD1OptionsV1,
    private readonly records: CloudflareD1VersionedJsonRecordStore<VersionedJsonObject>,
  ) {}

  readMany(keys: readonly string[]) {
    return this.records.readMany(keys);
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
    for (const mutation of mutations) {
      keys.push(mutation.key);
    }
    const previous = await this.records.readMany(keys);
    const previousValues = new Map<string, VersionedJsonObject>();
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
          projections.push(activity.project(this.records.storageKey(mutation.key), walletId, ceremonySettled(after.value)));
        }
      }
    }
    // The record CAS protects the versions inspected above. The local fence and
    // companion effects commit in that same batch, or the whole batch rolls back.
    return this.records.putManyWithAdditionalStatements(mutations, [
      ...lifecycleWriteFenceStatements(this.options, wallets),
      ...projections,
      ...(companion?.statements ?? []),
    ]);
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
