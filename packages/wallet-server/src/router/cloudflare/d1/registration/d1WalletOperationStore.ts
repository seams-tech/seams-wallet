import type { WalletId } from '@shared/utils/domainIds';
import type { VersionedJsonRecordPutResult } from '../../../framework/versionedJsonRecordStore';
import type { D1PreparedStatementLike, D1ResultLike } from '../../../../storage/tenantRoute';
import {
  createCloudflareD1VersionedJsonRecordStore,
  type CloudflareD1VersionedJsonRecordStore,
  type CloudflareD1VersionedJsonRecordStoreOptions,
} from '../versionedJson/d1VersionedJsonRecordStore';
import { D1WalletCeremonyActivity } from '../ed25519Yao/d1WalletCeremonyActivity';
import { lifecycleWriteFenceStatements } from '../ed25519Yao/d1Ed25519YaoStateWriteFence';

type WalletOperation = {
  readonly kind:
    | 'router_ab_ed25519_yao_registration_side_effect_claim_v1'
    | 'router_ab_ed25519_yao_registration_side_effect_completion_v1'
    | 'router_ab_ed25519_yao_registration_side_effect_completion_v2';
};

// The operation journal and its activity projection share the record CAS.
export class D1WalletOperationStore<T extends WalletOperation> {
  private readonly records: CloudflareD1VersionedJsonRecordStore<T>;
  private readonly activity: D1WalletCeremonyActivity;

  constructor(
    private readonly options: CloudflareD1VersionedJsonRecordStoreOptions<T>,
    private readonly walletId: (record: T) => WalletId,
  ) {
    this.records = createCloudflareD1VersionedJsonRecordStore(options);
    this.activity = new D1WalletCeremonyActivity(options.database, options.scope);
  }

  read(key: string) {
    return this.records.read(key);
  }

  prepareRead(key: string) {
    return this.records.prepareRead(key);
  }

  parseReadResult(result: D1ResultLike<Record<string, unknown>>) {
    return this.records.parseReadResult(result);
  }

  listByKeyPrefix(key: string, options?: { readonly limit?: number }) {
    return this.records.listByKeyPrefix(key, options);
  }

  put(
    key: string,
    value: T,
    expectedVersion: string | null,
  ): Promise<VersionedJsonRecordPutResult> {
    return this.commit(key, value, expectedVersion, []);
  }

  /** As `put`, with another store's write on this database in the same batch. */
  putWithCompanion(
    key: string,
    value: T,
    expectedVersion: string | null,
    companionWrite: { readonly statements: readonly D1PreparedStatementLike[] },
  ): Promise<VersionedJsonRecordPutResult> {
    return this.commit(key, value, expectedVersion, companionWrite.statements);
  }

  private async commit(
    key: string,
    value: T,
    expectedVersion: string | null,
    companionStatements: readonly D1PreparedStatementLike[],
  ): Promise<VersionedJsonRecordPutResult> {
    const walletId = this.walletId(value);
    const result = await this.records.putManyWithAdditionalStatements(
      [{ key, value, expectedVersion }],
      [
        ...lifecycleWriteFenceStatements(this.options, new Set([walletId])),
        this.activity.project(
          this.records.storageKey(key),
          walletId,
          value.kind !== 'router_ab_ed25519_yao_registration_side_effect_claim_v1',
        ),
        ...companionStatements,
      ],
    );
    if (result.kind === 'version_mismatch') return { kind: 'version_mismatch' };
    for (const entry of result.versions) {
      if (entry.key === key) return { kind: 'stored', version: entry.version };
    }
    throw new Error('Wallet operation commit omitted its record version');
  }
}
