import { base64UrlEncode } from '../../../packages/shared-ts/src/utils/base64';
import {
  parseDigestB64u,
  type DigestB64u,
} from '../../../packages/shared-ts/src/utils/canonicalPrimitives';
import {
  parseWalletAuthorityId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  type WalletId,
} from '../../../packages/shared-ts/src/utils/domainIds';
import {
  authorizeWalletRegionMigration,
  buildWalletLaneContext,
  buildWalletHomeLane,
  buildWalletRegionMigrationTarget,
  createWalletRegionMigrationGrant,
  parseDirectoryCutoverReceipt,
  parseSourceMigrationFence,
  parseTargetCustodyReceipt,
  parseUnixTimestamp,
  parseWalletDirectoryRevision,
  parseWalletHomeLaneId,
  parseWalletLaneEpoch,
  parseWalletRegionMigrationGrantDigest,
  parseWalletRegionMigrationId,
  parseWalletRegionPolicyVersion,
  parseWalletRegionRequestNonceB64u,
  parseWalletRegionStepUpChallengeDigest,
  recordWalletRegionDirectoryCutover,
  recordWalletRegionSourceFence,
  recordWalletRegionTargetReceipt,
  requireWalletRegionBoundary,
  type AuthorizedWalletRegionMigration,
  type CutoverCommittedWalletRegionMigration,
  type DirectoryCutoverReceipt,
  type SourceFrozenWalletRegionMigration,
  type SourceMigrationFence,
  type TargetCustodyReceipt,
  type TargetVerifiedWalletRegionMigration,
  type WalletHomeLaneId,
  type WalletRegionMigrationGrant,
} from '../../../packages/shared-ts/src/wallet-region';
import type {
  WalletHomeLaneDirectoryRecord,
  WalletLaneAuthorityState,
} from '../../../packages/wallet-server/src/core/walletRegion';

function fixtureWalletId(value: string): WalletId {
  const parsed = parseWalletId(value);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function fixtureLaneId(value: string): WalletHomeLaneId {
  return requireWalletRegionBoundary(parseWalletHomeLaneId(value), 'fixture lane id');
}

function fixtureDigest(byte: number): DigestB64u {
  return parseDigestB64u(base64UrlEncode(new Uint8Array(32).fill(byte)));
}

function fixtureSignature(byte: number): string {
  return base64UrlEncode(new Uint8Array(64).fill(byte));
}

export function buildAuthorizedWalletRegionMigrationFixture(): AuthorizedWalletRegionMigration {
  const source = buildWalletHomeLane({
    walletId: fixtureWalletId('wallet:region-fixture'),
    laneId: fixtureLaneId('managed-na-v1'),
    laneEpoch: requireWalletRegionBoundary(parseWalletLaneEpoch(1), 'fixture source epoch'),
  });
  const target = buildWalletRegionMigrationTarget(source, fixtureLaneId('managed-eu-v1'));
  const result = authorizeWalletRegionMigration({
    migrationId: requireWalletRegionBoundary(
      parseWalletRegionMigrationId('migration:region-fixture'),
      'fixture migration id',
    ),
    source,
    target,
    grantDigest: requireWalletRegionBoundary(
      parseWalletRegionMigrationGrantDigest(fixtureDigest(1)),
      'fixture grant digest',
    ),
    expiresAt: requireWalletRegionBoundary(parseUnixTimestamp(20_000), 'fixture expiry'),
    now: requireWalletRegionBoundary(parseUnixTimestamp(10_000), 'fixture now'),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function buildGrantedAuthorizedWalletRegionMigrationFixture(
  input: {
    readonly migrationId?: string;
    readonly requestNonceByte?: number;
  } = {},
): Promise<{
  readonly grant: WalletRegionMigrationGrant;
  readonly migration: AuthorizedWalletRegionMigration;
}> {
  const provisional = buildAuthorizedWalletRegionMigrationFixture();
  const target = buildWalletRegionMigrationTarget(provisional.source, provisional.targetLaneId);
  const migrationId = requireWalletRegionBoundary(
    parseWalletRegionMigrationId(input.migrationId ?? provisional.migrationId),
    'fixture granted migration id',
  );
  const ownerAuthorityId = parseWalletAuthorityId('wallet-authority:region-owner');
  const credentialId = parseWebAuthnCredentialIdB64u('credential-region-owner');
  if (!ownerAuthorityId.ok) throw new Error(ownerAuthorityId.error.message);
  if (!credentialId.ok) throw new Error(credentialId.error.message);
  const grant = await createWalletRegionMigrationGrant({
    version: 'wallet_region_migration_grant_v1',
    migrationId,
    walletId: provisional.walletId,
    ownerAuthorityId: ownerAuthorityId.value,
    credentialId: credentialId.value,
    source: provisional.source,
    targetLaneId: provisional.targetLaneId,
    targetEpoch: provisional.targetEpoch,
    policyVersion: requireWalletRegionBoundary(
      parseWalletRegionPolicyVersion('policy:region-v1'),
      'fixture policy version',
    ),
    requestNonceB64u: requireWalletRegionBoundary(
      parseWalletRegionRequestNonceB64u(
        base64UrlEncode(new Uint8Array(32).fill(input.requestNonceByte ?? 10)),
      ),
      'fixture request nonce',
    ),
    stepUpChallengeDigestB64u: requireWalletRegionBoundary(
      parseWalletRegionStepUpChallengeDigest(fixtureDigest(11)),
      'fixture step-up challenge digest',
    ),
    issuedAt: requireWalletRegionBoundary(parseUnixTimestamp(1_000), 'fixture grant issuance'),
    expiresAt: provisional.expiresAt,
  });
  const authorized = authorizeWalletRegionMigration({
    migrationId,
    source: provisional.source,
    target,
    grantDigest: grant.grantDigest,
    expiresAt: grant.expiresAt,
    now: requireWalletRegionBoundary(parseUnixTimestamp(2_000), 'fixture grant use time'),
  });
  if (!authorized.ok) throw new Error(authorized.error.message);
  return { grant, migration: authorized.value };
}

export function buildSourceMigrationFenceFixture(input: {
  readonly migration: AuthorizedWalletRegionMigration;
  readonly custodyKeyManifestDigestB64u?: DigestB64u;
}): SourceMigrationFence {
  return parseSourceMigrationFence({
    version: 'wallet_region_source_fence_v1',
    migrationId: input.migration.migrationId,
    walletId: input.migration.walletId,
    sourceLaneId: input.migration.source.laneId,
    sourceEpoch: input.migration.source.laneEpoch,
    targetLaneId: input.migration.targetLaneId,
    targetEpoch: input.migration.targetEpoch,
    grantDigest: input.migration.grantDigest,
    directoryRevision: 1,
    custodyKeyManifestDigestB64u: input.custodyKeyManifestDigestB64u ?? fixtureDigest(2),
    finalCommandRevision: 8,
    finalReplayRevision: 13,
    finalKeyGeneration: 3,
    finalManifestGeneration: 5,
    frozenAtMs: 11_000,
    receiptSignerKeyId: 'managed-na-v1:fence:v1',
    receiptDigestB64u: fixtureDigest(3),
    receiptSignatureB64u: fixtureSignature(4),
  });
}

export function buildSourceFrozenWalletRegionMigrationFixture(): SourceFrozenWalletRegionMigration {
  const migration = buildAuthorizedWalletRegionMigrationFixture();
  const result = recordWalletRegionSourceFence(
    migration,
    buildSourceMigrationFenceFixture({ migration }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function buildTargetCustodyReceiptFixture(input: {
  readonly migration: SourceFrozenWalletRegionMigration;
  readonly custodyKeyManifestDigestB64u?: DigestB64u;
}): TargetCustodyReceipt {
  return parseTargetCustodyReceipt({
    version: 'wallet_region_target_custody_receipt_v1',
    migrationId: input.migration.migrationId,
    walletId: input.migration.walletId,
    sourceLaneId: input.migration.source.laneId,
    sourceEpoch: input.migration.source.laneEpoch,
    targetLaneId: input.migration.targetLaneId,
    targetEpoch: input.migration.targetEpoch,
    grantDigest: input.migration.grantDigest,
    sourceFenceDigestB64u: input.migration.sourceFence.receiptDigestB64u,
    custodyKeyManifestDigestB64u:
      input.custodyKeyManifestDigestB64u ??
      input.migration.sourceFence.custodyKeyManifestDigestB64u,
    publicKeySetDigestB64u: fixtureDigest(5),
    preparedAtMs: 12_000,
    receiptSignerKeyId: 'managed-eu-v1:custody:v1',
    receiptDigestB64u: fixtureDigest(6),
    receiptSignatureB64u: fixtureSignature(7),
  });
}

export function buildTargetVerifiedWalletRegionMigrationFixture(): TargetVerifiedWalletRegionMigration {
  const migration = buildSourceFrozenWalletRegionMigrationFixture();
  const result = recordWalletRegionTargetReceipt(
    migration,
    buildTargetCustodyReceiptFixture({ migration }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function buildDirectoryCutoverReceiptFixture(input: {
  readonly migration: TargetVerifiedWalletRegionMigration;
  readonly directoryRevision?: number;
}): DirectoryCutoverReceipt {
  return parseDirectoryCutoverReceipt({
    version: 'wallet_region_directory_cutover_receipt_v1',
    migrationId: input.migration.migrationId,
    walletId: input.migration.walletId,
    sourceLaneId: input.migration.source.laneId,
    sourceEpoch: input.migration.source.laneEpoch,
    targetLaneId: input.migration.targetLaneId,
    targetEpoch: input.migration.targetEpoch,
    grantDigest: input.migration.grantDigest,
    sourceFenceDigestB64u: input.migration.sourceFence.receiptDigestB64u,
    targetReceiptDigestB64u: input.migration.targetReceipt.receiptDigestB64u,
    directoryRevision: input.directoryRevision ?? 2,
    committedAtMs: 13_000,
    receiptSignerKeyId: 'wallet-directory:v1',
    receiptDigestB64u: fixtureDigest(8),
    receiptSignatureB64u: fixtureSignature(9),
  });
}

export function buildCutoverCommittedWalletRegionMigrationFixture(): CutoverCommittedWalletRegionMigration {
  const migration = buildTargetVerifiedWalletRegionMigrationFixture();
  const result = recordWalletRegionDirectoryCutover(
    migration,
    buildDirectoryCutoverReceiptFixture({ migration }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function buildFixtureDigest(byte: number): DigestB64u {
  return fixtureDigest(byte);
}

export function buildWalletLaneAdmissionFixture(input: {
  readonly authorityKind: WalletLaneAuthorityState['kind'];
  readonly contextEpoch?: number;
}): {
  readonly context: ReturnType<typeof buildWalletLaneContext>;
  readonly directory: WalletHomeLaneDirectoryRecord;
  readonly authority: WalletLaneAuthorityState;
} {
  const migration = buildAuthorizedWalletRegionMigrationFixture();
  const directoryRevision = requireWalletRegionBoundary(
    parseWalletDirectoryRevision(1),
    'fixture directory revision',
  );
  const directory: WalletHomeLaneDirectoryRecord = {
    homeLane: migration.source,
    directoryRevision,
    migrationId: input.authorityKind === 'active' ? null : migration.migrationId,
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
  };
  const contextHomeLane = buildWalletHomeLane({
    walletId: migration.walletId,
    laneId: migration.source.laneId,
    laneEpoch:
      input.contextEpoch == null
        ? migration.source.laneEpoch
        : requireWalletRegionBoundary(
            parseWalletLaneEpoch(input.contextEpoch),
            'fixture context epoch',
          ),
  });
  const migrationId = migration.migrationId;
  const authority: WalletLaneAuthorityState =
    input.authorityKind === 'active'
      ? {
          kind: 'active',
          homeLane: migration.source,
          directoryRevision,
          migrationId: null,
        }
      : {
          kind: input.authorityKind,
          homeLane: migration.source,
          directoryRevision,
          migrationId,
        };
  return {
    context: buildWalletLaneContext({
      homeLane: contextHomeLane,
      directoryRevision,
    }),
    directory,
    authority,
  };
}
