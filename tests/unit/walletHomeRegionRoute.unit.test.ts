import { expect, test } from '@playwright/test';
import { MANAGED_WALLET_LANES } from '../../packages/shared-ts/src/wallet-region';
import {
  buildVerifiedManagedWalletLaneConfiguration,
  WalletHomeLaneAssignmentService,
  walletLaneServiceBindingNameFromString,
} from '../../packages/wallet-server/src/core/walletRegion';
import { createCloudflareD1WalletRegionStore } from '../../packages/wallet-server/src/router/cloudflare/d1/walletRegion';
import { createWalletHomeRegionRouteExtension } from '../../packages/wallet-server/src/router/cloudflare/runtime/walletHomeRegion';
import { coerceRouterLogger } from '../../packages/wallet-server/src/router/framework/logger';
import type { SessionAdapter } from '../../packages/wallet-server/src/router/framework/routerApi';
import { cleanupTemporaryD1Database, createTemporaryD1Database } from './helpers/sqliteD1.fixtures';
import { buildWalletLaneAdmissionFixture } from './helpers/walletRegion.fixtures';

const temporaryDirectories: string[] = [];

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    cleanupTemporaryD1Database(directory);
  }
});

function sessionAdapter(walletId: string): SessionAdapter {
  return {
    async signJwt() {
      return 'unused';
    },
    async verifyJwt() {
      return { valid: true, payload: { account_id: walletId } };
    },
    async parse() {
      return { ok: true, claims: { account_id: walletId } };
    },
    buildSetCookie() {
      return 'unused';
    },
    buildClearCookie() {
      return 'unused';
    },
    async refresh() {
      return { ok: false };
    },
  };
}

async function homeRegionRouteFixture(sessionWalletId?: string) {
  const temporary = createTemporaryD1Database();
  temporaryDirectories.push(temporary.tempDir);
  const store = createCloudflareD1WalletRegionStore({
    database: temporary.database,
    now: () => 1_000,
  });
  const lane = buildVerifiedManagedWalletLaneConfiguration({
    laneId: MANAGED_WALLET_LANES.asia_pacific.laneId,
    productRegion: 'asia_pacific',
    status: 'available',
    placementEvidence: {
      kind: 'verified',
      recordedAtMs: 900,
      observedD1Location: 'APAC',
      maximumWriteLatencyMs: 35,
    },
    bindings: {
      routerBinding: walletLaneServiceBindingNameFromString('MANAGED_APAC_ROUTER'),
      deriverABinding: walletLaneServiceBindingNameFromString('MANAGED_APAC_DERIVER_A'),
      deriverBBinding: walletLaneServiceBindingNameFromString('MANAGED_APAC_DERIVER_B'),
      signingWorkerBinding: walletLaneServiceBindingNameFromString('MANAGED_APAC_SIGNING_WORKER'),
    },
    configurationVersion: 1,
  });
  await store.putConfiguration(lane);
  await store.activateConfiguration({
    laneId: lane.laneId,
    configurationVersion: lane.configurationVersion,
    expectedConfigurationVersion: null,
  });
  const fixture = buildWalletLaneAdmissionFixture({ authorityKind: 'active' });
  const assignments = new WalletHomeLaneAssignmentService({
    directory: store,
    laneCatalog: store,
    defaultHomeLaneId: lane.laneId,
    now: () => 2_000,
  });
  const extension = createWalletHomeRegionRouteExtension({
    session: sessionAdapter(sessionWalletId ?? String(fixture.context.walletId)),
    assignments,
    catalog: store,
  });
  return { extension, walletId: fixture.context.walletId };
}

test.describe('Wallet Home region route', () => {
  test('returns the durable Home lane without exposing internal bindings', async () => {
    const fixture = await homeRegionRouteFixture();
    const pathname = `/wallets/${fixture.walletId}/home-region`;
    const response = await fixture.extension.handleFetchRoute({
      request: new Request(`https://wallet.example${pathname}`),
      route: fixture.extension.routes[0],
      pathname,
      method: 'GET',
      logger: coerceRouterLogger(),
      runtime: { kind: 'inline' },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      homeRegion: {
        kind: 'wallet_home_region_snapshot_v1',
        directoryRevision: 1,
        snapshot: {
          walletId: fixture.walletId,
          current: { laneId: 'managed-apac-v1', laneEpoch: 1 },
          currentRegion: 'asia_pacific',
          currentLaneStatus: 'available',
          policy: { kind: 'owner_moves_disabled' },
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain('MANAGED_APAC_ROUTER');
  });

  test('rejects a Wallet Session bound to another wallet', async () => {
    const fixture = await homeRegionRouteFixture('wallet_other');
    const pathname = `/wallets/${fixture.walletId}/home-region`;
    const response = await fixture.extension.handleFetchRoute({
      request: new Request(`https://wallet.example${pathname}`),
      route: fixture.extension.routes[0],
      pathname,
      method: 'GET',
      logger: coerceRouterLogger(),
      runtime: { kind: 'inline' },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'forbidden' });
  });
});
