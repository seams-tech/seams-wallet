import type { WalletSessionLimitsPort } from '../../../authorization/service';
import type { RouterApiProjectEnvironmentResolver } from '../../framework/apiCredentialPorts';
import {
  DEFAULT_TENANT_WALLET_SESSION_LIMITS,
  parseWalletSessionLimits,
  type WalletSessionLimits,
} from '@shared/threshold/walletSessionBudget';

type ProjectEnvironmentScope = {
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
};

/**
 * Reads the tenant's Wallet Session maximum of this deployment's project
 * environment from the Console, once for each composition. A tenant that set
 * none gets the default maximum. A failed read or a value that does not parse
 * rejects, and the issuer then grants at most the default budget.
 */
export function createProjectEnvironmentWalletSessionLimits(input: {
  readonly resolver: RouterApiProjectEnvironmentResolver;
  readonly scope: ProjectEnvironmentScope;
}): WalletSessionLimitsPort {
  let read: Promise<WalletSessionLimits> | null = null;
  return {
    readWalletSessionLimits() {
      read ??= readProjectEnvironmentWalletSessionLimits(input.resolver, input.scope);
      return read;
    },
  };
}

/** The port of a deployment with no Console: every read fails, so the default budget is the maximum. */
export const UNAVAILABLE_WALLET_SESSION_LIMITS: WalletSessionLimitsPort = Object.freeze({
  async readWalletSessionLimits(): Promise<WalletSessionLimits> {
    throw new Error('This deployment has no project environment resolver');
  },
});

async function readProjectEnvironmentWalletSessionLimits(
  resolver: RouterApiProjectEnvironmentResolver,
  scope: ProjectEnvironmentScope,
): Promise<WalletSessionLimits> {
  const environments = await resolver.listEnvironments(
    {
      orgId: scope.orgId,
      projectId: scope.projectId,
      environmentId: scope.envId,
      actorUserId: 'wallet-session-issuer',
      roles: [],
    },
    { status: 'ACTIVE' },
  );
  const environment = environments.find((candidate) => candidate.id === scope.envId);
  if (!environment) {
    throw new Error(`Project environment ${scope.envId} is not active`);
  }
  return environment.walletSessionLimits == null
    ? DEFAULT_TENANT_WALLET_SESSION_LIMITS
    : parseWalletSessionLimits(environment.walletSessionLimits, 'environment.walletSessionLimits');
}
