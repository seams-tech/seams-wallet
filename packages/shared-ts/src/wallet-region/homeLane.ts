import { rejectUnknownFields, requireRecord } from '../passkey-custody/primitives';
import type { WalletId } from '../utils/domainIds';
import {
  MANAGED_WALLET_HOME_LANE_IDS,
  nextWalletLaneEpoch,
  parseWalletDirectoryRevision,
  parseWalletHomeLaneId,
  parseWalletLaneEpoch,
  requireWalletId,
  requireWalletRegionBoundary,
  type ManagedWalletHomeLaneId,
  type WalletDirectoryRevision,
  type WalletHomeLaneId,
  type WalletLaneEpoch,
} from './ids';

const walletHomeLaneProof: unique symbol = Symbol('WalletHomeLane');
const walletRegionMigrationTargetProof: unique symbol = Symbol('WalletRegionMigrationTarget');
const walletLaneContextProof: unique symbol = Symbol('WalletLaneContext');

export type ManagedWalletRegion = 'north_america' | 'europe' | 'asia_pacific';
export type ManagedWalletLaneStatus = 'provisioning' | 'available' | 'draining' | 'unavailable';

export type ManagedWalletLane = {
  readonly laneId: ManagedWalletHomeLaneId;
  readonly productRegion: ManagedWalletRegion;
  readonly label: string;
};

function requireManagedLaneId(value: string): ManagedWalletHomeLaneId {
  return requireWalletRegionBoundary(
    parseWalletHomeLaneId(value),
    'managed wallet lane id',
  ) as ManagedWalletHomeLaneId;
}

export const MANAGED_WALLET_LANES: Readonly<Record<ManagedWalletRegion, ManagedWalletLane>> =
  Object.freeze({
    north_america: Object.freeze({
      laneId: requireManagedLaneId(MANAGED_WALLET_HOME_LANE_IDS.northAmerica),
      productRegion: 'north_america',
      label: 'North America',
    }),
    europe: Object.freeze({
      laneId: requireManagedLaneId(MANAGED_WALLET_HOME_LANE_IDS.europe),
      productRegion: 'europe',
      label: 'Europe',
    }),
    asia_pacific: Object.freeze({
      laneId: requireManagedLaneId(MANAGED_WALLET_HOME_LANE_IDS.asiaPacific),
      productRegion: 'asia_pacific',
      label: 'Asia Pacific',
    }),
  });

export type WalletHomeLane<TLaneId extends WalletHomeLaneId = WalletHomeLaneId> = {
  readonly walletId: WalletId;
  readonly laneId: TLaneId;
  readonly laneEpoch: WalletLaneEpoch;
  readonly [walletHomeLaneProof]: true;
};

export type WalletRegionMigrationTarget<
  TSourceLaneId extends WalletHomeLaneId = WalletHomeLaneId,
  TTargetLaneId extends WalletHomeLaneId = WalletHomeLaneId,
> = {
  readonly sourceLaneId: TSourceLaneId;
  readonly targetLaneId: TTargetLaneId;
  readonly targetEpoch: WalletLaneEpoch;
  readonly [walletRegionMigrationTargetProof]: true;
};

export type WalletLaneContext = {
  readonly walletId: WalletId;
  readonly laneId: WalletHomeLaneId;
  readonly laneEpoch: WalletLaneEpoch;
  readonly directoryRevision: WalletDirectoryRevision;
  readonly [walletLaneContextProof]: true;
};

export function buildWalletHomeLane<TLaneId extends WalletHomeLaneId>(input: {
  readonly walletId: WalletId;
  readonly laneId: TLaneId;
  readonly laneEpoch: WalletLaneEpoch;
}): WalletHomeLane<TLaneId> {
  return {
    walletId: input.walletId,
    laneId: input.laneId,
    laneEpoch: input.laneEpoch,
    [walletHomeLaneProof]: true,
  };
}

export function parseWalletHomeLane(raw: unknown): WalletHomeLane {
  const record = requireRecord(raw, 'walletHomeLane');
  rejectUnknownFields(record, ['walletId', 'laneId', 'laneEpoch'], 'walletHomeLane');
  return buildWalletHomeLane({
    walletId: requireWalletId(record.walletId, 'walletHomeLane.walletId'),
    laneId: requireWalletRegionBoundary(
      parseWalletHomeLaneId(record.laneId),
      'walletHomeLane.laneId',
    ),
    laneEpoch: requireWalletRegionBoundary(
      parseWalletLaneEpoch(record.laneEpoch),
      'walletHomeLane.laneEpoch',
    ),
  });
}

type DifferentWalletHomeLane<
  TSourceLaneId extends WalletHomeLaneId,
  TTargetLaneId extends WalletHomeLaneId,
> = TTargetLaneId extends TSourceLaneId ? never : TTargetLaneId;

export function buildWalletRegionMigrationTarget<
  TSourceLaneId extends WalletHomeLaneId,
  TTargetLaneId extends WalletHomeLaneId,
>(
  source: WalletHomeLane<TSourceLaneId>,
  targetLaneId: DifferentWalletHomeLane<TSourceLaneId, TTargetLaneId>,
): WalletRegionMigrationTarget<TSourceLaneId, TTargetLaneId> {
  if (String(source.laneId) === String(targetLaneId)) {
    throw new Error('wallet region migration target lane must differ from its source lane');
  }
  return {
    sourceLaneId: source.laneId,
    targetLaneId,
    targetEpoch: nextWalletLaneEpoch(source.laneEpoch),
    [walletRegionMigrationTargetProof]: true,
  };
}

export function parseWalletRegionMigrationTarget(
  raw: unknown,
  source: WalletHomeLane,
): WalletRegionMigrationTarget {
  const record = requireRecord(raw, 'walletRegionMigrationTarget');
  rejectUnknownFields(
    record,
    ['sourceLaneId', 'targetLaneId', 'targetEpoch'],
    'walletRegionMigrationTarget',
  );
  const sourceLaneId = requireWalletRegionBoundary(
    parseWalletHomeLaneId(record.sourceLaneId),
    'walletRegionMigrationTarget.sourceLaneId',
  );
  const targetLaneId = requireWalletRegionBoundary(
    parseWalletHomeLaneId(record.targetLaneId),
    'walletRegionMigrationTarget.targetLaneId',
  );
  const targetEpoch = requireWalletRegionBoundary(
    parseWalletLaneEpoch(record.targetEpoch),
    'walletRegionMigrationTarget.targetEpoch',
  );
  if (sourceLaneId !== source.laneId) {
    throw new Error('wallet region migration target does not name the source lane');
  }
  if (targetLaneId === source.laneId) {
    throw new Error('wallet region migration target lane must differ from its source lane');
  }
  if (targetEpoch !== nextWalletLaneEpoch(source.laneEpoch)) {
    throw new Error(
      'wallet region migration target epoch must immediately follow the source epoch',
    );
  }
  return {
    sourceLaneId,
    targetLaneId,
    targetEpoch,
    [walletRegionMigrationTargetProof]: true,
  };
}

export function buildWalletLaneContext(input: {
  readonly homeLane: WalletHomeLane;
  readonly directoryRevision: WalletDirectoryRevision;
}): WalletLaneContext {
  return {
    walletId: input.homeLane.walletId,
    laneId: input.homeLane.laneId,
    laneEpoch: input.homeLane.laneEpoch,
    directoryRevision: input.directoryRevision,
    [walletLaneContextProof]: true,
  };
}

export function parseWalletLaneContext(raw: unknown): WalletLaneContext {
  const record = requireRecord(raw, 'walletLaneContext');
  rejectUnknownFields(
    record,
    ['walletId', 'laneId', 'laneEpoch', 'directoryRevision'],
    'walletLaneContext',
  );
  const homeLane = buildWalletHomeLane({
    walletId: requireWalletId(record.walletId, 'walletLaneContext.walletId'),
    laneId: requireWalletRegionBoundary(
      parseWalletHomeLaneId(record.laneId),
      'walletLaneContext.laneId',
    ),
    laneEpoch: requireWalletRegionBoundary(
      parseWalletLaneEpoch(record.laneEpoch),
      'walletLaneContext.laneEpoch',
    ),
  });
  return buildWalletLaneContext({
    homeLane,
    directoryRevision: requireWalletRegionBoundary(
      parseWalletDirectoryRevision(record.directoryRevision),
      'walletLaneContext.directoryRevision',
    ),
  });
}

export function walletHomeLanesEqual(left: WalletHomeLane, right: WalletHomeLane): boolean {
  return (
    left.walletId === right.walletId &&
    left.laneId === right.laneId &&
    left.laneEpoch === right.laneEpoch
  );
}
