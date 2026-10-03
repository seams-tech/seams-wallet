import { CloudflareD1WalletCustodyCommitStore } from '../passkeyCustody/d1WalletCustodyCommitStore';
import type { NormalizedCloudflareD1RouterApiAuthServiceOptions } from './d1RouterApiAuthConfig';
import { AuthorizationService } from '../../../../authorization/service';
import { capabilityPolicyPort } from '../../../../authorization/capabilityPolicy';
import type { WalletSessionRoutingPublisher } from '../../../../authorization/sessionRouting';
import {
  CloudflareD1AuthorizationStore,
  type D1AuthorizationStoreOptions,
} from '../authorization/d1AuthorizationStore';

export function createD1AuthorizationAssembly(
  options: D1AuthorizationStoreOptions,
  sessionRouting: WalletSessionRoutingPublisher | undefined,
) {
  const authorizationStore = new CloudflareD1AuthorizationStore(options);
  const authorizationService = new AuthorizationService({
    policy: capabilityPolicyPort,
    sessions: authorizationStore,
    evidence: authorizationStore,
    grants: authorizationStore,
    authorizedOperations: authorizationStore,
    audit: authorizationStore,
    sessionRouting,
  });
  return { authorizationStore, authorizationService };
}

export function createD1WalletCustodyStore(
  options: NormalizedCloudflareD1RouterApiAuthServiceOptions,
) {
  return new CloudflareD1WalletCustodyCommitStore({
    database: options.database,
    scope: {
      namespace: options.namespace,
      orgId: options.orgId,
      projectId: options.projectId,
      envId: options.envId,
    },
    recoveryRouting: options.recoveryRouting,
  });
}
