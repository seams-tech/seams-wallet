import type { DevicesCapability } from '@/SeamsWeb/signingSurface/types';
import {
  parseWalletAuthMethodId,
  parseWalletId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import type { LinkedDeviceListResultV1, LinkedDeviceRevokeResultV1 } from '@shared/device-linking';
import {
  parseLinkedDeviceListRequestV1,
  parseLinkedDeviceListResultV1,
  parseLinkedDeviceRevokeResultV1,
} from '@shared/device-linking';

export {
  parseLinkedDeviceListRequestV1,
  parseLinkedDeviceListResultV1,
  parseLinkedDeviceRevokeRequestV1,
  parseLinkedDeviceRevokeResultV1,
  parseLinkedDeviceSummaryV1,
} from '@shared/device-linking';
export type {
  LinkedDeviceListRequestV1,
  LinkedDeviceListResultV1,
  LinkedDeviceManagementRequestV1,
  LinkedDeviceRevokeRequestV1,
  LinkedDeviceRevokeResultV1,
  LinkedDeviceSummaryV1,
} from '@shared/device-linking';

export type LinkedDeviceManagementPortV1 = {
  listLinkedDevices(input: {
    readonly walletId: WalletId;
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<LinkedDeviceListResultV1>;
  revokeLinkedDevice(input: {
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
  }): Promise<LinkedDeviceRevokeResultV1>;
};

export type DeviceCommands = Pick<
  DevicesCapability,
  'startLinking' | 'cancelLinking' | 'approveLinking'
> & { readonly linkedDeviceManagement: LinkedDeviceManagementPortV1 };

export function createDevicesCapability(commands: DeviceCommands): DevicesCapability {
  const devices = new DeviceManagement(commands.linkedDeviceManagement);
  return {
    startLinking: commands.startLinking,
    cancelLinking: commands.cancelLinking,
    approveLinking: commands.approveLinking,
    list: devices.list.bind(devices),
    remove: devices.remove.bind(devices),
  };
}

class DeviceManagement {
  constructor(private readonly management: LinkedDeviceManagementPortV1) {}

  async list(
    args: Parameters<DevicesCapability['list']>[0],
  ): ReturnType<DevicesCapability['list']> {
    const request = parseLinkedDeviceListRequestV1({
      kind: 'linked_device_list_request_v1',
      walletId: parseWalletIdForPublicCall(args.walletId),
      limit: args.limit,
      cursor: args.cursor,
    });
    const result = await this.management.listLinkedDevices({
      walletId: request.walletId,
      limit: request.limit,
      cursor: request.cursor,
    });
    return parseLinkedDeviceListResultV1(result);
  }

  async remove(
    args: Parameters<DevicesCapability['remove']>[0],
  ): ReturnType<DevicesCapability['remove']> {
    const result = await this.management.revokeLinkedDevice({
      walletId: parseWalletIdForPublicCall(args.walletId),
      walletAuthMethodId: parseWalletAuthMethodIdForPublicCall(args.walletAuthMethodId),
    });
    return parseLinkedDeviceRevokeResultV1(result);
  }
}

function parseWalletIdForPublicCall(raw: string): WalletId {
  const result = parseWalletId(raw);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function parseWalletAuthMethodIdForPublicCall(raw: string): WalletAuthMethodId {
  const result = parseWalletAuthMethodId(raw);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
