import { expect, test } from '@playwright/test';
import { parseWalletSessionAuthorizationV2 } from '../../packages/wallet-server/src/authorization/domain';
import { parsePersistedWalletSessionAuthorizationV2 } from '../../packages/wallet-server/src/router/cloudflare/d1/authorization/persistedWalletSessionAuthorization';
import {
  buildLinkedDeviceManagementAuthorityFixture,
  fullOwnerPermissionsForManagementFixture,
} from './helpers/linkedDeviceManagement.fixtures';

test('D1 reads Wallet Sessions written by the retired geographic-lane migration', async () => {
  const fixture = await buildLinkedDeviceManagementAuthorityFixture({
    label: 'legacy-lane-context',
    permissions: fullOwnerPermissionsForManagementFixture(),
    provenance: 'wallet_registration',
  });
  const persistedRecord = JSON.parse(
    JSON.stringify(fixture.issuedSession.session),
  ) as Record<string, unknown>;
  persistedRecord.laneContext = {
    walletId: fixture.issuedSession.session.walletId,
    laneId: 'managed-apac-v1',
    laneEpoch: 1,
    directoryRevision: 1,
  };

  expect(() => parseWalletSessionAuthorizationV2(persistedRecord)).toThrow(
    'contains unexpected fields',
  );
  expect(parsePersistedWalletSessionAuthorizationV2(persistedRecord)).toEqual(
    fixture.issuedSession.session,
  );
});
