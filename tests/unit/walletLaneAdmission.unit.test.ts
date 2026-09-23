import { expect, test } from '@playwright/test';
import { admitWalletLaneMutation } from '../../packages/wallet-server/src/core/walletRegion';
import { buildWalletLaneAdmissionFixture } from './helpers/walletRegion.fixtures';

test.describe('wallet lane epoch admission', () => {
  test('admits only an active authority matching the directory and trusted context', () => {
    const fixture = buildWalletLaneAdmissionFixture({ authorityKind: 'active' });
    expect(admitWalletLaneMutation(fixture)).toEqual({
      ok: true,
      context: fixture.context,
    });
  });

  test('rejects a stale source-epoch context before consulting diagnostics', () => {
    const fixture = buildWalletLaneAdmissionFixture({
      authorityKind: 'active',
      contextEpoch: 2,
    });
    expect(admitWalletLaneMutation(fixture)).toEqual({
      ok: false,
      code: 'wallet_lane_context_stale',
      message: 'wallet lane context does not match the authoritative directory',
    });
  });

  test('returns the migration fence result after source freeze', () => {
    const fixture = buildWalletLaneAdmissionFixture({ authorityKind: 'source_frozen' });
    expect(admitWalletLaneMutation(fixture)).toEqual({
      ok: false,
      code: 'wallet_region_migration_in_progress',
      message: 'wallet writes are fenced while its Home region is moving',
    });
  });

  test('keeps prepared targets and retired sources unable to accept writes', () => {
    const prepared = buildWalletLaneAdmissionFixture({ authorityKind: 'target_prepared' });
    const retired = buildWalletLaneAdmissionFixture({ authorityKind: 'retired' });

    expect(admitWalletLaneMutation(prepared)).toMatchObject({
      ok: false,
      code: 'wallet_lane_target_not_active',
    });
    expect(admitWalletLaneMutation(retired)).toMatchObject({
      ok: false,
      code: 'wallet_lane_retired',
    });
  });
});
