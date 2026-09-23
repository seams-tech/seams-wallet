import { expect, test } from '@playwright/test';
import { buildWalletSessionAuthorizationV2 } from '../../packages/wallet-server/src/authorization/domain';
import {
  MANAGED_WALLET_LANES,
  buildWalletHomeLane,
  buildWalletLaneContext,
  parseWalletDirectoryRevision,
  parseWalletLaneEpoch,
  requireWalletRegionBoundary,
} from '../../packages/shared-ts/src/wallet-region';
import { parseWalletId } from '../../packages/shared-ts/src/utils/domainIds';
import {
  buildLinkedDeviceManagementAuthorityFixture,
  linkedDevicePermissionsForManagementFixture,
} from './helpers/linkedDeviceManagement.fixtures';

test('rejects a Wallet Session lane context for another wallet', async () => {
  const fixture = await buildLinkedDeviceManagementAuthorityFixture({
    label: 'owner',
    permissions: linkedDevicePermissionsForManagementFixture(),
    provenance: 'wallet_registration',
  });
  const otherWalletId = requireWalletRegionBoundary(
    parseWalletId('wallet:other-lane-owner'),
    'other wallet id',
  );
  const laneContext = buildWalletLaneContext({
    homeLane: buildWalletHomeLane({
      walletId: otherWalletId,
      laneId: MANAGED_WALLET_LANES.asia_pacific.laneId,
      laneEpoch: requireWalletRegionBoundary(parseWalletLaneEpoch(1), 'lane epoch'),
    }),
    directoryRevision: requireWalletRegionBoundary(
      parseWalletDirectoryRevision(1),
      'directory revision',
    ),
  });
  const { kind: _kind, ...sessionFields } = fixture.issuedSession.session;

  expect(() =>
    buildWalletSessionAuthorizationV2({
      ...sessionFields,
      laneContext,
    }),
  ).toThrow('Wallet Session lane context must name the authorized wallet');
});
