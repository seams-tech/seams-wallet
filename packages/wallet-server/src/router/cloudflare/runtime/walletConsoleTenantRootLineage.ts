import type { RouterApiProjectEnvironmentResolver } from '../../framework/apiCredentialPorts';
import { deriveSigningRootId, type RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '@shared/tenant-root';
import type { WalletConsoleTenantRootActiveLineageResolverV1 } from './walletConsoleOps';

export async function resolveRuntimeTenantRootLineage(
  environments: RouterApiProjectEnvironmentResolver,
  roots: WalletConsoleTenantRootActiveLineageResolverV1,
  scope: RuntimePolicyScope & { readonly signingRootId: string },
) {
  if (scope.signingRootId !== deriveSigningRootId(scope)) {
    throw new Error('Signing-root ID does not match the runtime environment');
  }
  const records = await environments.listEnvironments({
    orgId: scope.orgId,
    actorUserId: 'tenant-root-lineage-resolution',
    roles: ['system'],
    projectId: scope.projectId,
  });
  const environment = records.find(matchesRuntimeEnvironment.bind(null, scope));
  if (!environment) return null;
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: scope.orgId,
    projectId: scope.projectId,
    envId: environment.id,
    signingRootId: scope.signingRootId,
    signingRootVersion: scope.signingRootVersion,
  });
  if (!identity.ok) throw new Error('Resolved tenant-root environment identity is invalid');
  return roots.resolveActiveLineage(identity.value);
}

function matchesRuntimeEnvironment(
  scope: RuntimePolicyScope & { readonly signingRootId: string },
  environment: Awaited<ReturnType<RouterApiProjectEnvironmentResolver['listEnvironments']>>[number],
): boolean {
  return (
    environment.projectId === scope.projectId &&
    environment.key === scope.envId &&
    environment.signingRootVersion === scope.signingRootVersion &&
    environment.status === 'ACTIVE'
  );
}
