// The ports to the operator's key store and project records. The operator keeps the keys; a
// service of this package calls the store only through these adapters.

import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

export const ROUTER_API_CREDENTIAL_SCOPES = [
  'accounts.create',
  'wallets.read',
  'wallets.auth_methods.create',
  'wallets.signers.create',
] as const;

export type RouterApiCredentialScope = (typeof ROUTER_API_CREDENTIAL_SCOPES)[number];

export type RouterApiKeyAuthFailureCode =
  | 'secret_key_missing'
  | 'secret_key_invalid'
  | 'secret_key_revoked'
  | 'secret_key_forbidden_scope'
  | 'secret_key_ip_blocked'
  | 'secret_key_environment_mismatch';

export type RouterApiPublishableKeyAuthFailureCode =
  | 'publishable_key_missing'
  | 'publishable_key_invalid'
  | 'publishable_key_revoked'
  | 'publishable_key_origin_blocked'
  | 'publishable_key_environment_mismatch';

export interface RouterApiKeyPrincipal {
  apiKeyId: string;
  orgId: string;
  projectId?: string;
  envId?: string;
  environmentId: string;
  scopes: RouterApiCredentialScope[];
}

type KeyAuthResult<TCode extends string> =
  | { ok: true; principal: RouterApiKeyPrincipal }
  | { ok: false; status: 401 | 403; code: TCode; message: string };

export interface RouterApiKeyAuthRequest {
  secret: string;
  endpoint: string;
  requiredScopes: RouterApiCredentialScope[];
  sourceIp?: string;
  environmentId?: string;
}

export type RouterApiKeyAuthResult = KeyAuthResult<RouterApiKeyAuthFailureCode>;

export interface RouterApiKeyAuthAdapter {
  authenticate(input: RouterApiKeyAuthRequest): Promise<RouterApiKeyAuthResult>;
}

export interface RouterApiPublishableKeyAuthRequest {
  secret: string;
  origin: string;
  environmentId: string;
}

export type RouterApiPublishableKeyAuthResult =
  KeyAuthResult<RouterApiPublishableKeyAuthFailureCode>;

export interface RouterApiPublishableKeyAuthAdapter {
  authenticate(
    input: RouterApiPublishableKeyAuthRequest,
  ): Promise<RouterApiPublishableKeyAuthResult>;
}

/** A checked publishable key with the active environment that it belongs to. */
export type RegistrationContextResult = ReadonlyExclusiveUnion<
  | {
      ok: true;
      principal: RouterApiKeyPrincipal;
      environment: RouterApiProjectEnvironment & { readonly status: 'ACTIVE' };
    }
  | {
      ok: false;
      status: 401 | 403;
      code: RouterApiPublishableKeyAuthFailureCode;
      message: string;
    }
  | {
      ok: false;
      status: 500;
      code: 'registration_environment_unavailable';
      message: string;
    }
>;

/** `registration` is the module's own request. The operator can read it to place the record. */
export interface RegistrationContextResolver<TRegistration> {
  resolve(
    input: RouterApiPublishableKeyAuthRequest & { readonly registration: TRegistration },
  ): Promise<RegistrationContextResult>;
}

export type RouterApiUsageMeterAction = 'wallet_created';

export interface RouterApiUsageMeterEvent {
  orgId: string;
  environmentId: string;
  apiKeyId: string;
  endpoint: string;
  walletId: string;
  action: RouterApiUsageMeterAction;
  succeeded: boolean;
  occurredAt?: string;
  /** Producer-owned idempotency key; replays with the same id must not double-count. */
  sourceEventId?: string;
}

export interface RouterApiUsageMeterAdapter {
  recordEvent(input: RouterApiUsageMeterEvent): Promise<void>;
}

export interface RouterApiProjectEnvironment {
  externalAuth?: import('@shared/auth/externalAuth').ExternalAuthConfiguration;
  id: string;
  projectId: string;
  key: string;
  signingRootVersion: string;
  status?: string;
  /**
   * The tenant's maximum Wallet Session budget as the Console sends it; null or
   * absent: the tenant set none. The Wallet Session limits port parses it, so a
   * value that does not parse changes only the grant, not the environment.
   */
  walletSessionLimits?: unknown;
}

export interface RouterApiProjectEnvironmentResolver {
  listEnvironments(
    context: {
      orgId: string;
      actorUserId: string;
      roles: string[];
      environmentId?: string;
      projectId?: string;
    },
    filters?: { status?: string },
  ): Promise<RouterApiProjectEnvironment[]>;
}
