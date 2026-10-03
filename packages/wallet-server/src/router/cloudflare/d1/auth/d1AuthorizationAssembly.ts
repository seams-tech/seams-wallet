import { CloudflareD1GoogleEmailOtpRegistrationAttemptStore } from '../emailOtp/d1GoogleEmailOtpRegistrationAttemptStore';
import type { ScopedD1Prepare } from '../../../../core/emailOtpD1Statements';
import { D1IdentityStore } from '../../../../core/d1IdentityStore';
import {
  CloudflareD1WebAuthnAuthService,
  type D1WebAuthnWalletManifestSource,
} from '../webauthn/d1WebAuthnAuthService';
import { CloudflareD1WebAuthnStore } from '../webauthn/d1WebAuthnStore';
import type { D1WalletAuthMethodStore } from '../../../../core/d1WalletAuthMethodStore';
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

export function createD1WebAuthnAssembly(
  options: NormalizedCloudflareD1RouterApiAuthServiceOptions,
  walletAuthMethodStore: D1WalletAuthMethodStore,
  walletManifestSource: D1WebAuthnWalletManifestSource,
) {
  const webAuthnStore = new CloudflareD1WebAuthnStore({
    database: options.database,
    namespace: options.namespace,
    orgId: options.orgId,
    projectId: options.projectId,
    envId: options.envId,
  });
  const webAuthnAuthService = new CloudflareD1WebAuthnAuthService({
    webAuthnStore,
    walletAuthMethodStore,
    walletManifestSource,
    lifecycleRouting: options.lifecycleRouting,
  });
  return { webAuthnStore, webAuthnAuthService };
}

export function createD1IdentityStore(options: NormalizedCloudflareD1RouterApiAuthServiceOptions) {
  if (options.identityStore) return options.identityStore;
  return new D1IdentityStore({
    database: options.database,
    namespace: options.namespace,
    orgId: options.orgId,
    projectId: options.projectId,
    envId: options.envId,
    ensureSchema: false,
  });
}

export function createD1GoogleRegistrationAttempts(
  options: NormalizedCloudflareD1RouterApiAuthServiceOptions,
  prepare: ScopedD1Prepare,
) {
  return (
    options.googleRegistrationAttempts ??
    new CloudflareD1GoogleEmailOtpRegistrationAttemptStore({
      prepare,
      orgId: options.orgId,
    })
  );
}
