import type { DeviceLinkingFlowPortsV1 } from '@/SeamsWeb/operations/devices/deviceLinkingPorts';
import type {
  LinkedDeviceManagementPortV1,
  DevicesCapabilityDomainMethods,
  OwnerWalletSessionRenewalPortV1,
  OwnerWalletSessionRenewalResultV1,
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
declare const ownerSessionRenewal: OwnerWalletSessionRenewalPortV1;
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

const renewedOwnerSession = {
  kind: 'renewed',
} satisfies OwnerWalletSessionRenewalResultV1;
void renewedOwnerSession;

const invalidOwnerSessionRenewal: OwnerWalletSessionRenewalResultV1 = {
  kind: 'renewed',
  // @ts-expect-error renewed sessions cannot carry a failure.
  error: 'invalid state',
};
void invalidOwnerSessionRenewal;

createDevicesCapability({
  getContext,
  walletIframe,
  domain: directDomain,
  ownerSessionRenewal,
});

createDevicesCapability({
  getContext,
  walletIframe,
  domain: iframeDomain,
});

// @ts-expect-error The application-side iframe branch cannot own Wallet Session renewal.
createDevicesCapability({
  getContext,
  walletIframe,
  domain: iframeDomain,
  ownerSessionRenewal,
});

// @ts-expect-error The direct wallet-host branch must own Wallet Session renewal.
createDevicesCapability({
  getContext,
  walletIframe,
  domain: directDomain,
});
