import { expect, test } from '@playwright/test';
import {
  parseWalletRegionMigrationGrant,
  walletRegionMigrationGrantDigestIsValid,
} from '../../packages/shared-ts/src/wallet-region';
import { buildGrantedAuthorizedWalletRegionMigrationFixture } from './helpers/walletRegion.fixtures';

test.describe('wallet region migration grant', () => {
  test('binds one owner credential to one exact source, target, epoch, policy, and expiry', async () => {
    const fixture = await buildGrantedAuthorizedWalletRegionMigrationFixture();
    const persisted = parseWalletRegionMigrationGrant(JSON.parse(JSON.stringify(fixture.grant)));

    expect(await walletRegionMigrationGrantDigestIsValid(persisted)).toBe(true);
    expect(persisted).toMatchObject({
      migrationId: fixture.migration.migrationId,
      walletId: fixture.migration.walletId,
      source: {
        laneId: fixture.migration.source.laneId,
        laneEpoch: fixture.migration.source.laneEpoch,
      },
      targetLaneId: fixture.migration.targetLaneId,
      targetEpoch: fixture.migration.targetEpoch,
      policyVersion: 'policy:region-v1',
    });
  });

  test('detects a grant whose operation-bound policy was changed after issuance', async () => {
    const fixture = await buildGrantedAuthorizedWalletRegionMigrationFixture();
    const tampered = parseWalletRegionMigrationGrant({
      ...JSON.parse(JSON.stringify(fixture.grant)),
      policyVersion: 'policy:region-v2',
    });

    expect(await walletRegionMigrationGrantDigestIsValid(tampered)).toBe(false);
  });
});
