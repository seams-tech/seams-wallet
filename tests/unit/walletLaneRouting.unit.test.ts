import { expect, test } from '@playwright/test';
import { MANAGED_WALLET_LANES } from '../../packages/shared-ts/src/wallet-region';
import {
  buildVerifiedManagedWalletLaneConfiguration,
  resolveManagedWalletLaneRoute,
  walletLaneServiceBindingNameFromString,
  type ManagedWalletLaneCatalogStore,
  type WalletHomeLaneDirectoryRecord,
  type WalletHomeLaneDirectoryStore,
} from '../../packages/wallet-server/src/core/walletRegion';
import { buildWalletLaneAdmissionFixture } from './helpers/walletRegion.fixtures';

function directoryStore(
  record: WalletHomeLaneDirectoryRecord | null,
): Pick<WalletHomeLaneDirectoryStore, 'getHomeLane'> {
  return {
    async getHomeLane(): Promise<WalletHomeLaneDirectoryRecord | null> {
      return record;
    },
  };
}

function catalogStore(
  configuration: Awaited<ReturnType<ManagedWalletLaneCatalogStore['getActiveConfiguration']>>,
): Pick<ManagedWalletLaneCatalogStore, 'getActiveConfiguration'> {
  return {
    async getActiveConfiguration() {
      return configuration;
    },
  };
}

function verifiedNorthAmericaConfiguration() {
  return buildVerifiedManagedWalletLaneConfiguration({
    laneId: MANAGED_WALLET_LANES.north_america.laneId,
    productRegion: 'north_america',
    status: 'available',
    placementEvidence: {
      kind: 'verified',
      recordedAtMs: 1_000,
      observedD1Location: 'ENAM',
      maximumWriteLatencyMs: 40,
    },
    bindings: {
      routerBinding: walletLaneServiceBindingNameFromString('MANAGED_NA_ROUTER'),
      deriverABinding: walletLaneServiceBindingNameFromString('MANAGED_NA_DERIVER_A'),
      deriverBBinding: walletLaneServiceBindingNameFromString('MANAGED_NA_DERIVER_B'),
      signingWorkerBinding: walletLaneServiceBindingNameFromString('MANAGED_NA_SIGNING_WORKER'),
    },
    configurationVersion: 1,
  });
}

test.describe('managed wallet lane routing', () => {
  test('resolves the trusted directory lane to deployment-owned bindings', async () => {
    const fixture = buildWalletLaneAdmissionFixture({ authorityKind: 'active' });
    const configuration = verifiedNorthAmericaConfiguration();

    const resolution = await resolveManagedWalletLaneRoute({
      walletId: fixture.context.walletId,
      directory: directoryStore(fixture.directory),
      catalog: catalogStore(configuration),
    });

    expect(resolution).toMatchObject({
      kind: 'resolved',
      context: {
        laneId: 'managed-na-v1',
        laneEpoch: 1,
        directoryRevision: 1,
      },
      configuration: {
        routerBinding: 'MANAGED_NA_ROUTER',
        status: 'available',
      },
    });
  });

  test('does not route wallets through unavailable or missing lane configuration', async () => {
    const fixture = buildWalletLaneAdmissionFixture({ authorityKind: 'active' });

    await expect(
      resolveManagedWalletLaneRoute({
        walletId: fixture.context.walletId,
        directory: directoryStore(fixture.directory),
        catalog: catalogStore(null),
      }),
    ).resolves.toMatchObject({ kind: 'lane_unavailable' });
  });

  test('returns an explicit unassigned result without consulting client-selected lanes', async () => {
    const fixture = buildWalletLaneAdmissionFixture({ authorityKind: 'active' });

    await expect(
      resolveManagedWalletLaneRoute({
        walletId: fixture.context.walletId,
        directory: directoryStore(null),
        catalog: catalogStore(verifiedNorthAmericaConfiguration()),
      }),
    ).resolves.toEqual({ kind: 'not_assigned', walletId: fixture.context.walletId });
  });
});
