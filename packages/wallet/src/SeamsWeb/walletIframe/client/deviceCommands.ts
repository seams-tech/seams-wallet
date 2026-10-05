import type { DeviceCommands, LinkedDeviceManagementPortV1 } from '@/SeamsWeb/publicApi/devices';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';

export function createApplicationDeviceCommands(
  walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
): DeviceCommands {
  const commands = new ApplicationDeviceCommands(walletIframe);
  return {
    startLinking: commands.startLinking.bind(commands),
    cancelLinking: commands.cancelLinking.bind(commands),
    approveLinking: commands.approveLinking.bind(commands),
    linkedDeviceManagement: {
      listLinkedDevices: commands.listLinkedDevices.bind(commands),
      revokeLinkedDevice: commands.revokeLinkedDevice.bind(commands),
    },
  };
}

class ApplicationDeviceCommands {
  constructor(private readonly walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>) {}

  async startLinking(
    args: Parameters<DeviceCommands['startLinking']>[0],
  ): ReturnType<DeviceCommands['startLinking']> {
    const router = await this.walletIframe.requireRouter();
    return await router.startDevice2LinkingFlow(args);
  }

  async cancelLinking(): Promise<void> {
    const router = await this.walletIframe.requireRouter();
    await router.cancelDeviceLinking();
  }

  async approveLinking(
    ...args: Parameters<DeviceCommands['approveLinking']>
  ): ReturnType<DeviceCommands['approveLinking']> {
    const [qrData, options] = args;
    const router = await this.walletIframe.requireRouter();
    return await router.scanAndLinkDevice({ qrData, options });
  }

  async listLinkedDevices(
    input: Parameters<LinkedDeviceManagementPortV1['listLinkedDevices']>[0],
  ): ReturnType<LinkedDeviceManagementPortV1['listLinkedDevices']> {
    const { walletId, limit, cursor } = input;
    const router = await this.walletIframe.requireRouter();
    return await router.listLinkedDevices({ walletId: String(walletId), limit, cursor });
  }

  async revokeLinkedDevice(
    input: Parameters<LinkedDeviceManagementPortV1['revokeLinkedDevice']>[0],
  ): ReturnType<LinkedDeviceManagementPortV1['revokeLinkedDevice']> {
    const { walletId, walletAuthMethodId, requestedAtMs, sourceProof } = input;
    const router = await this.walletIframe.requireRouter();
    return await router.revokeLinkedDevice({
      walletId: String(walletId),
      walletAuthMethodId: String(walletAuthMethodId),
      requestedAtMs,
      sourceProof,
    });
  }
}
