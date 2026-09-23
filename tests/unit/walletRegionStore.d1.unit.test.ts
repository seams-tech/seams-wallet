import { expect, test } from '@playwright/test';
import {
  MANAGED_WALLET_LANES,
  completeWalletRegionMigration,
  recordWalletRegionDirectoryCutover,
  recordWalletRegionSourceFence,
  recordWalletRegionTargetReceipt,
} from '../../packages/shared-ts/src/wallet-region';
import {
  buildVerifiedManagedWalletLaneConfiguration,
  walletLaneServiceBindingNameFromString,
} from '../../packages/wallet-server/src/core/walletRegion';
import { createCloudflareD1WalletRegionStore } from '../../packages/wallet-server/src/router/cloudflare/d1/walletRegion';
import { cleanupTemporaryD1Database, createTemporaryD1Database } from './helpers/sqliteD1.fixtures';
import {
  buildDirectoryCutoverReceiptFixture,
  buildGrantedAuthorizedWalletRegionMigrationFixture,
  buildSourceMigrationFenceFixture,
  buildTargetCustodyReceiptFixture,
} from './helpers/walletRegion.fixtures';

const temporaryDirectories: string[] = [];

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    cleanupTemporaryD1Database(directory);
  }
});

test.describe('Cloudflare D1 wallet region store', () => {
  test('activates only immutable, placement-verified lane configurations', async () => {
    const temporary = createTemporaryD1Database();
    temporaryDirectories.push(temporary.tempDir);
    const store = createCloudflareD1WalletRegionStore({
      database: temporary.database,
      now: () => 1_000,
    });
    const europe = buildVerifiedManagedWalletLaneConfiguration({
      laneId: MANAGED_WALLET_LANES.europe.laneId,
      productRegion: 'europe',
      status: 'available',
      placementEvidence: {
        kind: 'verified',
        recordedAtMs: 900,
        observedD1Location: 'WEUR',
        maximumWriteLatencyMs: 45,
      },
      bindings: {
        routerBinding: walletLaneServiceBindingNameFromString('MANAGED_EU_ROUTER'),
        deriverABinding: walletLaneServiceBindingNameFromString('MANAGED_EU_DERIVER_A'),
        deriverBBinding: walletLaneServiceBindingNameFromString('MANAGED_EU_DERIVER_B'),
        signingWorkerBinding: walletLaneServiceBindingNameFromString('MANAGED_EU_SIGNING_WORKER'),
      },
      configurationVersion: 1,
    });

    await expect(store.putConfiguration(europe)).resolves.toMatchObject({ outcome: 'applied' });
    await expect(store.putConfiguration(europe)).resolves.toMatchObject({ outcome: 'replayed' });
    await expect(
      store.activateConfiguration({
        laneId: europe.laneId,
        configurationVersion: 1,
        expectedConfigurationVersion: null,
      }),
    ).resolves.toMatchObject({ outcome: 'applied' });
    await expect(store.listActiveConfigurations({ status: 'available' })).resolves.toEqual([
      europe,
    ]);
  });

  test('persists the exact migration stages and atomically cuts over one directory epoch', async () => {
    const temporary = createTemporaryD1Database();
    temporaryDirectories.push(temporary.tempDir);
    const store = createCloudflareD1WalletRegionStore({
      database: temporary.database,
      now: () => 1_000,
    });
    const granted = await buildGrantedAuthorizedWalletRegionMigrationFixture();
    const authorized = granted.migration;

    await expect(
      store.assignInitialHomeLane({ homeLane: authorized.source, nowMs: 1_000 }),
    ).resolves.toMatchObject({ outcome: 'applied' });
    await expect(
      store.issueMigrationGrant({ grant: granted.grant, nowMs: 1_500 }),
    ).resolves.toMatchObject({ kind: 'issued' });
    const begun = await store.beginMigration({
      migration: authorized,
      grant: granted.grant,
      nowMs: 2_000,
    });
    expect(begun.outcome).toBe('applied');
    if (begun.outcome === 'conflict') throw new Error('migration authorization conflicted');
    await expect(store.getMigrationGrant(granted.grant.grantDigest)).resolves.toMatchObject({
      kind: 'consumed',
      consumedAtMs: 2_000,
    });

    const frozenResult = recordWalletRegionSourceFence(
      authorized,
      buildSourceMigrationFenceFixture({ migration: authorized }),
    );
    if (!frozenResult.ok) throw new Error(frozenResult.error.message);
    const frozen = await store.compareAndSetMigration({
      expected: begun.value,
      next: frozenResult.value,
      nowMs: 3_000,
    });
    expect(frozen.outcome).toBe('applied');
    if (frozen.outcome === 'conflict') throw new Error('source freeze conflicted');

    await expect(
      store.compareAndSetMigration({
        expected: begun.value,
        next: frozenResult.value,
        nowMs: 3_001,
      }),
    ).resolves.toMatchObject({ outcome: 'replayed' });

    const targetResult = recordWalletRegionTargetReceipt(
      frozenResult.value,
      buildTargetCustodyReceiptFixture({ migration: frozenResult.value }),
    );
    if (!targetResult.ok) throw new Error(targetResult.error.message);
    const target = await store.compareAndSetMigration({
      expected: frozen.value,
      next: targetResult.value,
      nowMs: 4_000,
    });
    expect(target.outcome).toBe('applied');
    if (target.outcome === 'conflict') throw new Error('target verification conflicted');

    const cutoverResult = recordWalletRegionDirectoryCutover(
      targetResult.value,
      buildDirectoryCutoverReceiptFixture({ migration: targetResult.value }),
    );
    if (!cutoverResult.ok) throw new Error(cutoverResult.error.message);
    const cutover = await store.commitCutover({
      expected: target.value,
      next: cutoverResult.value,
      nowMs: 5_000,
    });
    expect(cutover.outcome).toBe('applied');
    if (cutover.outcome === 'conflict') throw new Error('directory cutover conflicted');

    await expect(store.getHomeLane(authorized.walletId)).resolves.toMatchObject({
      homeLane: { laneId: 'managed-eu-v1', laneEpoch: 2 },
      directoryRevision: 2,
      migrationId: authorized.migrationId,
    });

    const completedMigration = completeWalletRegionMigration(cutoverResult.value);
    await expect(
      store.completeMigration({
        expected: cutover.value,
        next: completedMigration,
        nowMs: 6_000,
      }),
    ).resolves.toMatchObject({
      outcome: 'applied',
      value: { migration: { kind: 'completed' }, recordRevision: 5 },
    });
    await expect(store.getHomeLane(authorized.walletId)).resolves.toMatchObject({
      homeLane: { laneId: 'managed-eu-v1', laneEpoch: 2 },
      directoryRevision: 2,
      migrationId: null,
    });
  });

  test('leaves a conflicting migration grant unconsumed', async () => {
    const temporary = createTemporaryD1Database();
    temporaryDirectories.push(temporary.tempDir);
    const store = createCloudflareD1WalletRegionStore({
      database: temporary.database,
      now: () => 1_000,
    });
    const first = await buildGrantedAuthorizedWalletRegionMigrationFixture();
    const conflicting = await buildGrantedAuthorizedWalletRegionMigrationFixture({
      migrationId: 'migration:region-conflict',
      requestNonceByte: 12,
    });

    await store.assignInitialHomeLane({ homeLane: first.migration.source, nowMs: 1_000 });
    await store.issueMigrationGrant({ grant: first.grant, nowMs: 1_500 });
    await store.issueMigrationGrant({ grant: conflicting.grant, nowMs: 1_500 });
    await expect(
      store.beginMigration({ migration: first.migration, grant: first.grant, nowMs: 2_000 }),
    ).resolves.toMatchObject({ outcome: 'applied' });

    await expect(
      store.beginMigration({
        migration: conflicting.migration,
        grant: conflicting.grant,
        nowMs: 2_100,
      }),
    ).resolves.toMatchObject({ outcome: 'conflict' });
    await expect(store.getMigrationGrant(conflicting.grant.grantDigest)).resolves.toMatchObject({
      kind: 'issued',
    });
  });

  test('rejects directory epoch jumps and skipped journal stages at the SQL boundary', async () => {
    const temporary = createTemporaryD1Database();
    temporaryDirectories.push(temporary.tempDir);
    const store = createCloudflareD1WalletRegionStore({ database: temporary.database });
    const granted = await buildGrantedAuthorizedWalletRegionMigrationFixture();

    await store.assignInitialHomeLane({ homeLane: granted.migration.source, nowMs: 1_000 });
    await expect(
      temporary.database
        .prepare(
          `UPDATE wallet_home_lanes
              SET lane_epoch = 9, directory_revision = 9, updated_at_ms = 2000
            WHERE wallet_id = ?1`,
        )
        .bind(String(granted.migration.walletId))
        .run(),
    ).rejects.toThrow('wallet Home lane update violates the migration lifecycle');

    await store.issueMigrationGrant({ grant: granted.grant, nowMs: 1_500 });
    await store.beginMigration({
      migration: granted.migration,
      grant: granted.grant,
      nowMs: 2_000,
    });
    await expect(
      temporary.database
        .prepare(
          `UPDATE wallet_region_migrations
              SET state_kind = 'completed', record_revision = record_revision + 1,
                  updated_at_ms = 3000
            WHERE migration_id = ?1`,
        )
        .bind(String(granted.migration.migrationId))
        .run(),
    ).rejects.toThrow('wallet region migration transition is invalid');
  });
});
