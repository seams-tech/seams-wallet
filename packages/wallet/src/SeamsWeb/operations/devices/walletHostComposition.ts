import type { WalletCustodyCeremonyTransportPort } from '@/core/signingEngine/walletCustody/ceremonyStepRunner';
import type { AuthenticatorPort } from '@/core/platform';
import type { HttpTransport } from '@/core/platform/http';
import {
  parseLinkedDeviceListRequestV1,
  parseLinkedDeviceListResultV1,
  parseLinkedDeviceRevokeRequestV1,
  parseLinkedDeviceRevokeResultV1,
  type LinkedDeviceRevokeResultV1,
} from '@shared/device-linking';
import type { DeviceLinkingWorkerEndpointV1 } from './deviceLinkingWorkerChannels';
import type { DeviceLinkingFlowPortsAssemblyV1 } from './deviceLinkingComposition';
import { createDeviceLinkingFlowPortsV1 } from './deviceLinkingComposition';
import type {
  LinkSessionOwnerApprovalUpdatesPortV1,
  LinkSessionOwnerAuthenticatedRequestPortV1,
} from './deviceLinkingOwnerTransport';
import type {
  DeviceLinkingOwnerAuthorizationPortV1,
  DeviceLinkingSourceContributionPortV1,
} from './deviceLinkingPorts';
import type { LinkedDeviceManagementPortV1 } from '@/SeamsWeb/publicApi/devices';
import type { WalletHostManagementRequestV1 } from './walletHostOwnerAuthority';

export const LINKED_DEVICE_MANAGEMENT_HTTP_BASE_PATH_V1 =
  '/wallet/device-linking/v1/devices' as const;
export const OWNER_WALLET_SESSION_REAUTH_REQUIRED = 'owner_wallet_session_reauth_required' as const;

export class OwnerWalletSessionReauthRequiredError extends Error {
  readonly code = OWNER_WALLET_SESSION_REAUTH_REQUIRED;

  constructor() {
    super('The owner Wallet Session must be renewed');
    this.name = 'OwnerWalletSessionReauthRequiredError';
  }
}

/**
 * The owner request closures are created by the wallet-host signing surface.
 * They retain the active Wallet Session credential and expose only parsed HTTP
 * boundaries to this assembly layer.
 */
export type WalletHostCompositionDependenciesV1 = {
  readonly authenticator: AuthenticatorPort;
  readonly http: HttpTransport;
  readonly relayerUrl: string;
  readonly publishableKey: string;
  readonly projectEnvironmentId: string;
  readonly ownerRequest: LinkSessionOwnerAuthenticatedRequestPortV1;
  readonly ownerApprovalUpdates: LinkSessionOwnerApprovalUpdatesPortV1;
  readonly ownerAuthorization: DeviceLinkingOwnerAuthorizationPortV1;
  readonly sourceContribution: DeviceLinkingSourceContributionPortV1;
  /** The wallet custody worker both devices drive for the seed transfer. */
  readonly custodyCeremonyTransport: WalletCustodyCeremonyTransportPort;
  readonly managementRequest: WalletHostManagementRequestV1;
  readonly workerEndpoint?: DeviceLinkingWorkerEndpointV1;
  readonly workerTimeoutMs?: number;
  readonly nowMs: () => number;
  readonly pollIntervalMs: number;
};

export type WalletHostCompositionV1 = {
  readonly linkedDeviceManagement: LinkedDeviceManagementPortV1;
  readonly deviceLinkingPorts: DeviceLinkingFlowPortsAssemblyV1;
  readonly dispose: () => void;
};

export function createWalletHostCompositionV1(
  args: WalletHostCompositionDependenciesV1,
): WalletHostCompositionV1 {
  const deviceLinkingPorts = createDeviceLinkingFlowPortsV1(args);
  return {
    linkedDeviceManagement: createWalletHostLinkedDeviceManagementPortV1({
      request: args.managementRequest,
    }),
    deviceLinkingPorts,
    dispose: deviceLinkingPorts.dispose,
  };
}

function createWalletHostLinkedDeviceManagementPortV1(args: {
  readonly request: WalletHostManagementRequestV1;
}): LinkedDeviceManagementPortV1 {
  return {
    listLinkedDevices: async ({ walletId, limit, cursor }) => {
      const request = parseLinkedDeviceListRequestV1({
        kind: 'linked_device_list_request_v1',
        walletId,
        limit,
        cursor,
      });
      const path = `${LINKED_DEVICE_MANAGEMENT_HTTP_BASE_PATH_V1}?walletId=${encodeURIComponent(
        String(request.walletId),
      )}&limit=${encodeURIComponent(String(request.limit))}&cursor=${encodeURIComponent(
        request.cursor ?? '',
      )}`;
      const response = await args.request.request({
        method: 'GET',
        canonicalPath: path,
        walletId: request.walletId,
      });
      assertManagementSuccess(response, 'list linked devices');
      return parseLinkedDeviceListResponseV1(response.body);
    },
    revokeLinkedDevice: async ({ walletId, walletAuthMethodId, requestedAtMs, sourceProof }) => {
      const request = parseLinkedDeviceRevokeRequestV1({
        kind: 'linked_device_revoke_request_v1',
        walletId,
        walletAuthMethodId,
        requestedAtMs,
      });
      const response = await args.request.request({
        method: 'POST',
        canonicalPath: `${LINKED_DEVICE_MANAGEMENT_HTTP_BASE_PATH_V1}/${encodeURIComponent(
          String(walletAuthMethodId),
        )}/revoke`,
        body: { ...request, sourceProof },
        walletId,
      });
      return parseManagementRevokeResult(response);
    },
  };
}

function parseManagementRevokeResult(response: {
  readonly status: number;
  readonly body: unknown;
}): LinkedDeviceRevokeResultV1 {
  if (response.status === 404) return parseLinkedDeviceRevokeResultV1({ kind: 'not_found' });
  if (response.status === 409) return parseLinkedDeviceRevokeResultV1({ kind: 'conflict' });
  if (response.status === 401 || response.status === 403) {
    return parseLinkedDeviceRevokeResultV1({ kind: 'unauthorized' });
  }
  assertManagementSuccess(response, 'revoke linked device');
  return parseLinkedDeviceRevokeResponseV1(response.body);
}

function assertManagementSuccess(
  response: { readonly status: number; readonly body: unknown },
  operation: string,
): void {
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401 && isManagementUnauthorizedFailureRecordV1(response.body)) {
      throw new OwnerWalletSessionReauthRequiredError();
    }
    const detail = managementFailureDetail(response.body);
    throw new Error(
      detail
        ? `linked-device ${operation} failed with HTTP ${response.status}: ${detail}`
        : `linked-device ${operation} failed with HTTP ${response.status}`,
    );
  }
}

function managementFailureDetail(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (isManagementFailureWithMessageRecordV1(raw)) return raw.message;
  if (isManagementUnauthorizedFailureRecordV1(raw)) return raw.message;
  return null;
}

type LinkedDeviceListResponseRecordV1 = {
  readonly ok: unknown;
  readonly devices: unknown;
  readonly ownerDevices: unknown;
  readonly nextCursor: unknown;
};

function parseLinkedDeviceListResponseV1(raw: unknown) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('linked-device list response must be an object');
  }
  if (!isLinkedDeviceListResponseRecordV1(raw)) {
    throw new Error('linked-device list response has unexpected fields');
  }
  if (raw.ok !== true) throw new Error('linked-device list response is not successful');
  return parseLinkedDeviceListResultV1({
    devices: raw.devices,
    ownerDevices: raw.ownerDevices,
    nextCursor: raw.nextCursor,
  });
}

function isLinkedDeviceListResponseRecordV1(
  value: object,
): value is LinkedDeviceListResponseRecordV1 {
  return Object.keys(value).sort().join('|') === 'devices|nextCursor|ok|ownerDevices';
}

type LinkedDeviceRevokeResponseRecordV1 = {
  readonly ok: unknown;
  readonly kind: unknown;
  readonly walletAuthMethodId: unknown;
  readonly authorityId: unknown;
  readonly revocationEpoch: unknown;
};

function parseLinkedDeviceRevokeResponseV1(raw: unknown): LinkedDeviceRevokeResultV1 {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('linked-device revoke response must be an object');
  }
  if (!isLinkedDeviceRevokeResponseRecordV1(raw)) {
    throw new Error('linked-device revoke response has unexpected fields');
  }
  if (raw.ok !== true) throw new Error('linked-device revoke response is not successful');
  return parseLinkedDeviceRevokeResultV1({
    kind: raw.kind,
    walletAuthMethodId: raw.walletAuthMethodId,
    authorityId: raw.authorityId,
    revocationEpoch: raw.revocationEpoch,
  });
}

function isLinkedDeviceRevokeResponseRecordV1(
  value: object,
): value is LinkedDeviceRevokeResponseRecordV1 {
  return (
    Object.keys(value).sort().join('|') === 'authorityId|kind|ok|revocationEpoch|walletAuthMethodId'
  );
}

type ManagementFailureWithMessageRecordV1 = {
  readonly ok: false;
  readonly kind: 'invalid_input' | 'internal';
  readonly message: string;
};

function isManagementFailureWithMessageRecordV1(
  value: object,
): value is ManagementFailureWithMessageRecordV1 {
  if (Object.keys(value).sort().join('|') !== 'kind|message|ok') return false;
  if (!('ok' in value) || !('kind' in value) || !('message' in value)) return false;
  return (
    value.ok === false &&
    (value.kind === 'invalid_input' || value.kind === 'internal') &&
    typeof value.message === 'string' &&
    value.message.trim().length > 0
  );
}

type ManagementUnauthorizedFailureRecordV1 = {
  readonly ok: false;
  readonly kind: 'unauthorized';
  readonly code: string;
  readonly message: string;
};

function isManagementUnauthorizedFailureRecordV1(
  value: unknown,
): value is ManagementUnauthorizedFailureRecordV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).sort().join('|') !== 'code|kind|message|ok') return false;
  if (!('ok' in value) || !('kind' in value) || !('code' in value) || !('message' in value)) {
    return false;
  }
  return (
    value.ok === false &&
    value.kind === 'unauthorized' &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    value.message.trim().length > 0
  );
}
