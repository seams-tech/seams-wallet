import { rejectUnknownFields, requireRecord } from '../passkey-custody/primitives';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import type { WalletId } from '../utils/domainIds';
import {
  parseWalletDirectoryRevision,
  parseWalletHomeLaneId,
  parseWalletLaneEpoch,
  parseWalletRegionMigrationGrantDigest,
  parseWalletRegionMigrationId,
  parseWalletRegionReceiptDigest,
  parseWalletRegionReceiptSignatureB64u,
  parseWalletRegionReceiptSignerKeyId,
  requireWalletId,
  requireWalletRegionBoundary,
  type WalletDirectoryRevision,
  type WalletHomeLaneId,
  type WalletLaneEpoch,
  type WalletRegionMigrationGrantDigest,
  type WalletRegionMigrationId,
  type WalletRegionReceiptDigest,
  type WalletRegionReceiptSignatureB64u,
  type WalletRegionReceiptSignerKeyId,
} from './ids';

const sourceMigrationFenceProof: unique symbol = Symbol('SourceMigrationFence');
const targetCustodyReceiptProof: unique symbol = Symbol('TargetCustodyReceipt');
const directoryCutoverReceiptProof: unique symbol = Symbol('DirectoryCutoverReceipt');

type WalletRegionReceiptBinding = {
  readonly migrationId: WalletRegionMigrationId;
  readonly walletId: WalletId;
  readonly sourceLaneId: WalletHomeLaneId;
  readonly sourceEpoch: WalletLaneEpoch;
  readonly targetLaneId: WalletHomeLaneId;
  readonly targetEpoch: WalletLaneEpoch;
  readonly grantDigest: WalletRegionMigrationGrantDigest;
};

type SignedWalletRegionReceipt = {
  readonly receiptSignerKeyId: WalletRegionReceiptSignerKeyId;
  readonly receiptDigestB64u: WalletRegionReceiptDigest;
  readonly receiptSignatureB64u: WalletRegionReceiptSignatureB64u;
};

export type SourceMigrationFence = WalletRegionReceiptBinding &
  SignedWalletRegionReceipt & {
    readonly version: 'wallet_region_source_fence_v1';
    readonly directoryRevision: WalletDirectoryRevision;
    readonly custodyKeyManifestDigestB64u: DigestB64u;
    readonly finalCommandRevision: number;
    readonly finalReplayRevision: number;
    readonly finalKeyGeneration: number;
    readonly finalManifestGeneration: number;
    readonly frozenAtMs: number;
    readonly [sourceMigrationFenceProof]: true;
  };

export type TargetCustodyReceipt = WalletRegionReceiptBinding &
  SignedWalletRegionReceipt & {
    readonly version: 'wallet_region_target_custody_receipt_v1';
    readonly sourceFenceDigestB64u: WalletRegionReceiptDigest;
    readonly custodyKeyManifestDigestB64u: DigestB64u;
    readonly publicKeySetDigestB64u: DigestB64u;
    readonly preparedAtMs: number;
    readonly [targetCustodyReceiptProof]: true;
  };

export type DirectoryCutoverReceipt = WalletRegionReceiptBinding &
  SignedWalletRegionReceipt & {
    readonly version: 'wallet_region_directory_cutover_receipt_v1';
    readonly sourceFenceDigestB64u: WalletRegionReceiptDigest;
    readonly targetReceiptDigestB64u: WalletRegionReceiptDigest;
    readonly directoryRevision: WalletDirectoryRevision;
    readonly committedAtMs: number;
    readonly [directoryCutoverReceiptProof]: true;
  };

function requirePositiveUnixMs(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive unix-millisecond timestamp`);
  }
  return value;
}

function requireNonnegativeRevision(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requireDigest(value: unknown, label: string): DigestB64u {
  try {
    return parseDigestB64u(value);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : 'invalid digest'}`);
  }
}

function parseReceiptBinding(
  record: Record<string, unknown>,
  label: string,
): WalletRegionReceiptBinding {
  return {
    migrationId: requireWalletRegionBoundary(
      parseWalletRegionMigrationId(record.migrationId),
      `${label}.migrationId`,
    ),
    walletId: requireWalletId(record.walletId, `${label}.walletId`),
    sourceLaneId: requireWalletRegionBoundary(
      parseWalletHomeLaneId(record.sourceLaneId),
      `${label}.sourceLaneId`,
    ),
    sourceEpoch: requireWalletRegionBoundary(
      parseWalletLaneEpoch(record.sourceEpoch),
      `${label}.sourceEpoch`,
    ),
    targetLaneId: requireWalletRegionBoundary(
      parseWalletHomeLaneId(record.targetLaneId),
      `${label}.targetLaneId`,
    ),
    targetEpoch: requireWalletRegionBoundary(
      parseWalletLaneEpoch(record.targetEpoch),
      `${label}.targetEpoch`,
    ),
    grantDigest: requireWalletRegionBoundary(
      parseWalletRegionMigrationGrantDigest(record.grantDigest),
      `${label}.grantDigest`,
    ),
  };
}

function parseSignedReceipt(
  record: Record<string, unknown>,
  label: string,
): SignedWalletRegionReceipt {
  return {
    receiptSignerKeyId: requireWalletRegionBoundary(
      parseWalletRegionReceiptSignerKeyId(record.receiptSignerKeyId),
      `${label}.receiptSignerKeyId`,
    ),
    receiptDigestB64u: requireWalletRegionBoundary(
      parseWalletRegionReceiptDigest(record.receiptDigestB64u),
      `${label}.receiptDigestB64u`,
    ),
    receiptSignatureB64u: requireWalletRegionBoundary(
      parseWalletRegionReceiptSignatureB64u(record.receiptSignatureB64u),
      `${label}.receiptSignatureB64u`,
    ),
  };
}

const RECEIPT_BINDING_FIELDS = [
  'migrationId',
  'walletId',
  'sourceLaneId',
  'sourceEpoch',
  'targetLaneId',
  'targetEpoch',
  'grantDigest',
] as const;

const SIGNED_RECEIPT_FIELDS = [
  'receiptSignerKeyId',
  'receiptDigestB64u',
  'receiptSignatureB64u',
] as const;

export function buildSourceMigrationFence(
  input: Omit<SourceMigrationFence, typeof sourceMigrationFenceProof>,
): SourceMigrationFence {
  return {
    version: input.version,
    migrationId: input.migrationId,
    walletId: input.walletId,
    sourceLaneId: input.sourceLaneId,
    sourceEpoch: input.sourceEpoch,
    targetLaneId: input.targetLaneId,
    targetEpoch: input.targetEpoch,
    grantDigest: input.grantDigest,
    directoryRevision: input.directoryRevision,
    custodyKeyManifestDigestB64u: input.custodyKeyManifestDigestB64u,
    finalCommandRevision: requireNonnegativeRevision(
      input.finalCommandRevision,
      'sourceMigrationFence.finalCommandRevision',
    ),
    finalReplayRevision: requireNonnegativeRevision(
      input.finalReplayRevision,
      'sourceMigrationFence.finalReplayRevision',
    ),
    finalKeyGeneration: requireNonnegativeRevision(
      input.finalKeyGeneration,
      'sourceMigrationFence.finalKeyGeneration',
    ),
    finalManifestGeneration: requireNonnegativeRevision(
      input.finalManifestGeneration,
      'sourceMigrationFence.finalManifestGeneration',
    ),
    frozenAtMs: requirePositiveUnixMs(input.frozenAtMs, 'sourceMigrationFence.frozenAtMs'),
    receiptSignerKeyId: input.receiptSignerKeyId,
    receiptDigestB64u: input.receiptDigestB64u,
    receiptSignatureB64u: input.receiptSignatureB64u,
    [sourceMigrationFenceProof]: true,
  };
}

export function parseSourceMigrationFence(raw: unknown): SourceMigrationFence {
  const label = 'sourceMigrationFence';
  const record = requireRecord(raw, label);
  rejectUnknownFields(
    record,
    [
      'version',
      ...RECEIPT_BINDING_FIELDS,
      'directoryRevision',
      'custodyKeyManifestDigestB64u',
      'finalCommandRevision',
      'finalReplayRevision',
      'finalKeyGeneration',
      'finalManifestGeneration',
      'frozenAtMs',
      ...SIGNED_RECEIPT_FIELDS,
    ],
    label,
  );
  if (record.version !== 'wallet_region_source_fence_v1') {
    throw new Error(`${label}.version is invalid`);
  }
  const binding = parseReceiptBinding(record, label);
  const signed = parseSignedReceipt(record, label);
  return buildSourceMigrationFence({
    version: record.version,
    migrationId: binding.migrationId,
    walletId: binding.walletId,
    sourceLaneId: binding.sourceLaneId,
    sourceEpoch: binding.sourceEpoch,
    targetLaneId: binding.targetLaneId,
    targetEpoch: binding.targetEpoch,
    grantDigest: binding.grantDigest,
    directoryRevision: requireWalletRegionBoundary(
      parseWalletDirectoryRevision(record.directoryRevision),
      `${label}.directoryRevision`,
    ),
    custodyKeyManifestDigestB64u: requireDigest(
      record.custodyKeyManifestDigestB64u,
      `${label}.custodyKeyManifestDigestB64u`,
    ),
    finalCommandRevision: requireNonnegativeRevision(
      record.finalCommandRevision,
      `${label}.finalCommandRevision`,
    ),
    finalReplayRevision: requireNonnegativeRevision(
      record.finalReplayRevision,
      `${label}.finalReplayRevision`,
    ),
    finalKeyGeneration: requireNonnegativeRevision(
      record.finalKeyGeneration,
      `${label}.finalKeyGeneration`,
    ),
    finalManifestGeneration: requireNonnegativeRevision(
      record.finalManifestGeneration,
      `${label}.finalManifestGeneration`,
    ),
    frozenAtMs: requirePositiveUnixMs(record.frozenAtMs, `${label}.frozenAtMs`),
    receiptSignerKeyId: signed.receiptSignerKeyId,
    receiptDigestB64u: signed.receiptDigestB64u,
    receiptSignatureB64u: signed.receiptSignatureB64u,
  });
}

export function buildTargetCustodyReceipt(
  input: Omit<TargetCustodyReceipt, typeof targetCustodyReceiptProof>,
): TargetCustodyReceipt {
  return {
    version: input.version,
    migrationId: input.migrationId,
    walletId: input.walletId,
    sourceLaneId: input.sourceLaneId,
    sourceEpoch: input.sourceEpoch,
    targetLaneId: input.targetLaneId,
    targetEpoch: input.targetEpoch,
    grantDigest: input.grantDigest,
    sourceFenceDigestB64u: input.sourceFenceDigestB64u,
    custodyKeyManifestDigestB64u: input.custodyKeyManifestDigestB64u,
    publicKeySetDigestB64u: input.publicKeySetDigestB64u,
    preparedAtMs: requirePositiveUnixMs(input.preparedAtMs, 'targetCustodyReceipt.preparedAtMs'),
    receiptSignerKeyId: input.receiptSignerKeyId,
    receiptDigestB64u: input.receiptDigestB64u,
    receiptSignatureB64u: input.receiptSignatureB64u,
    [targetCustodyReceiptProof]: true,
  };
}

export function parseTargetCustodyReceipt(raw: unknown): TargetCustodyReceipt {
  const label = 'targetCustodyReceipt';
  const record = requireRecord(raw, label);
  rejectUnknownFields(
    record,
    [
      'version',
      ...RECEIPT_BINDING_FIELDS,
      'sourceFenceDigestB64u',
      'custodyKeyManifestDigestB64u',
      'publicKeySetDigestB64u',
      'preparedAtMs',
      ...SIGNED_RECEIPT_FIELDS,
    ],
    label,
  );
  if (record.version !== 'wallet_region_target_custody_receipt_v1') {
    throw new Error(`${label}.version is invalid`);
  }
  const binding = parseReceiptBinding(record, label);
  const signed = parseSignedReceipt(record, label);
  return buildTargetCustodyReceipt({
    version: record.version,
    migrationId: binding.migrationId,
    walletId: binding.walletId,
    sourceLaneId: binding.sourceLaneId,
    sourceEpoch: binding.sourceEpoch,
    targetLaneId: binding.targetLaneId,
    targetEpoch: binding.targetEpoch,
    grantDigest: binding.grantDigest,
    sourceFenceDigestB64u: requireWalletRegionBoundary(
      parseWalletRegionReceiptDigest(record.sourceFenceDigestB64u),
      `${label}.sourceFenceDigestB64u`,
    ),
    custodyKeyManifestDigestB64u: requireDigest(
      record.custodyKeyManifestDigestB64u,
      `${label}.custodyKeyManifestDigestB64u`,
    ),
    publicKeySetDigestB64u: requireDigest(
      record.publicKeySetDigestB64u,
      `${label}.publicKeySetDigestB64u`,
    ),
    preparedAtMs: requirePositiveUnixMs(record.preparedAtMs, `${label}.preparedAtMs`),
    receiptSignerKeyId: signed.receiptSignerKeyId,
    receiptDigestB64u: signed.receiptDigestB64u,
    receiptSignatureB64u: signed.receiptSignatureB64u,
  });
}

export function buildDirectoryCutoverReceipt(
  input: Omit<DirectoryCutoverReceipt, typeof directoryCutoverReceiptProof>,
): DirectoryCutoverReceipt {
  return {
    version: input.version,
    migrationId: input.migrationId,
    walletId: input.walletId,
    sourceLaneId: input.sourceLaneId,
    sourceEpoch: input.sourceEpoch,
    targetLaneId: input.targetLaneId,
    targetEpoch: input.targetEpoch,
    grantDigest: input.grantDigest,
    sourceFenceDigestB64u: input.sourceFenceDigestB64u,
    targetReceiptDigestB64u: input.targetReceiptDigestB64u,
    directoryRevision: input.directoryRevision,
    committedAtMs: requirePositiveUnixMs(
      input.committedAtMs,
      'directoryCutoverReceipt.committedAtMs',
    ),
    receiptSignerKeyId: input.receiptSignerKeyId,
    receiptDigestB64u: input.receiptDigestB64u,
    receiptSignatureB64u: input.receiptSignatureB64u,
    [directoryCutoverReceiptProof]: true,
  };
}

export function parseDirectoryCutoverReceipt(raw: unknown): DirectoryCutoverReceipt {
  const label = 'directoryCutoverReceipt';
  const record = requireRecord(raw, label);
  rejectUnknownFields(
    record,
    [
      'version',
      ...RECEIPT_BINDING_FIELDS,
      'sourceFenceDigestB64u',
      'targetReceiptDigestB64u',
      'directoryRevision',
      'committedAtMs',
      ...SIGNED_RECEIPT_FIELDS,
    ],
    label,
  );
  if (record.version !== 'wallet_region_directory_cutover_receipt_v1') {
    throw new Error(`${label}.version is invalid`);
  }
  const binding = parseReceiptBinding(record, label);
  const signed = parseSignedReceipt(record, label);
  return buildDirectoryCutoverReceipt({
    version: record.version,
    migrationId: binding.migrationId,
    walletId: binding.walletId,
    sourceLaneId: binding.sourceLaneId,
    sourceEpoch: binding.sourceEpoch,
    targetLaneId: binding.targetLaneId,
    targetEpoch: binding.targetEpoch,
    grantDigest: binding.grantDigest,
    sourceFenceDigestB64u: requireWalletRegionBoundary(
      parseWalletRegionReceiptDigest(record.sourceFenceDigestB64u),
      `${label}.sourceFenceDigestB64u`,
    ),
    targetReceiptDigestB64u: requireWalletRegionBoundary(
      parseWalletRegionReceiptDigest(record.targetReceiptDigestB64u),
      `${label}.targetReceiptDigestB64u`,
    ),
    directoryRevision: requireWalletRegionBoundary(
      parseWalletDirectoryRevision(record.directoryRevision),
      `${label}.directoryRevision`,
    ),
    committedAtMs: requirePositiveUnixMs(record.committedAtMs, `${label}.committedAtMs`),
    receiptSignerKeyId: signed.receiptSignerKeyId,
    receiptDigestB64u: signed.receiptDigestB64u,
    receiptSignatureB64u: signed.receiptSignatureB64u,
  });
}
