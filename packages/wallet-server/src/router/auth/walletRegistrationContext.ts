import type {
  RouterApiKeyPrincipal,
  RouterApiProjectEnvironment,
  RouterApiProjectEnvironmentResolver,
  RouterApiPublishableKeyAuthAdapter,
  RouterApiPublishableKeyAuthRequest,
  WalletRegistrationContextResult,
} from '../framework/apiCredentialPorts';

export function unavailableRegistrationContext(): WalletRegistrationContextResult {
  return {
    ok: false,
    status: 500,
    code: 'registration_environment_unavailable',
    message: 'Wallet registration requires the authenticated active environment',
  };
}

/** Join the authenticated credential to its exact active environment at the boundary. */
export function walletRegistrationContext(
  input: RouterApiPublishableKeyAuthRequest,
  principal: RouterApiKeyPrincipal,
  environment: RouterApiProjectEnvironment,
): WalletRegistrationContextResult {
  if (
    principal.environmentId !== input.environmentId ||
    environment.id !== principal.environmentId ||
    environment.status !== 'ACTIVE' ||
    !environment.projectId ||
    !environment.key ||
    !environment.signingRootVersion ||
    (principal.projectId !== undefined && principal.projectId !== environment.projectId) ||
    (principal.envId !== undefined && principal.envId !== environment.key)
  ) {
    return unavailableRegistrationContext();
  }
  return {
    ok: true,
    principal,
    environment: {
      id: environment.id,
      projectId: environment.projectId,
      key: environment.key,
      signingRootVersion: environment.signingRootVersion,
      status: 'ACTIVE',
    },
  };
}

async function resolveRegistrationContext(
  auth: RouterApiPublishableKeyAuthAdapter,
  environments: RouterApiProjectEnvironmentResolver,
  input: RouterApiPublishableKeyAuthRequest,
): Promise<WalletRegistrationContextResult> {
  try {
    const result = await auth.authenticate(input);
    if (!result.ok) return result;
    const principal = result.principal;
    const records = await environments.listEnvironments(
      {
        orgId: principal.orgId,
        actorUserId: 'runtime-scope-bootstrap',
        roles: ['system'],
        environmentId: principal.environmentId,
        ...(principal.projectId ? { projectId: principal.projectId } : {}),
      },
      { status: 'ACTIVE' },
    );
    for (const environment of records) {
      if (environment.id === principal.environmentId) {
        return walletRegistrationContext(input, principal, environment);
      }
    }
    return unavailableRegistrationContext();
  } catch {
    return unavailableRegistrationContext();
  }
}

export function createWalletRegistrationContextResolver(
  auth: RouterApiPublishableKeyAuthAdapter,
  environments: RouterApiProjectEnvironmentResolver,
) {
  return { resolve: resolveRegistrationContext.bind(undefined, auth, environments) };
}
