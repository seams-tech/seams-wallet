import type { BrowserSigningSurface } from '@/SeamsWeb/signingSurface/BrowserSigningSurface';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import type { DeviceCommands } from '@/SeamsWeb/publicApi/devices';
import { DeviceLinkingDomain } from '@/SeamsWeb/operations/devices/linkDevice';
import type { DeviceLinkingWebContext } from '@/SeamsWeb/signingSurface/types';
import { IndexedDBManager } from '@/core/indexedDB';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { createBrowserHostPlatformRuntime } from '@/SeamsWeb/assembly/createBrowserSigningRuntime';
import { createWalletHostCompositionV1 } from '@/SeamsWeb/operations/devices/walletHostComposition';
import { createWalletHostOwnerAuthoritiesV1 } from '@/SeamsWeb/operations/devices/walletHostOwnerAuthority';
import type {
  LinkSessionOwnerApprovalUpdatesPortV1,
  LinkSessionOwnerAuthenticatedRequestPortV1,
} from '@/SeamsWeb/operations/devices/deviceLinkingOwnerTransport';
import { LINKED_DEVICE_SESSION_HTTP_BASE_PATH_V1 } from '@/SeamsWeb/operations/devices/deviceLinkingHttpTransport';
import { IndexedDbEcdsaCapabilityManifestStore } from '@/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore';
import { resolveAmbiguousEcdsaActivationForSelectedAuthMethod } from '@/SeamsWeb/assembly/browserSigningSurfaceAssembly';
import { resolveLinkedEcdsaHolderRuntimeV1 } from '@/core/signingEngine/session/material/linkedEcdsaHolderRuntime';
import {
  walletCustodyCeremonyTransportFromWorkerContextV1,
  readUnlockedEd25519ExportRootLinkingCapabilityV1,
} from '@/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability';
import {
  createDeviceLinkingEcdsaSourceContributionMetadataReaderV1,
  createDeviceLinkingEd25519SourceContributionPortV1,
  createDeviceLinkingSourceContributionPortV1,
  type DeviceLinkingEcdsaSourceContributionMetadataReaderV1,
  type DeviceLinkingEcdsaSourceContributionMetadataContextV1,
} from '@/core/signingEngine/workerManager/deviceLinkingSourceContribution';

import { parseLinkedDeviceApprovalResultV1 } from '@shared/device-linking';
import type { DeviceLinkingSourceContributionPortV1 } from '@/SeamsWeb/operations/devices/deviceLinkingPorts';

const ecdsaCapabilityManifestStore = new IndexedDbEcdsaCapabilityManifestStore();

type WalletHostDeviceDomain = {
  readonly domain: DeviceCommands;
  readonly resumePendingAcknowledgementsV1: () => Promise<void>;
  readonly dispose: () => void;
};

export function createWalletHostDeviceDomain(args: {
  readonly configs: SeamsConfigsReadonly;
  readonly signingEngine: BrowserSigningSurface;
  readonly getContext: () => DeviceLinkingWebContext;
}): WalletHostDeviceDomain {
  const relayerUrl = String(args.configs.network.relayer?.url || '').trim();
  const platform = createBrowserHostPlatformRuntime(args.signingEngine.getSignerWorkerContext());
  const ownerAuthorities = createWalletHostOwnerAuthoritiesV1({
    http: platform.http,
    relayerUrl,
    walletSessions: walletSessionAuthorizations,
    resolveSelectedWalletAuthority:
      IndexedDBManager.resolveSelectedWalletAuthority.bind(IndexedDBManager),
    readWalletAuthenticationState: args.signingEngine.readWalletAuthenticationState.bind(
      args.signingEngine,
    ),
    readUnlockedEd25519ExportRootCapabilityV1: readUnlockedEd25519ExportRootLinkingCapabilityV1,
  });
  const sourceContribution = createWalletHostDeviceLinkingSourceContributionPortV1({
    signingEngine: args.signingEngine,
    ownerRequest: ownerAuthorities.ownerRequest,
    readEcdsaMetadataV1: createWalletHostEcdsaSourceContributionMetadataReaderV1({
      signingEngine: args.signingEngine,
    }),
  });

  const composition = createWalletHostCompositionV1({
    authenticator: platform.authenticator,
    http: platform.http,
    relayerUrl: String(args.configs.network.relayer?.url || '').trim(),
    publishableKey: args.configs.registration.publishableKey,
    projectEnvironmentId: args.configs.registration.projectEnvironmentId,
    ownerRequest: ownerAuthorities.ownerRequest,
    ownerApprovalUpdates: createWalletHostOwnerApprovalUpdatesV1({
      request: ownerAuthorities.ownerRequest,
      pollIntervalMs: 1_000,
    }),
    ownerAuthorization: ownerAuthorities.ownerAuthorization,
    sourceContribution: sourceContribution,
    custodyCeremonyTransport: walletCustodyCeremonyTransportFromWorkerContextV1(
      args.signingEngine.getSignerWorkerContext(),
    ),
    managementRequest: ownerAuthorities.managementRequest,
    nowMs: Date.now,
    pollIntervalMs: 1_000,
  });
  const deviceLinking = new DeviceLinkingDomain({
    getContext: args.getContext,
    ports: composition.deviceLinkingPorts,
  });
  return {
    domain: {
      linkedDeviceManagement: composition.linkedDeviceManagement,
      startDevice2LinkingFlow: deviceLinking.startDevice2LinkingFlow.bind(deviceLinking),
      cancelDeviceLinking: deviceLinking.cancelDeviceLinking.bind(deviceLinking),
      scanAndLinkDevice: deviceLinking.scanAndLinkDevice.bind(deviceLinking),
    },
    resumePendingAcknowledgementsV1: composition.deviceLinkingPorts.resumePendingAcknowledgementsV1,
    dispose: composition.dispose,
  };
}

function createWalletHostOwnerApprovalUpdatesV1(args: {
  readonly request: LinkSessionOwnerAuthenticatedRequestPortV1;
  readonly pollIntervalMs: number;
}): LinkSessionOwnerApprovalUpdatesPortV1 {
  return {
    getApprovalV1: async (input) => await requestWalletHostApprovalV1(args.request, input),
    subscribeApprovalV1: async (input) =>
      createWalletHostApprovalSubscriptionV1({ ...args, input }),
  };
}

type WalletHostEcdsaSourceMetadataSigningSurfaceV1 = Pick<
  BrowserSigningSurface,
  'readWalletAuthenticationState'
>;

function createWalletHostEcdsaSourceContributionMetadataReaderV1(args: {
  readonly signingEngine: WalletHostEcdsaSourceMetadataSigningSurfaceV1;
}): DeviceLinkingEcdsaSourceContributionMetadataReaderV1 {
  const context: DeviceLinkingEcdsaSourceContributionMetadataContextV1 = {
    readActiveEcdsaCapabilityManifestV1: async ({ materialActivation }) => {
      const authentication = args.signingEngine.readWalletAuthenticationState();
      if (authentication.kind !== 'authenticated') {
        throw new Error('ECDSA source metadata requires an authenticated wallet');
      }
      let lookup = await ecdsaCapabilityManifestStore.lookupByMaterialActivation({
        walletId: authentication.walletId,
        materialActivation,
      });
      if (lookup.kind === 'ambiguous_authority') {
        // The source contribution is made as the selected method, so name it
        // rather than reading whichever sibling projection scans first.
        lookup = await resolveAmbiguousEcdsaActivationForSelectedAuthMethod({
          walletId: authentication.walletId,
          materialActivation,
          authorities: lookup.authorities,
        });
      }
      if (lookup.kind !== 'active') {
        throw new Error(`ECDSA source metadata manifest is ${lookup.kind}`);
      }
      return lookup.manifest;
    },
    readLinkedEcdsaHolderV1: ({ materialActivation }) => {
      const authentication = args.signingEngine.readWalletAuthenticationState();
      if (authentication.kind !== 'authenticated') return null;
      return resolveLinkedEcdsaHolderRuntimeV1({
        walletId: authentication.walletId,
        materialActivation,
      });
    },
  };
  return createDeviceLinkingEcdsaSourceContributionMetadataReaderV1(context);
}

function createWalletHostDeviceLinkingSourceContributionPortV1(args: {
  readonly signingEngine: Pick<BrowserSigningSurface, 'getSignerWorkerContext'>;
  readonly ownerRequest: LinkSessionOwnerAuthenticatedRequestPortV1;
  readonly readEcdsaMetadataV1: DeviceLinkingEcdsaSourceContributionMetadataReaderV1;
}): DeviceLinkingSourceContributionPortV1 {
  const workerContext = args.signingEngine.getSignerWorkerContext();
  const ed25519 = createDeviceLinkingEd25519SourceContributionPortV1({
    workerContext,
    executeSourcePreservingV1: async ({ linkSessionId, targetRequestJson, authentication }) => {
      const response = await args.ownerRequest.requestOwnerV1({
        method: 'POST',
        canonicalPath: `${LINKED_DEVICE_SESSION_HTTP_BASE_PATH_V1}/${String(
          linkSessionId,
        )}/source-contribution/execute`,
        body: JSON.parse(targetRequestJson),
        authentication,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Wallet-host Ed25519 source-preserving request failed with HTTP ${response.status}`,
        );
      }
      return response.body;
    },
  });
  return createDeviceLinkingSourceContributionPortV1({
    workerContext,
    ed25519,
    readEcdsaMetadataV1: args.readEcdsaMetadataV1,
  });
}

async function requestWalletHostApprovalV1(
  request: LinkSessionOwnerAuthenticatedRequestPortV1,
  input: Parameters<LinkSessionOwnerApprovalUpdatesPortV1['getApprovalV1']>[0],
): Promise<Awaited<ReturnType<LinkSessionOwnerApprovalUpdatesPortV1['getApprovalV1']>>> {
  const response = await request.requestOwnerV1({
    method: 'GET',
    canonicalPath: `${LINKED_DEVICE_SESSION_HTTP_BASE_PATH_V1}/${String(
      input.linkSessionId,
    )}/approval`,
    authentication: input.authentication,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Wallet-host approval request failed with HTTP ${response.status}`);
  }
  return parseLinkedDeviceApprovalResultV1(response.body);
}

function createWalletHostApprovalSubscriptionV1(args: {
  readonly request: LinkSessionOwnerAuthenticatedRequestPortV1;
  readonly pollIntervalMs: number;
  readonly input: Parameters<LinkSessionOwnerApprovalUpdatesPortV1['subscribeApprovalV1']>[0];
}): { readonly close: () => void } {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const poll = async (): Promise<void> => {
    if (closed) return;
    try {
      const result = await requestWalletHostApprovalV1(args.request, args.input);
      if (!closed) args.input.onResult(result);
    } catch {
      // The next poll retries transient owner-session transport failures.
    }
    if (!closed) timer = setTimeout(() => void poll(), args.pollIntervalMs);
  };
  void poll();
  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
