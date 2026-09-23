import type { DigestB64u } from '../utils/canonicalPrimitives';
import type { WalletId } from '../utils/domainIds';
import { buildWalletHomeLane, buildWalletRegionMigrationTarget } from './homeLane';
import {
  authorizeWalletRegionMigration,
  type AuthorizedWalletRegionMigration,
  type CutoverCommittedWalletRegionMigration,
  type SourceFrozenWalletRegionMigration,
  type TargetVerifiedWalletRegionMigration,
} from './migration';
import {
  parseUnixTimestamp,
  parseWalletHomeLaneId,
  parseWalletLaneEpoch,
  type WalletRegionMigrationGrantDigest,
  type WalletRegionMigrationId,
} from './ids';
import type {
  DirectoryCutoverReceipt,
  SourceMigrationFence,
  TargetCustodyReceipt,
} from './receipts';
import type { WalletRegionMigrationGrant, WalletRegionMigrationGrantUnsignedFields } from './grant';

declare const walletId: WalletId;
declare const migrationId: WalletRegionMigrationId;
declare const grantDigest: WalletRegionMigrationGrantDigest;
declare const sourceFence: SourceMigrationFence;
declare const targetReceipt: TargetCustodyReceipt;
declare const cutoverReceipt: DirectoryCutoverReceipt;
declare const authorized: AuthorizedWalletRegionMigration;
declare const frozen: SourceFrozenWalletRegionMigration;
declare const verified: TargetVerifiedWalletRegionMigration;
declare const grantFields: WalletRegionMigrationGrantUnsignedFields;

const northAmericaResult = parseWalletHomeLaneId('managed-na-v1');
const europeResult = parseWalletHomeLaneId('managed-eu-v1');
const epochResult = parseWalletLaneEpoch(1);
const expiresAtResult = parseUnixTimestamp(10_000);
const nowResult = parseUnixTimestamp(1_000);
if (!northAmericaResult.ok) throw new Error(northAmericaResult.error.message);
if (!europeResult.ok) throw new Error(europeResult.error.message);
if (!epochResult.ok) throw new Error(epochResult.error.message);
if (!expiresAtResult.ok) throw new Error(expiresAtResult.error.message);
if (!nowResult.ok) throw new Error(nowResult.error.message);

const source = buildWalletHomeLane({
  walletId,
  laneId: northAmericaResult.value,
  laneEpoch: epochResult.value,
});
const target = buildWalletRegionMigrationTarget(source, europeResult.value);
authorizeWalletRegionMigration({
  migrationId,
  source,
  target,
  grantDigest,
  expiresAt: expiresAtResult.value,
  now: nowResult.value,
});

// @ts-expect-error Raw strings cannot construct an internal home-lane identity.
buildWalletHomeLane({ walletId: 'wallet:raw', laneId: 'managed-na-v1', laneEpoch: 1 });

// @ts-expect-error A migration cannot target its exact source lane.
buildWalletRegionMigrationTarget(source, northAmericaResult.value);

// @ts-expect-error A target with a caller-selected non-sequential epoch lacks the builder proof.
const nonSequentialTarget: typeof target = {
  sourceLaneId: northAmericaResult.value,
  targetLaneId: europeResult.value,
  targetEpoch: epochResult.value,
};
void nonSequentialTarget;

// @ts-expect-error A source-frozen migration requires its source fence.
const frozenWithoutFence: SourceFrozenWalletRegionMigration = {
  ...authorized,
  kind: 'source_frozen',
};
void frozenWithoutFence;

// @ts-expect-error A target-verified migration requires its target receipt.
const verifiedWithoutTargetReceipt: TargetVerifiedWalletRegionMigration = {
  ...frozen,
  kind: 'target_verified',
};
void verifiedWithoutTargetReceipt;

// @ts-expect-error A committed migration requires its cutover receipt.
const committedWithoutCutover: CutoverCommittedWalletRegionMigration = {
  ...verified,
  kind: 'cutover_committed',
};
void committedWithoutCutover;

// @ts-expect-error A source fence cannot appear in the authorized stage.
const fenceBeforeFreeze: AuthorizedWalletRegionMigration = { ...authorized, sourceFence };
void fenceBeforeFreeze;

// @ts-expect-error A target receipt cannot appear before the target-verified stage.
const targetBeforeVerification: SourceFrozenWalletRegionMigration = { ...frozen, targetReceipt };
void targetBeforeVerification;

// @ts-expect-error A cutover receipt cannot appear before the committed stage.
const cutoverBeforeCommit: TargetVerifiedWalletRegionMigration = { ...verified, cutoverReceipt };
void cutoverBeforeCommit;

// @ts-expect-error A raw object cannot manufacture a verified migration grant.
const directGrant: WalletRegionMigrationGrant = { ...grantFields, grantDigest };
void directGrant;

declare const digest: DigestB64u;
void digest;
