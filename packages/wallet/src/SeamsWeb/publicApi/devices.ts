import type { DevicesCapability } from '@/SeamsWeb/signingSurface/types';
import {
  parseWalletAuthMethodId,
  parseWalletId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import type { LinkedDeviceListResultV1, LinkedDeviceRevokeResultV1 } from '@shared/device-linking';
import type { WalletAuthMethodRevocationProof } from '@shared/utils/walletAuthMethodRecord';
import {
  parseLinkedDeviceListRequestV1,
  parseLinkedDeviceListResultV1,
  parseLinkedDeviceRevokeRequestV1,
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
    readonly requestedAtMs: number;
    readonly sourceProof: WalletAuthMethodRevocationProof;
  }): Promise<LinkedDeviceRevokeResultV1>;
};

export type DeviceCommands = Pick<
  DevicesCapability,
  'startDevice2LinkingFlow' | 'cancelDeviceLinking' | 'scanAndLinkDevice'
> & { readonly linkedDeviceManagement: LinkedDeviceManagementPortV1 };

export function createDevicesCapability(commands: DeviceCommands): DevicesCapability {
  const devices = new DeviceManagement(commands.linkedDeviceManagement);
  return {
    startDevice2LinkingFlow: commands.startDevice2LinkingFlow,
    cancelDeviceLinking: commands.cancelDeviceLinking,
    scanAndLinkDevice: commands.scanAndLinkDevice,
    listLinkedDevices: devices.listLinkedDevices.bind(devices),
    revokeLinkedDevice: devices.revokeLinkedDevice.bind(devices),
  };
}

class DeviceManagement {
  constructor(private readonly management: LinkedDeviceManagementPortV1) {}

  async listLinkedDevices(
    args: Parameters<DevicesCapability['listLinkedDevices']>[0],
  ): ReturnType<DevicesCapability['listLinkedDevices']> {
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

  async revokeLinkedDevice(
    args: Parameters<DevicesCapability['revokeLinkedDevice']>[0],
  ): ReturnType<DevicesCapability['revokeLinkedDevice']> {
    const request = parseLinkedDeviceRevokeRequestV1({
      kind: 'linked_device_revoke_request_v1',
      walletId: parseWalletIdForPublicCall(args.walletId),
      walletAuthMethodId: parseWalletAuthMethodIdForPublicCall(args.walletAuthMethodId),
      requestedAtMs: args.requestedAtMs,
    });
    const result = await this.management.revokeLinkedDevice({
      walletId: request.walletId,
      walletAuthMethodId: request.walletAuthMethodId,
      requestedAtMs: request.requestedAtMs,
      sourceProof: args.sourceProof,
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
