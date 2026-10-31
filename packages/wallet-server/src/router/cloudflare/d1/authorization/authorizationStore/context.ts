import { type MpcMaterialActivationRef, type WalletId } from '@shared/utils/domainIds';
import { D1WalletStore } from '../../../../../core/d1WalletStore';
import type { D1WalletStoreScope } from '../../../../../core/d1WalletStore';
import type { D1DatabaseLike } from '../../../../../storage/tenantRoute';
import { requireOpaqueString } from './rowValues';

/**
 * Linked-device lane material is installed on the linked authority projection
 * rather than the wallet signer rows, so the exact-status material check needs
 * this reader to recognize a linked session's capability subjects.
 */
type D1AuthorizationLinkedAuthorityMaterialReader = {
  readInstalledEd25519AuthorityByMaterialActivationV1(input: {
    readonly walletId: WalletId;
    readonly materialActivation: MpcMaterialActivationRef;
  }): Promise<D1AuthorizationLinkedAuthorityMaterialProjection | null>;
  readInstalledEcdsaAuthorityByMaterialActivationV1(input: {
    readonly walletId: WalletId;
    readonly materialActivation: MpcMaterialActivationRef;
  }): Promise<D1AuthorizationLinkedAuthorityMaterialProjection | null>;
};

export type D1AuthorizationLinkedAuthorityMaterialProjection = {
  readonly walletId: string;
  readonly materialActivation: MpcMaterialActivationRef;
};

export type D1AuthorizationStoreOptions = {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly walletSignerScope: D1WalletStoreScope;
  readonly getLinkedDeviceAuthorityReader?: () => D1AuthorizationLinkedAuthorityMaterialReader | null;
};
export type D1AuthorizationContext = {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly walletSignerScope: D1WalletStoreScope;
  readonly walletStore: D1WalletStore;
  readonly getLinkedDeviceAuthorityReader: () => D1AuthorizationLinkedAuthorityMaterialReader | null;
};

export function createD1AuthorizationContext(
  options: D1AuthorizationStoreOptions,
): D1AuthorizationContext {
  const getLinkedDeviceAuthorityReader =
    options.getLinkedDeviceAuthorityReader ?? noLinkedDeviceAuthorityReader;
  const database = options.database;
  const namespace = requireOpaqueString(options.namespace, 'namespace');
  const walletSignerScope = {
    namespace: requireOpaqueString(
      options.walletSignerScope.namespace,
      'walletSignerScope.namespace',
    ),
    orgId: requireOpaqueString(options.walletSignerScope.orgId, 'walletSignerScope.orgId'),
    projectId: requireOpaqueString(
      options.walletSignerScope.projectId,
      'walletSignerScope.projectId',
    ),
    envId: requireOpaqueString(options.walletSignerScope.envId, 'walletSignerScope.envId'),
  };
  const walletStore = new D1WalletStore({
    database,
    namespace: walletSignerScope.namespace,
    orgId: walletSignerScope.orgId,
    projectId: walletSignerScope.projectId,
    envId: walletSignerScope.envId,
    ensureSchema: false,
  });
  return {
    database,
    namespace,
    walletSignerScope,
    walletStore,
    getLinkedDeviceAuthorityReader,
  };
}

function noLinkedDeviceAuthorityReader(): null {
  return null;
}
