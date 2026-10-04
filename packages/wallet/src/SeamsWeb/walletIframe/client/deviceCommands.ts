import type { DeviceCommands, LinkedDeviceManagementPortV1 } from '@/SeamsWeb/publicApi/devices';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';

export function createApplicationDeviceCommands(
  walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
): DeviceCommands {
  const commands = new ApplicationDeviceCommands(walletIframe);
  return {
    startDevice2LinkingFlow: commands.startDevice2LinkingFlow.bind(commands),
    cancelDeviceLinking: commands.cancelDeviceLinking.bind(commands),
    scanAndLinkDevice: commands.scanAndLinkDevice.bind(commands),
    linkedDeviceManagement: {
      listLinkedDevices: commands.listLinkedDevices.bind(commands),
      revokeLinkedDevice: commands.revokeLinkedDevice.bind(commands),
    },
  };
}

class ApplicationDeviceCommands {
  constructor(private readonly walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>) {}

  async startDevice2LinkingFlow(
    args: Parameters<DeviceCommands['startDevice2LinkingFlow']>[0],
  ): ReturnType<DeviceCommands['startDevice2LinkingFlow']> {
    const router = await this.walletIframe.requireRouter();
    return await router.startDevice2LinkingFlow(args);
  }

  async cancelDeviceLinking(): Promise<void> {
    const router = await this.walletIframe.requireRouter();
    await router.cancelDeviceLinking();
  }

  async scanAndLinkDevice(
    ...args: Parameters<DeviceCommands['scanAndLinkDevice']>
  ): ReturnType<DeviceCommands['scanAndLinkDevice']> {
    const [qrData, options] = args;
    const router = await this.walletIframe.requireRouter();
    return await router.scanAndLinkDevice({ qrData, options });
  }

  async listLinkedDevices(
    input: Parameters<LinkedDeviceManagementPortV1['listLinkedDevices']>[0],
  ): ReturnType<LinkedDeviceManagementPortV1['listLinkedDevices']> {
    const { walletId, limit, cursor } = input;
    const router = await this.walletIframe.requireRouter(walletId);
    return await router.listLinkedDevices({ walletId: String(walletId), limit, cursor });
  }

  async revokeLinkedDevice(
    input: Parameters<LinkedDeviceManagementPortV1['revokeLinkedDevice']>[0],
  ): ReturnType<LinkedDeviceManagementPortV1['revokeLinkedDevice']> {
    const { walletId, walletAuthMethodId, requestedAtMs, sourceProof } = input;
    const router = await this.walletIframe.requireRouter(walletId);
    return await router.revokeLinkedDevice({
      walletId: String(walletId),
      walletAuthMethodId: String(walletAuthMethodId),
      requestedAtMs,
      sourceProof,
    });
  }
}
