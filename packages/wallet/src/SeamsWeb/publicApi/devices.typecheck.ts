import type { DeviceLinkingFlowPortsV1 } from '@/SeamsWeb/operations/devices/deviceLinkingPorts';
import type {
  LinkedDeviceManagementPortV1,
  DevicesCapabilityDomainMethods,
  OwnerWalletSessionRenewalResultV1,
} from './devices';

declare const linkedDeviceManagement: LinkedDeviceManagementPortV1;
declare const deviceLinkingPorts: DeviceLinkingFlowPortsV1;
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
