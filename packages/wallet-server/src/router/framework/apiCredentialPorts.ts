import type { RouterApiKeyAuthFailureCode } from '@shared/utils/routerApiKeyAuth';

export const ROUTER_API_CREDENTIAL_SCOPES = [
  'accounts.create',
  'wallets.read',
  'wallets.auth_methods.create',
  'wallets.signers.create',
] as const;

export type RouterApiCredentialScope = (typeof ROUTER_API_CREDENTIAL_SCOPES)[number];

export type { RouterApiKeyAuthFailureCode };

export interface RouterApiKeyAuthRequest {
  secret: string;
  endpoint: string;
  requiredScopes: RouterApiCredentialScope[];
  sourceIp?: string;
  environmentId?: string;
}

export interface RouterApiKeyPrincipal {
  apiKeyId: string;
  orgId: string;
  projectId?: string;
  envId?: string;
  environmentId: string;
  scopes: RouterApiCredentialScope[];
}

export type RouterApiKeyAuthResult =
  | { ok: true; principal: RouterApiKeyPrincipal }
  | {
      ok: false;
      status: 401 | 403;
      code: RouterApiKeyAuthFailureCode;
      message: string;
    };

export interface RouterApiKeyAuthAdapter {
  authenticate(input: RouterApiKeyAuthRequest): Promise<RouterApiKeyAuthResult>;
}

export type RouterApiPublishableKeyAuthFailureCode =
  | 'publishable_key_missing'
  | 'publishable_key_invalid'
  | 'publishable_key_revoked'
  | 'publishable_key_origin_blocked'
  | 'publishable_key_environment_mismatch';

export interface RouterApiPublishableKeyAuthRequest {
  secret: string;
  origin: string;
  environmentId: string;
}

export type RouterApiPublishableKeyAuthResult =
  | { ok: true; principal: RouterApiKeyPrincipal }
  | {
      ok: false;
      status: 401 | 403;
      code: RouterApiPublishableKeyAuthFailureCode;
      message: string;
    };

export interface RouterApiPublishableKeyAuthAdapter {
  authenticate(input: RouterApiPublishableKeyAuthRequest): Promise<RouterApiPublishableKeyAuthResult>;
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
  id: string;
  projectId: string;
  key: string;
  signingRootVersion: string;
  status?: string;
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
