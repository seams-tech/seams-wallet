import { DeviceLinkingDomain } from '@/SeamsWeb/operations/devices/linkDevice';
import type { DeviceLinkingFlowPortsV1 } from '@/SeamsWeb/operations/devices/deviceLinkingPorts';
import type { DeviceLinkingWebContext, DevicesCapability } from '@/SeamsWeb/signingSurface/types';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import {
  parseWalletAuthMethodId,
  parseWalletId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import type { LinkedDeviceListResultV1, LinkedDeviceRevokeResultV1 } from '@shared/device-linking';
import type { WalletAuthMethodRevocationProof } from '@shared/utils/registrationIntent';
import {
  parseLinkedDeviceListRequestV1,
  parseLinkedDeviceListResultV1,
  parseLinkedDeviceRevokeRequestV1,
  parseLinkedDeviceRevokeResultV1,
} from '@shared/device-linking';
import { OWNER_WALLET_SESSION_REAUTH_REQUIRED } from '@/SeamsWeb/operations/devices/walletHostComposition';
import { DeviceLinkingErrorCode } from '@/core/types/linkDevice';

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

export type DevicesCapabilityDomainMethods =
  | {
      readonly kind: 'iframe';
      readonly linkedDeviceManagement: LinkedDeviceManagementPortV1;
    }
  | {
      readonly kind: 'direct';
      readonly linkedDeviceManagement: LinkedDeviceManagementPortV1;
      readonly deviceLinkingPorts: DeviceLinkingFlowPortsV1;
    };

export type OwnerWalletSessionRenewalResultV1 =
  | { readonly kind: 'renewed' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly error: string };

export type OwnerWalletSessionRenewalPortV1 = {
  renew(walletId: WalletId): Promise<OwnerWalletSessionRenewalResultV1>;
};

type DevicesCapabilityDependencies = {
  readonly getContext: () => DeviceLinkingWebContext;
  readonly walletIframe: Pick<WalletIframeCoordinator, 'shouldUseWalletIframe' | 'requireRouter'>;
} &
  (
    | {
        readonly domain: Extract<DevicesCapabilityDomainMethods, { readonly kind: 'iframe' }>;
        readonly ownerSessionRenewal?: never;
      }
    | {
        readonly domain: Extract<DevicesCapabilityDomainMethods, { readonly kind: 'direct' }>;
        readonly ownerSessionRenewal: OwnerWalletSessionRenewalPortV1;
      }
  );

export const OWNER_WALLET_SESSION_REAUTH_CANCELLED =
  'owner_wallet_session_reauth_cancelled' as const;

class OwnerWalletSessionReauthCancelledError extends Error {
  readonly code = OWNER_WALLET_SESSION_REAUTH_CANCELLED;

  constructor() {
    super('Wallet unlock was cancelled');
    this.name = 'OwnerWalletSessionReauthCancelledError';
  }
}

function errorCode(error: unknown): string {
  if (error === null || typeof error !== 'object' || !('code' in error)) return '';
  return String(error.code || '').trim();
}

function ownerWalletSessionRenewalRequired(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code === OWNER_WALLET_SESSION_REAUTH_REQUIRED ||
    code === DeviceLinkingErrorCode.WALLET_UNLOCK_REQUIRED
  );
}

export async function listLinkedDevicesWithOwnerSessionRenewalV1(
  management: LinkedDeviceManagementPortV1,
  renewal: OwnerWalletSessionRenewalPortV1,
  request: Parameters<LinkedDeviceManagementPortV1['listLinkedDevices']>[0],
): Promise<LinkedDeviceListResultV1> {
  try {
    return await management.listLinkedDevices(request);
  } catch (error: unknown) {
    if (!ownerWalletSessionRenewalRequired(error)) throw error;
  }

  const renewed = await renewal.renew(request.walletId);
  switch (renewed.kind) {
    case 'renewed':
      return await management.listLinkedDevices(request);
    case 'cancelled':
      throw new OwnerWalletSessionReauthCancelledError();
    case 'failed':
      throw new Error(`Wallet unlock failed: ${renewed.error}`);
    default:
      renewed satisfies never;
      throw new Error('Unsupported owner Wallet Session renewal result');
  }
}

export function createWalletIframeLinkedDeviceManagementPortV1(deps: {
  readonly walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>;
}): LinkedDeviceManagementPortV1 {
  return {
    listLinkedDevices: async ({ walletId, limit, cursor }) => {
      const router = await deps.walletIframe.requireRouter(walletId);
      return await router.listLinkedDevices({ walletId: String(walletId), limit, cursor });
    },
    revokeLinkedDevice: async ({ walletId, walletAuthMethodId, requestedAtMs, sourceProof }) => {
      const router = await deps.walletIframe.requireRouter(walletId);
      return await router.revokeLinkedDevice({
        walletId: String(walletId),
        walletAuthMethodId: String(walletAuthMethodId),
        requestedAtMs,
        sourceProof,
      });
    },
  };
}

export function createDevicesCapability(deps: DevicesCapabilityDependencies): DevicesCapability {
  const deviceLinking =
    deps.domain.kind === 'direct'
      ? new DeviceLinkingDomain({
          kind: 'direct',
          getContext: deps.getContext,
          walletIframe: deps.walletIframe,
          ports: deps.domain.deviceLinkingPorts,
        })
      : new DeviceLinkingDomain({
          kind: 'iframe',
          getContext: deps.getContext,
          walletIframe: deps.walletIframe,
        });
  return {
    startDevice2LinkingFlow: async (args) => await deviceLinking.startDevice2LinkingFlow(args),
    cancelDeviceLinking: async () => await deviceLinking.cancelDeviceLinking(),
    scanAndLinkDevice: async (qrData, options) =>
      await deviceLinking.scanAndLinkDevice(qrData, options),
    listLinkedDevices: async (args) => {
      const request = parseLinkedDeviceListRequestV1({
        kind: 'linked_device_list_request_v1',
        walletId: parseWalletIdForPublicCall(args.walletId),
        limit: args.limit,
        cursor: args.cursor,
      });
      const managementRequest = {
        walletId: request.walletId,
        limit: request.limit,
        cursor: request.cursor,
      };
      let result: LinkedDeviceListResultV1;
      if (deps.domain.kind === 'direct') {
        const renewal = deps.ownerSessionRenewal;
        if (!renewal) throw new Error('Direct device inventory requires owner-session renewal');
        result = await listLinkedDevicesWithOwnerSessionRenewalV1(
          deps.domain.linkedDeviceManagement,
          renewal,
          managementRequest,
        );
      } else {
        result = await deps.domain.linkedDeviceManagement.listLinkedDevices(managementRequest);
      }
      return parseLinkedDeviceListResultV1(result);
    },
    revokeLinkedDevice: async (args) => {
      const request = parseLinkedDeviceRevokeRequestV1({
        kind: 'linked_device_revoke_request_v1',
        walletId: parseWalletIdForPublicCall(args.walletId),
        walletAuthMethodId: parseWalletAuthMethodIdForPublicCall(args.walletAuthMethodId),
        requestedAtMs: args.requestedAtMs,
      });
      const rawResult = await deps.domain.linkedDeviceManagement.revokeLinkedDevice({
        walletId: request.walletId,
        walletAuthMethodId: request.walletAuthMethodId,
        requestedAtMs: request.requestedAtMs,
        sourceProof: args.sourceProof,
      });
      const result = parseLinkedDeviceRevokeResultV1(rawResult);
      return result;
    },
  } satisfies DevicesCapability;
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
