import { rejectUnknownFields, requireRecord } from '../passkey-custody/primitives';
import type { WalletId } from '../utils/domainIds';
import {
  buildWalletHomeLane,
  parseWalletHomeLane,
  parseWalletRegionMigrationTarget,
  type WalletHomeLane,
  type WalletRegionMigrationTarget,
} from './homeLane';
import {
  parseUnixTimestamp,
  parseWalletHomeLaneId,
  parseWalletLaneEpoch,
  parseWalletRegionMigrationGrantDigest,
  parseWalletRegionMigrationId,
  requireWalletId,
  requireWalletRegionBoundary,
  type UnixTimestamp,
  type WalletHomeLaneId,
  type WalletLaneEpoch,
  type WalletRegionMigrationGrantDigest,
  type WalletRegionMigrationId,
} from './ids';
import {
  parseDirectoryCutoverReceipt,
  parseSourceMigrationFence,
  parseTargetCustodyReceipt,
  type DirectoryCutoverReceipt,
  type SourceMigrationFence,
  type TargetCustodyReceipt,
} from './receipts';

const walletRegionMigrationProof: unique symbol = Symbol('WalletRegionMigration');

type WalletRegionMigrationCommon = {
  readonly migrationId: WalletRegionMigrationId;
  readonly walletId: WalletId;
  readonly source: WalletHomeLane;
  readonly targetLaneId: WalletHomeLaneId;
  readonly targetEpoch: WalletLaneEpoch;
  readonly grantDigest: WalletRegionMigrationGrantDigest;
  readonly expiresAt: UnixTimestamp;
  readonly [walletRegionMigrationProof]: true;
};

export type AuthorizedWalletRegionMigration = WalletRegionMigrationCommon & {
  readonly kind: 'authorized';
  readonly sourceFence?: never;
  readonly targetReceipt?: never;
  readonly cutoverReceipt?: never;
};

export type SourceFrozenWalletRegionMigration = WalletRegionMigrationCommon & {
  readonly kind: 'source_frozen';
  readonly sourceFence: SourceMigrationFence;
  readonly targetReceipt?: never;
  readonly cutoverReceipt?: never;
};

export type TargetVerifiedWalletRegionMigration = WalletRegionMigrationCommon & {
  readonly kind: 'target_verified';
  readonly sourceFence: SourceMigrationFence;
  readonly targetReceipt: TargetCustodyReceipt;
  readonly cutoverReceipt?: never;
};

export type CutoverCommittedWalletRegionMigration = WalletRegionMigrationCommon & {
  readonly kind: 'cutover_committed';
  readonly sourceFence: SourceMigrationFence;
  readonly targetReceipt: TargetCustodyReceipt;
  readonly cutoverReceipt: DirectoryCutoverReceipt;
};

export type CompletedWalletRegionMigration = WalletRegionMigrationCommon & {
  readonly kind: 'completed';
  readonly sourceFence: SourceMigrationFence;
  readonly targetReceipt: TargetCustodyReceipt;
  readonly cutoverReceipt: DirectoryCutoverReceipt;
};

export type WalletRegionMigration =
  | AuthorizedWalletRegionMigration
  | SourceFrozenWalletRegionMigration
  | TargetVerifiedWalletRegionMigration
  | CutoverCommittedWalletRegionMigration
  | CompletedWalletRegionMigration;

export type WalletRegionMigrationTransitionErrorCode =
  | 'authorization_expired'
  | 'receipt_binding_mismatch'
  | 'source_fence_digest_mismatch'
  | 'key_manifest_mismatch'
  | 'target_receipt_digest_mismatch'
  | 'directory_revision_not_advanced';

export type WalletRegionMigrationTransitionError = {
  readonly code: WalletRegionMigrationTransitionErrorCode;
  readonly message: string;
};

export type WalletRegionMigrationTransitionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WalletRegionMigrationTransitionError };

function transitionFailure(
  code: WalletRegionMigrationTransitionErrorCode,
  message: string,
): WalletRegionMigrationTransitionResult<never> {
  return { ok: false, error: { code, message } };
}

function requirePositiveUnixTimestamp(value: UnixTimestamp, label: string): UnixTimestamp {
  return requireWalletRegionBoundary(parseUnixTimestamp(value), label);
}

function buildAuthorizedMigration(input: {
  readonly migrationId: WalletRegionMigrationId;
  readonly source: WalletHomeLane;
  readonly target: WalletRegionMigrationTarget;
  readonly grantDigest: WalletRegionMigrationGrantDigest;
  readonly expiresAt: UnixTimestamp;
}): AuthorizedWalletRegionMigration {
  return {
    kind: 'authorized',
    migrationId: input.migrationId,
    walletId: input.source.walletId,
    source: input.source,
    targetLaneId: input.target.targetLaneId,
    targetEpoch: input.target.targetEpoch,
    grantDigest: input.grantDigest,
    expiresAt: requirePositiveUnixTimestamp(input.expiresAt, 'wallet region migration expiresAt'),
    [walletRegionMigrationProof]: true,
  };
}

export function authorizeWalletRegionMigration(input: {
  readonly migrationId: WalletRegionMigrationId;
  readonly source: WalletHomeLane;
  readonly target: WalletRegionMigrationTarget;
  readonly grantDigest: WalletRegionMigrationGrantDigest;
  readonly expiresAt: UnixTimestamp;
  readonly now: UnixTimestamp;
}): WalletRegionMigrationTransitionResult<AuthorizedWalletRegionMigration> {
  if (input.target.sourceLaneId !== input.source.laneId) {
    return transitionFailure(
      'receipt_binding_mismatch',
      'wallet region migration target does not belong to the source lane',
    );
  }
  if (input.now >= input.expiresAt) {
    return transitionFailure(
      'authorization_expired',
      'wallet region migration authorization has expired',
    );
  }
  return { ok: true, value: buildAuthorizedMigration(input) };
}

type ReceiptBinding = {
  readonly migrationId: WalletRegionMigrationId;
  readonly walletId: WalletId;
  readonly sourceLaneId: WalletHomeLaneId;
  readonly sourceEpoch: WalletLaneEpoch;
  readonly targetLaneId: WalletHomeLaneId;
  readonly targetEpoch: WalletLaneEpoch;
  readonly grantDigest: WalletRegionMigrationGrantDigest;
};

function receiptMatchesMigration(
  migration: WalletRegionMigrationCommon,
  receipt: ReceiptBinding,
): boolean {
  return (
    receipt.migrationId === migration.migrationId &&
    receipt.walletId === migration.walletId &&
    receipt.sourceLaneId === migration.source.laneId &&
    receipt.sourceEpoch === migration.source.laneEpoch &&
    receipt.targetLaneId === migration.targetLaneId &&
    receipt.targetEpoch === migration.targetEpoch &&
    receipt.grantDigest === migration.grantDigest
  );
}

export function recordWalletRegionSourceFence(
  current: AuthorizedWalletRegionMigration,
  sourceFence: SourceMigrationFence,
): WalletRegionMigrationTransitionResult<SourceFrozenWalletRegionMigration> {
  if (!receiptMatchesMigration(current, sourceFence)) {
    return transitionFailure(
      'receipt_binding_mismatch',
      'source migration fence does not match the authorized migration',
    );
  }
  return {
    ok: true,
    value: {
      kind: 'source_frozen',
      migrationId: current.migrationId,
      walletId: current.walletId,
      source: current.source,
      targetLaneId: current.targetLaneId,
      targetEpoch: current.targetEpoch,
      grantDigest: current.grantDigest,
      expiresAt: current.expiresAt,
      sourceFence,
      [walletRegionMigrationProof]: true,
    },
  };
}

export function recordWalletRegionTargetReceipt(
  current: SourceFrozenWalletRegionMigration,
  targetReceipt: TargetCustodyReceipt,
): WalletRegionMigrationTransitionResult<TargetVerifiedWalletRegionMigration> {
  if (!receiptMatchesMigration(current, targetReceipt)) {
    return transitionFailure(
      'receipt_binding_mismatch',
      'target custody receipt does not match the frozen migration',
    );
  }
  if (targetReceipt.sourceFenceDigestB64u !== current.sourceFence.receiptDigestB64u) {
    return transitionFailure(
      'source_fence_digest_mismatch',
      'target custody receipt does not bind the committed source fence',
    );
  }
  if (
    targetReceipt.custodyKeyManifestDigestB64u !== current.sourceFence.custodyKeyManifestDigestB64u
  ) {
    return transitionFailure(
      'key_manifest_mismatch',
      'target custody receipt does not reproduce the source key manifest',
    );
  }
  return {
    ok: true,
    value: {
      kind: 'target_verified',
      migrationId: current.migrationId,
      walletId: current.walletId,
      source: current.source,
      targetLaneId: current.targetLaneId,
      targetEpoch: current.targetEpoch,
      grantDigest: current.grantDigest,
      expiresAt: current.expiresAt,
      sourceFence: current.sourceFence,
      targetReceipt,
      [walletRegionMigrationProof]: true,
    },
  };
}

export function recordWalletRegionDirectoryCutover(
  current: TargetVerifiedWalletRegionMigration,
  cutoverReceipt: DirectoryCutoverReceipt,
): WalletRegionMigrationTransitionResult<CutoverCommittedWalletRegionMigration> {
  if (!receiptMatchesMigration(current, cutoverReceipt)) {
    return transitionFailure(
      'receipt_binding_mismatch',
      'directory cutover receipt does not match the verified migration',
    );
  }
  if (cutoverReceipt.sourceFenceDigestB64u !== current.sourceFence.receiptDigestB64u) {
    return transitionFailure(
      'source_fence_digest_mismatch',
      'directory cutover receipt does not bind the committed source fence',
    );
  }
  if (cutoverReceipt.targetReceiptDigestB64u !== current.targetReceipt.receiptDigestB64u) {
    return transitionFailure(
      'target_receipt_digest_mismatch',
      'directory cutover receipt does not bind the verified target receipt',
    );
  }
  if (cutoverReceipt.directoryRevision <= current.sourceFence.directoryRevision) {
    return transitionFailure(
      'directory_revision_not_advanced',
      'directory cutover receipt must advance the source directory revision',
    );
  }
  return {
    ok: true,
    value: {
      kind: 'cutover_committed',
      migrationId: current.migrationId,
      walletId: current.walletId,
      source: current.source,
      targetLaneId: current.targetLaneId,
      targetEpoch: current.targetEpoch,
      grantDigest: current.grantDigest,
      expiresAt: current.expiresAt,
      sourceFence: current.sourceFence,
      targetReceipt: current.targetReceipt,
      cutoverReceipt,
      [walletRegionMigrationProof]: true,
    },
  };
}

export function completeWalletRegionMigration(
  current: CutoverCommittedWalletRegionMigration,
): CompletedWalletRegionMigration {
  return {
    kind: 'completed',
    migrationId: current.migrationId,
    walletId: current.walletId,
    source: current.source,
    targetLaneId: current.targetLaneId,
    targetEpoch: current.targetEpoch,
    grantDigest: current.grantDigest,
    expiresAt: current.expiresAt,
    sourceFence: current.sourceFence,
    targetReceipt: current.targetReceipt,
    cutoverReceipt: current.cutoverReceipt,
    [walletRegionMigrationProof]: true,
  };
}

const MIGRATION_COMMON_FIELDS = [
  'kind',
  'migrationId',
  'walletId',
  'source',
  'targetLaneId',
  'targetEpoch',
  'grantDigest',
  'expiresAt',
] as const;

function parseMigrationCommon(record: Record<string, unknown>): {
  readonly migrationId: WalletRegionMigrationId;
  readonly walletId: WalletId;
  readonly source: WalletHomeLane;
  readonly target: WalletRegionMigrationTarget;
  readonly grantDigest: WalletRegionMigrationGrantDigest;
  readonly expiresAt: UnixTimestamp;
} {
  const walletId = requireWalletId(record.walletId, 'walletRegionMigration.walletId');
  const source = parseWalletHomeLane(record.source);
  if (source.walletId !== walletId) {
    throw new Error('walletRegionMigration source belongs to another wallet');
  }
  const target = parseWalletRegionMigrationTarget(
    {
      sourceLaneId: source.laneId,
      targetLaneId: requireWalletRegionBoundary(
        parseWalletHomeLaneId(record.targetLaneId),
        'walletRegionMigration.targetLaneId',
      ),
      targetEpoch: requireWalletRegionBoundary(
        parseWalletLaneEpoch(record.targetEpoch),
        'walletRegionMigration.targetEpoch',
      ),
    },
    source,
  );
  return {
    migrationId: requireWalletRegionBoundary(
      parseWalletRegionMigrationId(record.migrationId),
      'walletRegionMigration.migrationId',
    ),
    walletId,
    source,
    target,
    grantDigest: requireWalletRegionBoundary(
      parseWalletRegionMigrationGrantDigest(record.grantDigest),
      'walletRegionMigration.grantDigest',
    ),
    expiresAt: requireWalletRegionBoundary(
      parseUnixTimestamp(record.expiresAt),
      'walletRegionMigration.expiresAt',
    ),
  };
}

function authorizedFromParsed(
  input: ReturnType<typeof parseMigrationCommon>,
): AuthorizedWalletRegionMigration {
  return buildAuthorizedMigration({
    migrationId: input.migrationId,
    source: input.source,
    target: input.target,
    grantDigest: input.grantDigest,
    expiresAt: input.expiresAt,
  });
}

export function parseWalletRegionMigration(raw: unknown): WalletRegionMigration {
  const record = requireRecord(raw, 'walletRegionMigration');
  const parsed = parseMigrationCommon(record);
  const authorized = authorizedFromParsed(parsed);
  switch (record.kind) {
    case 'authorized':
      rejectUnknownFields(record, MIGRATION_COMMON_FIELDS, 'walletRegionMigration');
      return authorized;
    case 'source_frozen': {
      rejectUnknownFields(
        record,
        [...MIGRATION_COMMON_FIELDS, 'sourceFence'],
        'walletRegionMigration',
      );
      const transitioned = recordWalletRegionSourceFence(
        authorized,
        parseSourceMigrationFence(record.sourceFence),
      );
      if (!transitioned.ok) throw new Error(transitioned.error.message);
      return transitioned.value;
    }
    case 'target_verified': {
      rejectUnknownFields(
        record,
        [...MIGRATION_COMMON_FIELDS, 'sourceFence', 'targetReceipt'],
        'walletRegionMigration',
      );
      const frozen = recordWalletRegionSourceFence(
        authorized,
        parseSourceMigrationFence(record.sourceFence),
      );
      if (!frozen.ok) throw new Error(frozen.error.message);
      const verified = recordWalletRegionTargetReceipt(
        frozen.value,
        parseTargetCustodyReceipt(record.targetReceipt),
      );
      if (!verified.ok) throw new Error(verified.error.message);
      return verified.value;
    }
    case 'cutover_committed':
    case 'completed': {
      rejectUnknownFields(
        record,
        [...MIGRATION_COMMON_FIELDS, 'sourceFence', 'targetReceipt', 'cutoverReceipt'],
        'walletRegionMigration',
      );
      const frozen = recordWalletRegionSourceFence(
        authorized,
        parseSourceMigrationFence(record.sourceFence),
      );
      if (!frozen.ok) throw new Error(frozen.error.message);
      const verified = recordWalletRegionTargetReceipt(
        frozen.value,
        parseTargetCustodyReceipt(record.targetReceipt),
      );
      if (!verified.ok) throw new Error(verified.error.message);
      const committed = recordWalletRegionDirectoryCutover(
        verified.value,
        parseDirectoryCutoverReceipt(record.cutoverReceipt),
      );
      if (!committed.ok) throw new Error(committed.error.message);
      return record.kind === 'completed'
        ? completeWalletRegionMigration(committed.value)
        : committed.value;
    }
    default:
      throw new Error('walletRegionMigration.kind is invalid');
  }
}

export function walletRegionMigrationTargetHomeLane(
  migration: CutoverCommittedWalletRegionMigration | CompletedWalletRegionMigration,
): WalletHomeLane {
  return buildWalletHomeLane({
    walletId: migration.walletId,
    laneId: migration.targetLaneId,
    laneEpoch: migration.targetEpoch,
  });
}
