import { expect, test } from '@playwright/test';
import {
  completeWalletRegionMigration,
  parseManagedWalletHomeLaneId,
  parseWalletLaneEpoch,
  parseWalletRegionMigration,
  parseWalletRegionMigrationTarget,
  recordWalletRegionDirectoryCutover,
  recordWalletRegionTargetReceipt,
  walletRegionMigrationTargetHomeLane,
} from '../../packages/shared-ts/src/wallet-region';
import {
  buildAuthorizedWalletRegionMigrationFixture,
  buildCutoverCommittedWalletRegionMigrationFixture,
  buildDirectoryCutoverReceiptFixture,
  buildFixtureDigest,
  buildSourceFrozenWalletRegionMigrationFixture,
  buildTargetCustodyReceiptFixture,
  buildTargetVerifiedWalletRegionMigrationFixture,
} from './helpers/walletRegion.fixtures';

test.describe('wallet regional home-lane domain', () => {
  test('accepts only the immutable managed lane ids and positive epochs', () => {
    expect(parseManagedWalletHomeLaneId('managed-na-v1')).toEqual({
      ok: true,
      value: 'managed-na-v1',
    });
    expect(parseManagedWalletHomeLaneId('customer-controlled')).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'laneId is not a managed wallet lane' },
    });
    expect(parseWalletLaneEpoch(0)).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'laneEpoch must be a positive safe integer' },
    });
  });

  test('rejects same-lane and non-sequential migration targets at the boundary', () => {
    const migration = buildAuthorizedWalletRegionMigrationFixture();
    expect(() =>
      parseWalletRegionMigrationTarget(
        {
          sourceLaneId: migration.source.laneId,
          targetLaneId: migration.source.laneId,
          targetEpoch: migration.targetEpoch,
        },
        migration.source,
      ),
    ).toThrow('target lane must differ');
    expect(() =>
      parseWalletRegionMigrationTarget(
        {
          sourceLaneId: migration.source.laneId,
          targetLaneId: migration.targetLaneId,
          targetEpoch: 3,
        },
        migration.source,
      ),
    ).toThrow('target epoch must immediately follow');
  });

  test('advances through every receipt-gated stage and round-trips persisted JSON', () => {
    const committed = buildCutoverCommittedWalletRegionMigrationFixture();
    const completed = completeWalletRegionMigration(committed);
    const parsed = parseWalletRegionMigration(JSON.parse(JSON.stringify(completed)));

    expect(parsed.kind).toBe('completed');
    expect(parsed).toMatchObject({
      migrationId: completed.migrationId,
      targetLaneId: 'managed-eu-v1',
      targetEpoch: 2,
    });
    if (parsed.kind !== 'completed') throw new Error('expected completed migration');
    expect(walletRegionMigrationTargetHomeLane(parsed)).toMatchObject({
      walletId: completed.walletId,
      laneId: 'managed-eu-v1',
      laneEpoch: 2,
    });
  });

  test('keeps the source-frozen stage durable when target manifest verification fails', () => {
    const frozen = buildSourceFrozenWalletRegionMigrationFixture();
    const targetReceipt = buildTargetCustodyReceiptFixture({
      migration: frozen,
      custodyKeyManifestDigestB64u: buildFixtureDigest(31),
    });
    const result = recordWalletRegionTargetReceipt(frozen, targetReceipt);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'key_manifest_mismatch',
        message: 'target custody receipt does not reproduce the source key manifest',
      },
    });
    expect(frozen.kind).toBe('source_frozen');
  });

  test('rejects a cutover receipt that fails to advance the directory revision', () => {
    const verified = buildTargetVerifiedWalletRegionMigrationFixture();
    const receipt = buildDirectoryCutoverReceiptFixture({
      migration: verified,
      directoryRevision: 1,
    });
    const result = recordWalletRegionDirectoryCutover(verified, receipt);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'directory_revision_not_advanced',
        message: 'directory cutover receipt must advance the source directory revision',
      },
    });
  });

  test('rejects partial or expanded durable migration records', () => {
    const authorized = buildAuthorizedWalletRegionMigrationFixture();
    const raw = JSON.parse(JSON.stringify(authorized));

    expect(() => parseWalletRegionMigration({ ...raw, unexpected: true })).toThrow(
      'unexpected is not part of walletRegionMigration',
    );
    expect(() => parseWalletRegionMigration({ ...raw, kind: 'source_frozen' })).toThrow(
      'sourceMigrationFence must be an object',
    );
  });
});
