import type {
  WalletHomeLane,
  WalletLaneContext,
  WalletRegionMigrationId,
} from '@shared/wallet-region';
import type { WalletHomeLaneDirectoryRecord } from './WalletRegionStore';

export type WalletLaneAuthorityState =
  | {
      readonly kind: 'active';
      readonly homeLane: WalletHomeLane;
      readonly directoryRevision: WalletHomeLaneDirectoryRecord['directoryRevision'];
      readonly migrationId: WalletRegionMigrationId | null;
    }
  | {
      readonly kind: 'source_frozen';
      readonly homeLane: WalletHomeLane;
      readonly migrationId: WalletRegionMigrationId;
      readonly directoryRevision: WalletHomeLaneDirectoryRecord['directoryRevision'];
    }
  | {
      readonly kind: 'target_prepared';
      readonly homeLane: WalletHomeLane;
      readonly migrationId: WalletRegionMigrationId;
      readonly directoryRevision: WalletHomeLaneDirectoryRecord['directoryRevision'];
    }
  | {
      readonly kind: 'retired';
      readonly homeLane: WalletHomeLane;
      readonly migrationId: WalletRegionMigrationId;
      readonly directoryRevision: WalletHomeLaneDirectoryRecord['directoryRevision'];
    };

export type WalletLaneAdmissionResult =
  | { readonly ok: true; readonly context: WalletLaneContext }
  | {
      readonly ok: false;
      readonly code:
        | 'wallet_region_migration_in_progress'
        | 'wallet_lane_context_stale'
        | 'wallet_lane_target_not_active'
        | 'wallet_lane_retired';
      readonly message: string;
    };

function sameLaneContext(
  context: WalletLaneContext,
  directory: WalletHomeLaneDirectoryRecord,
): boolean {
  return (
    context.walletId === directory.homeLane.walletId &&
    context.laneId === directory.homeLane.laneId &&
    context.laneEpoch === directory.homeLane.laneEpoch &&
    context.directoryRevision === directory.directoryRevision
  );
}

function sameAuthorityLane(
  context: WalletLaneContext,
  authority: WalletLaneAuthorityState,
): boolean {
  return (
    context.walletId === authority.homeLane.walletId &&
    context.laneId === authority.homeLane.laneId &&
    context.laneEpoch === authority.homeLane.laneEpoch &&
    context.directoryRevision === authority.directoryRevision
  );
}

export function admitWalletLaneMutation(input: {
  readonly context: WalletLaneContext;
  readonly directory: WalletHomeLaneDirectoryRecord;
  readonly authority: WalletLaneAuthorityState;
}): WalletLaneAdmissionResult {
  if (!sameLaneContext(input.context, input.directory)) {
    return {
      ok: false,
      code: 'wallet_lane_context_stale',
      message: 'wallet lane context does not match the authoritative directory',
    };
  }
  if (!sameAuthorityLane(input.context, input.authority)) {
    return {
      ok: false,
      code: 'wallet_lane_context_stale',
      message: 'wallet lane context does not match this lane authority',
    };
  }
  switch (input.authority.kind) {
    case 'active':
      return { ok: true, context: input.context };
    case 'source_frozen':
      return {
        ok: false,
        code: 'wallet_region_migration_in_progress',
        message: 'wallet writes are fenced while its Home region is moving',
      };
    case 'target_prepared':
      return {
        ok: false,
        code: 'wallet_lane_target_not_active',
        message: 'prepared target lane has no directory authority',
      };
    case 'retired':
      return {
        ok: false,
        code: 'wallet_lane_retired',
        message: 'wallet lane epoch has been permanently retired',
      };
    default:
      return assertNeverWalletLaneAuthority(input.authority);
  }
}

function assertNeverWalletLaneAuthority(value: never): never {
  throw new Error(`unexpected wallet lane authority: ${JSON.stringify(value)}`);
}
