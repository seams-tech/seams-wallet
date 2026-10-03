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
