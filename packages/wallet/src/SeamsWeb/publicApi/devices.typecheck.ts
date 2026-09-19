import type { DeviceLinkingFlowPortsV1 } from '@/SeamsWeb/operations/devices/deviceLinkingPorts';
import type {
  LinkedDeviceManagementPortV1,
  DevicesCapabilityDomainMethods,
} from './devices';
import { createDevicesCapability } from './devices';
import type { DeviceLinkingWebContext } from '@/SeamsWeb/signingSurface/types';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';

declare const linkedDeviceManagement: LinkedDeviceManagementPortV1;
declare const deviceLinkingPorts: DeviceLinkingFlowPortsV1;
declare const getContext: () => DeviceLinkingWebContext;
declare const walletIframe: Pick<
  WalletIframeCoordinator,
  'shouldUseWalletIframe' | 'requireRouter'
>;
const directDomain = {
  kind: 'direct',
  linkedDeviceManagement,
  deviceLinkingPorts,
} satisfies DevicesCapabilityDomainMethods;
void directDomain;

const iframeDomain = {
  kind: 'iframe',
  linkedDeviceManagement,
} satisfies DevicesCapabilityDomainMethods;
void iframeDomain;

// @ts-expect-error direct wallet-host composition cannot omit authenticated ports.
const incompleteDirectDomain: DevicesCapabilityDomainMethods = {
  kind: 'direct',
  linkedDeviceManagement,
};
void incompleteDirectDomain;

createDevicesCapability({
  getContext,
  walletIframe,
  domain: directDomain,
});

createDevicesCapability({
  getContext,
  walletIframe,
  domain: iframeDomain,
});

createDevicesCapability({
  getContext,
  walletIframe,
  domain: directDomain,
  // @ts-expect-error inventory reads cannot own an implicit wallet-unlock path.
  ownerSessionRenewal: { renew: async () => ({ kind: 'renewed' as const }) },
});
