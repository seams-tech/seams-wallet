import {
  collectCeremonyWallets,
  ceremonyWriteFenceStatements,
} from './d1Ed25519YaoCeremonyWriteFence';
import {
  createCloudflareD1VersionedJsonRecordStore,
  type CloudflareD1VersionedJsonRecordStore,
  type CloudflareD1VersionedJsonRecordStoreOptions,
} from '../versionedJson/d1VersionedJsonRecordStore';
import type { VersionedJsonObject } from '../../../framework/versionedJsonRecordStore';
import {
  createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
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
  const store = new D1CeremonyRecords(options, records);
  return createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(store);
}

class D1CeremonyRecords implements RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1 {
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
    const wallets = new Set<string>();
    for (const mutation of mutations) {
      keys.push(mutation.key);
      collectCeremonyWallets(mutation.value, wallets);
    }
    const previous = await this.records.readMany(keys);
    for (const entry of previous) {
      if (entry.result.kind === 'present') collectCeremonyWallets(entry.result.value, wallets);
    }
    // The record CAS protects the versions inspected above. The local fence and
    // companion effects commit in that same batch, or the whole batch rolls back.
    return this.records.putManyWithAdditionalStatements(mutations, [
      ...ceremonyWriteFenceStatements(this.options, wallets),
      ...(companion?.statements ?? []),
    ]);
  }
}

function identityVersionedJsonObject(value: VersionedJsonObject): VersionedJsonObject {
  return value;
}
