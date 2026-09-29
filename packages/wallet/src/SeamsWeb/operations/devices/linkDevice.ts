// The device-linking entry point: Device 2 QR linking and Device 1 scanning, run here or
// through the wallet iframe's router.
import type { DeviceLinkingWebContext } from '@/SeamsWeb/signingSurface/types';
import type {
  LinkDeviceResult,
  ScanAndLinkDeviceOptionsDevice1,
  StartDevice2LinkingFlowArgs,
  StartDevice2LinkingFlowResults,
} from '@/core/types/linkDevice';
import { assertNeverLinkSessionStateV1 } from '@shared/device-linking';
import type { QrLinkedDeviceSessionPayloadV5 } from '@shared/device-linking';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import {
  scanAndLinkDevice as scanAndLinkDeviceDevice1,
  type Device1OwnerLinkCancellationV1,
} from '@/SeamsWeb/operations/devices/scanDevice';
import type { DeviceLinkingFlowPortsV1 } from './deviceLinkingPorts';
import { LinkDeviceFlow } from './linkDeviceFlow';

type DeviceLinkingDomainDeps =
  | {
      readonly kind: 'iframe';
      readonly getContext: () => DeviceLinkingWebContext;
      readonly walletIframe: Pick<
        WalletIframeCoordinator,
        'shouldUseWalletIframe' | 'requireRouter'
      >;
    }
  | {
      readonly kind: 'direct';
      readonly getContext: () => DeviceLinkingWebContext;
      readonly walletIframe: Pick<
        WalletIframeCoordinator,
        'shouldUseWalletIframe' | 'requireRouter'
      >;
      readonly ports: DeviceLinkingFlowPortsV1;
    };

function isFinishedDeviceLinkFlow(flow: LinkDeviceFlow): boolean {
  const state = flow.getState();
  if (state.cancelled || state.error || !state.session) return true;
  switch (state.session.state.state) {
    case 'active':
    case 'expired':
    case 'cancelled':
    case 'failed_before_commit':
      return true;
    case 'displaying_qr':
    case 'claimed':
    case 'awaiting_target_factor':
    case 'awaiting_source_contribution':
    case 'provisioning':
    case 'authority_pending_local_install':
      return false;
    default:
      return assertNeverLinkSessionStateV1(state.session.state);
  }
}

export class DeviceLinkingDomain {
  private readonly deps: DeviceLinkingDomainDeps;
  private activeDeviceLinkFlow: LinkDeviceFlow | null = null;
  private activeOwnerLinkCancellation: Device1OwnerLinkCancellationV1 | null = null;

  constructor(deps: DeviceLinkingDomainDeps) {
    this.deps = deps;
  }

  async startDevice2LinkingFlow(
    args: StartDevice2LinkingFlowArgs,
  ): Promise<StartDevice2LinkingFlowResults> {
    if (this.deps.kind === 'direct' && !this.deps.walletIframe.shouldUseWalletIframe()) {
      if (this.activeDeviceLinkFlow && isFinishedDeviceLinkFlow(this.activeDeviceLinkFlow)) {
        this.activeDeviceLinkFlow = null;
      }
      if (this.activeDeviceLinkFlow) {
        throw new Error('Device-link QR flow is already running');
      }
      const flow = new LinkDeviceFlow(args, this.deps.ports, this.deps.getContext);
      this.activeDeviceLinkFlow = flow;
      try {
        return await flow.generateQR();
      } catch (error: unknown) {
        if (this.activeDeviceLinkFlow === flow) this.activeDeviceLinkFlow = null;
        throw error;
      }
    }
    const router = await this.deps.walletIframe.requireRouter();
    return await router.startDevice2LinkingFlow(args);
  }

  async cancelDeviceLinking(): Promise<void> {
    if (this.deps.kind === 'direct' && !this.deps.walletIframe.shouldUseWalletIframe()) {
      if (this.activeDeviceLinkFlow && isFinishedDeviceLinkFlow(this.activeDeviceLinkFlow)) {
        this.activeDeviceLinkFlow = null;
      }
      if (this.activeDeviceLinkFlow) {
        await this.activeDeviceLinkFlow.cancel();
        this.activeDeviceLinkFlow = null;
        return;
      }
      const ownerCancellation = this.activeOwnerLinkCancellation;
      if (ownerCancellation) {
        await this.deps.ports.transport.cancelClaimedSessionV1(ownerCancellation);
        if (this.activeOwnerLinkCancellation === ownerCancellation) {
          this.activeOwnerLinkCancellation = null;
        }
      }
      return;
    }
    const router = await this.deps.walletIframe.requireRouter();
    await router.cancelDeviceLinking();
  }

  async scanAndLinkDevice(
    qrData: QrLinkedDeviceSessionPayloadV5,
    options: ScanAndLinkDeviceOptionsDevice1,
  ): Promise<LinkDeviceResult> {
    if (this.deps.kind === 'direct' && !this.deps.walletIframe.shouldUseWalletIframe()) {
      return await scanAndLinkDeviceDevice1(
        this.deps.getContext(),
        qrData,
        options,
        this.deps.ports,
        this.registerOwnerLinkCancellationV1.bind(this),
      );
    }
    const router = await this.deps.walletIframe.requireRouter();
    return await router.scanAndLinkDevice({ qrData, options });
  }

  private registerOwnerLinkCancellationV1(
    cancellation: Device1OwnerLinkCancellationV1 | null,
  ): void {
    this.activeOwnerLinkCancellation = cancellation;
  }
}
