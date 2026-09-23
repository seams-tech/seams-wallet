import {
  buildWalletLaneContext,
  parseManagedWalletHomeLaneId,
  type ManagedWalletHomeLaneId,
  type WalletLaneContext,
} from '@shared/wallet-region';
import type { WalletId } from '@shared/utils/domainIds';
import type {
  ManagedWalletLaneCatalogStore,
  ManagedWalletLaneConfiguration,
  WalletHomeLaneDirectoryRecord,
  WalletHomeLaneDirectoryStore,
} from './WalletRegionStore';

export type ManagedWalletLaneRouteResolution =
  | {
      readonly kind: 'resolved';
      readonly context: WalletLaneContext;
      readonly configuration: Extract<
        ManagedWalletLaneConfiguration,
        { readonly status: 'available' | 'draining' }
      >;
    }
  | {
      readonly kind: 'not_assigned';
      readonly walletId: WalletId;
    }
  | {
      readonly kind: 'unsupported_lane';
      readonly directory: WalletHomeLaneDirectoryRecord;
    }
  | {
      readonly kind: 'lane_unavailable';
      readonly context: WalletLaneContext;
      readonly configuration: ManagedWalletLaneConfiguration | null;
    };

function managedLaneIdFromDirectory(
  directory: WalletHomeLaneDirectoryRecord,
): ManagedWalletHomeLaneId | null {
  const parsed = parseManagedWalletHomeLaneId(directory.homeLane.laneId);
  return parsed.ok ? parsed.value : null;
}

function isRoutableConfiguration(
  configuration: ManagedWalletLaneConfiguration,
): configuration is Extract<
  ManagedWalletLaneConfiguration,
  { readonly status: 'available' | 'draining' }
> {
  return configuration.status === 'available' || configuration.status === 'draining';
}

export async function resolveManagedWalletLaneRoute(input: {
  readonly walletId: WalletId;
  readonly directory: Pick<WalletHomeLaneDirectoryStore, 'getHomeLane'>;
  readonly catalog: Pick<ManagedWalletLaneCatalogStore, 'getActiveConfiguration'>;
}): Promise<ManagedWalletLaneRouteResolution> {
  const directory = await input.directory.getHomeLane(input.walletId);
  if (!directory) return { kind: 'not_assigned', walletId: input.walletId };
  const laneId = managedLaneIdFromDirectory(directory);
  if (!laneId) return { kind: 'unsupported_lane', directory };
  const context = buildWalletLaneContext({
    homeLane: directory.homeLane,
    directoryRevision: directory.directoryRevision,
  });
  const configuration = await input.catalog.getActiveConfiguration(laneId);
  if (!configuration || !isRoutableConfiguration(configuration)) {
    return { kind: 'lane_unavailable', context, configuration };
  }
  return { kind: 'resolved', context, configuration };
}
