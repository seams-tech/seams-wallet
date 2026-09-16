import { expect, test } from '@playwright/test';
import {
  parseLinkedDeviceListResultV1,
  parseLinkedDeviceRevokeResultV1,
} from '@shared/device-linking';
import { parseWalletId } from '@shared/utils/domainIds';
import {
  listLinkedDevicesWithOwnerSessionRenewalV1,
  type LinkedDeviceManagementPortV1,
} from '@/SeamsWeb/publicApi/devices';
import { OWNER_WALLET_SESSION_REAUTH_REQUIRED } from '@/SeamsWeb/operations/devices/walletHostComposition';
import { DeviceLinkingErrorCode } from '@/core/types/linkDevice';

function walletId() {
  const parsed = parseWalletId('owner-session-renewal-wallet');
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

test('linked-device inventory keeps an active owner session without renewal', async () => {
  let listCalls = 0;
  let renewalCalls = 0;
  const expected = parseLinkedDeviceListResultV1({
    devices: [],
    ownerDevices: [],
    nextCursor: null,
  });
  const management: LinkedDeviceManagementPortV1 = {
    listLinkedDevices: async () => {
      listCalls += 1;
      return expected;
    },
    revokeLinkedDevice: async () => parseLinkedDeviceRevokeResultV1({ kind: 'unauthorized' }),
  };

  const result = await listLinkedDevicesWithOwnerSessionRenewalV1(
    management,
    {
      renew: async () => {
        renewalCalls += 1;
        return { kind: 'renewed' };
      },
    },
    { walletId: walletId(), limit: 50, cursor: null },
  );

  expect(result).toEqual(expected);
  expect(listCalls).toBe(1);
  expect(renewalCalls).toBe(0);
});

test('linked-device inventory renews a rejected owner session once and retries', async () => {
  let listCalls = 0;
  let renewalCalls = 0;
  const expected = parseLinkedDeviceListResultV1({
    devices: [],
    ownerDevices: [],
    nextCursor: null,
  });
  const management: LinkedDeviceManagementPortV1 = {
    listLinkedDevices: async () => {
      listCalls += 1;
      if (listCalls === 1) {
        const error = new Error('The owner Wallet Session must be renewed');
        Reflect.set(error, 'code', OWNER_WALLET_SESSION_REAUTH_REQUIRED);
        throw error;
      }
      return expected;
    },
    revokeLinkedDevice: async () => parseLinkedDeviceRevokeResultV1({ kind: 'unauthorized' }),
  };

  const result = await listLinkedDevicesWithOwnerSessionRenewalV1(
    management,
    {
      renew: async () => {
        renewalCalls += 1;
        return { kind: 'renewed' };
      },
    },
    { walletId: walletId(), limit: 50, cursor: null },
  );

  expect(result).toEqual(expected);
  expect(listCalls).toBe(2);
  expect(renewalCalls).toBe(1);
});

test('linked-device inventory renews after wallet-host preflight rejects a locked session', async () => {
  let listCalls = 0;
  let renewalCalls = 0;
  const expected = parseLinkedDeviceListResultV1({
    devices: [],
    ownerDevices: [],
    nextCursor: null,
  });
  const management: LinkedDeviceManagementPortV1 = {
    listLinkedDevices: async () => {
      listCalls += 1;
      if (listCalls === 1) {
        const error = new Error('wallet_unlock_required');
        Reflect.set(error, 'code', DeviceLinkingErrorCode.WALLET_UNLOCK_REQUIRED);
        throw error;
      }
      return expected;
    },
    revokeLinkedDevice: async () => parseLinkedDeviceRevokeResultV1({ kind: 'unauthorized' }),
  };

  const result = await listLinkedDevicesWithOwnerSessionRenewalV1(
    management,
    {
      renew: async () => {
        renewalCalls += 1;
        return { kind: 'renewed' };
      },
    },
    { walletId: walletId(), limit: 50, cursor: null },
  );

  expect(result).toEqual(expected);
  expect(listCalls).toBe(2);
  expect(renewalCalls).toBe(1);
});
