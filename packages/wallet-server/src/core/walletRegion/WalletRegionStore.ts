import { MANAGED_WALLET_LANES } from '@shared/wallet-region';
import type {
  AuthorizedWalletRegionMigration,
  CompletedWalletRegionMigration,
  CutoverCommittedWalletRegionMigration,
  ManagedWalletLaneStatus,
  ManagedWalletHomeLaneId,
  ManagedWalletRegion,
  TargetVerifiedWalletRegionMigration,
  WalletDirectoryRevision,
  WalletHomeLane,
  WalletHomeLaneId,
  WalletRegionMigration,
  WalletRegionMigrationGrant,
  WalletRegionMigrationId,
} from '@shared/wallet-region';
import type { WalletId } from '@shared/utils/domainIds';

export type WalletLaneServiceBindingName = string & {
  readonly __walletLaneServiceBindingNameBrand: 'WalletLaneServiceBindingName';
};

export type ManagedWalletLanePlacementEvidence =
  | {
      readonly kind: 'pending';
      readonly recordedAtMs: number;
      readonly observedD1Location?: never;
      readonly maximumWriteLatencyMs?: never;
      readonly rejectionReason?: never;
    }
  | {
      readonly kind: 'verified';
      readonly recordedAtMs: number;
      readonly observedD1Location: string;
      readonly maximumWriteLatencyMs: number;
      readonly rejectionReason?: never;
    }
  | {
      readonly kind: 'rejected';
      readonly recordedAtMs: number;
      readonly observedD1Location: string;
      readonly maximumWriteLatencyMs: number;
      readonly rejectionReason: string;
    };

type ManagedWalletLaneConfigurationBase = {
  readonly laneId: ManagedWalletHomeLaneId;
  readonly productRegion: ManagedWalletRegion;
  readonly routerBinding: WalletLaneServiceBindingName;
  readonly deriverABinding: WalletLaneServiceBindingName;
  readonly deriverBBinding: WalletLaneServiceBindingName;
  readonly signingWorkerBinding: WalletLaneServiceBindingName;
  readonly configurationVersion: number;
};

export type ManagedWalletLaneConfiguration =
  | (ManagedWalletLaneConfigurationBase & {
      readonly status: 'provisioning' | 'unavailable';
      readonly placementEvidence:
        | Extract<ManagedWalletLanePlacementEvidence, { readonly kind: 'pending' }>
        | Extract<ManagedWalletLanePlacementEvidence, { readonly kind: 'rejected' }>;
    })
  | (ManagedWalletLaneConfigurationBase & {
      readonly status: 'available' | 'draining';
      readonly placementEvidence: Extract<
        ManagedWalletLanePlacementEvidence,
        { readonly kind: 'verified' }
      >;
    });

type ManagedWalletLaneBindings = {
  readonly routerBinding: WalletLaneServiceBindingName;
  readonly deriverABinding: WalletLaneServiceBindingName;
  readonly deriverBBinding: WalletLaneServiceBindingName;
  readonly signingWorkerBinding: WalletLaneServiceBindingName;
};

function requireConfigurationVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('managed wallet lane configurationVersion must be a positive safe integer');
  }
  return value;
}

function requireLaneRegionBinding(
  laneId: ManagedWalletHomeLaneId,
  productRegion: ManagedWalletRegion,
): void {
  if (MANAGED_WALLET_LANES[productRegion].laneId !== laneId) {
    throw new Error('managed wallet lane id does not match its product region');
  }
}

export function walletLaneServiceBindingNameFromString(
  value: string,
): WalletLaneServiceBindingName {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(value)) {
    throw new Error('wallet lane service binding name must be uppercase Worker binding syntax');
  }
  return value as WalletLaneServiceBindingName;
}

export function buildPendingManagedWalletLaneConfiguration(input: {
  readonly laneId: ManagedWalletHomeLaneId;
  readonly productRegion: ManagedWalletRegion;
  readonly status: 'provisioning' | 'unavailable';
  readonly placementEvidence:
    | Extract<ManagedWalletLanePlacementEvidence, { readonly kind: 'pending' }>
    | Extract<ManagedWalletLanePlacementEvidence, { readonly kind: 'rejected' }>;
  readonly bindings: ManagedWalletLaneBindings;
  readonly configurationVersion: number;
}): ManagedWalletLaneConfiguration {
  requireLaneRegionBinding(input.laneId, input.productRegion);
  return {
    laneId: input.laneId,
    productRegion: input.productRegion,
    status: input.status,
    placementEvidence: input.placementEvidence,
    routerBinding: input.bindings.routerBinding,
    deriverABinding: input.bindings.deriverABinding,
    deriverBBinding: input.bindings.deriverBBinding,
    signingWorkerBinding: input.bindings.signingWorkerBinding,
    configurationVersion: requireConfigurationVersion(input.configurationVersion),
  };
}

export function buildVerifiedManagedWalletLaneConfiguration(input: {
  readonly laneId: ManagedWalletHomeLaneId;
  readonly productRegion: ManagedWalletRegion;
  readonly status: 'available' | 'draining';
  readonly placementEvidence: Extract<
    ManagedWalletLanePlacementEvidence,
    { readonly kind: 'verified' }
  >;
  readonly bindings: ManagedWalletLaneBindings;
  readonly configurationVersion: number;
}): ManagedWalletLaneConfiguration {
  requireLaneRegionBinding(input.laneId, input.productRegion);
  return {
    laneId: input.laneId,
    productRegion: input.productRegion,
    status: input.status,
    placementEvidence: input.placementEvidence,
    routerBinding: input.bindings.routerBinding,
    deriverABinding: input.bindings.deriverABinding,
    deriverBBinding: input.bindings.deriverBBinding,
    signingWorkerBinding: input.bindings.signingWorkerBinding,
    configurationVersion: requireConfigurationVersion(input.configurationVersion),
  };
}

export type WalletHomeLaneDirectoryRecord = {
  readonly homeLane: WalletHomeLane;
  readonly directoryRevision: WalletDirectoryRevision;
  readonly migrationId: WalletRegionMigrationId | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type WalletRegionMigrationJournalRecord = {
  readonly migration: WalletRegionMigration;
  readonly recordRevision: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type WalletRegionMigrationGrantRecord =
  | {
      readonly kind: 'issued';
      readonly grant: WalletRegionMigrationGrant;
      readonly consumedAtMs?: never;
    }
  | {
      readonly kind: 'consumed';
      readonly grant: WalletRegionMigrationGrant;
      readonly consumedAtMs: number;
    };

export type WalletRegionStoreConflict = {
  readonly outcome: 'conflict';
  readonly currentHomeLane: WalletHomeLaneDirectoryRecord | null;
  readonly currentMigration: WalletRegionMigrationJournalRecord | null;
};

export type WalletRegionStoreMutation<T> =
  | { readonly outcome: 'applied'; readonly value: T }
  | { readonly outcome: 'replayed'; readonly value: T }
  | WalletRegionStoreConflict;

export type ManagedWalletLaneCatalogMutation =
  | {
      readonly outcome: 'applied' | 'replayed';
      readonly value: ManagedWalletLaneConfiguration;
    }
  | {
      readonly outcome: 'conflict';
      readonly current: ManagedWalletLaneConfiguration | null;
    };

export interface ManagedWalletLaneCatalogStore {
  putConfiguration(
    configuration: ManagedWalletLaneConfiguration,
  ): Promise<ManagedWalletLaneCatalogMutation>;
  activateConfiguration(input: {
    readonly laneId: ManagedWalletHomeLaneId;
    readonly configurationVersion: number;
    readonly expectedConfigurationVersion: number | null;
  }): Promise<ManagedWalletLaneCatalogMutation>;
  getActiveConfiguration(
    laneId: ManagedWalletHomeLaneId,
  ): Promise<ManagedWalletLaneConfiguration | null>;
  listActiveConfigurations(input?: {
    readonly status?: ManagedWalletLaneStatus;
  }): Promise<readonly ManagedWalletLaneConfiguration[]>;
}

export interface WalletHomeLaneDirectoryStore {
  assignInitialHomeLane(input: {
    readonly homeLane: WalletHomeLane;
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletHomeLaneDirectoryRecord>>;
  getHomeLane(walletId: WalletId): Promise<WalletHomeLaneDirectoryRecord | null>;
  beginMigration(input: {
    readonly migration: AuthorizedWalletRegionMigration;
    readonly grant: WalletRegionMigrationGrant;
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletRegionMigrationJournalRecord>>;
  issueMigrationGrant(input: {
    readonly grant: WalletRegionMigrationGrant;
    readonly nowMs: number;
  }): Promise<WalletRegionMigrationGrantRecord>;
  getMigrationGrant(
    grantDigest: WalletRegionMigrationGrant['grantDigest'],
  ): Promise<WalletRegionMigrationGrantRecord | null>;
  compareAndSetMigration(input: {
    readonly expected: WalletRegionMigrationJournalRecord;
    readonly next: WalletRegionMigration;
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletRegionMigrationJournalRecord>>;
  commitCutover(input: {
    readonly expected: WalletRegionMigrationJournalRecord & {
      readonly migration: TargetVerifiedWalletRegionMigration;
    };
    readonly next: CutoverCommittedWalletRegionMigration;
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletRegionMigrationJournalRecord>>;
  completeMigration(input: {
    readonly expected: WalletRegionMigrationJournalRecord & {
      readonly migration: CutoverCommittedWalletRegionMigration;
    };
    readonly next: CompletedWalletRegionMigration;
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletRegionMigrationJournalRecord>>;
  getMigration(
    migrationId: WalletRegionMigrationId,
  ): Promise<WalletRegionMigrationJournalRecord | null>;
}
