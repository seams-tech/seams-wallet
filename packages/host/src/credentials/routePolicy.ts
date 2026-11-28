import type { RouterApiCredentialScope, RouterApiKeyPrincipal } from './ports';

// What a route of a module declares, and the one check that runs before the module's handler.
// A module names the plane, the credential kinds and the scopes of each route. This file checks
// them and gives the handler the checked principal.

export const API_CREDENTIAL_TYPES = ['publishable_key', 'secret_key'] as const;
type ApiCredentialType = (typeof API_CREDENTIAL_TYPES)[number];

export const PUBLIC_PROOF_TYPES = [
  'challenge_exchange',
  'intent_grant',
  'recovery_proof',
  'signed_payload',
  'threshold_protocol_state',
  'webauthn',
] as const;
type PublicProofType = (typeof PUBLIC_PROOF_TYPES)[number];

export type RouteAuthPolicy =
  | {
      plane: 'api_credentials';
      credentials: ApiCredentialType[];
      scopes?: RouterApiCredentialScope[];
      environmentBinding?: 'required' | 'optional';
      originBinding?: 'required' | 'optional';
      ipBinding?: 'required' | 'optional';
    }
  | {
      plane: 'session_principal';
    }
  | {
      plane: 'public';
      proof?: PublicProofType;
      rationale: string;
    };

/** The part of a module's route that the credential checks read. */
export interface PolicyRoute {
  method: string;
  path: string;
  auth: RouteAuthPolicy;
  requiredServices?: readonly string[];
}

export type RoutePrincipal =
  | {
      kind: 'api_credentials';
      principal: RouterApiKeyPrincipal;
      credentialType: ApiCredentialType;
    }
  | {
      kind: 'session_principal';
      claims: Record<string, unknown>;
    }
  | {
      kind: 'public';
    };

export type RoutePolicyFailureCode =
  | 'forbidden'
  | 'route_auth_not_configured'
  | 'service_not_configured'
  | 'unauthorized';

export type HeaderRecord = Record<string, string | string[] | undefined>;

export interface RouteRequest<TBody = unknown> {
  body: TBody;
  headers: HeaderRecord;
  params?: Record<string, string>;
  query?: Record<string, string | string[] | undefined>;
}

type RouteLogMethod = (...args: unknown[]) => void;

export interface RouteExecutionContext<TServices extends object = Record<string, unknown>> {
  headers: HeaderRecord;
  logger: {
    debug: RouteLogMethod;
    info: RouteLogMethod;
    warn: RouteLogMethod;
    error: RouteLogMethod;
  };
  principal: RoutePrincipal;
  services: TServices;
  sourceIp?: string;
}

export interface RoutePolicyResolutionFailure {
  ok: false;
  status: 401 | 403 | 409 | 500 | 501;
  code: RoutePolicyFailureCode;
  message: string;
}

export type RoutePolicyResolutionResult =
  | RoutePolicyResolutionFailure
  | { ok: true; principal: RoutePrincipal };

interface RoutePolicyResolverInput<TServices extends object> {
  headers: HeaderRecord;
  request: RouteRequest;
  route: PolicyRoute;
  services: TServices;
  sourceIp?: string;
}

type RoutePolicyResolver<TServices extends object> = (
  input: RoutePolicyResolverInput<TServices>,
) => Promise<RoutePolicyResolutionResult>;

export type EnforceRoutePolicyResult<TServices extends object = Record<string, unknown>> =
  | {
      ok: true;
      request: RouteRequest;
      context: RouteExecutionContext<TServices>;
    }
  | {
      ok: false;
      status: RoutePolicyResolutionFailure['status'];
      body: { ok: false; code: RoutePolicyFailureCode; message: string };
    };

export function routeAuthNotConfigured(message: string): RoutePolicyResolutionFailure {
  return { ok: false, status: 500, code: 'route_auth_not_configured', message };
}

async function resolveRoutePrincipal<TServices extends object>(
  resolvers: {
    apiCredentials?: RoutePolicyResolver<TServices>;
    sessionPrincipal?: RoutePolicyResolver<TServices>;
  },
  input: RoutePolicyResolverInput<TServices>,
): Promise<RoutePolicyResolutionResult> {
  for (const service of input.route.requiredServices || []) {
    if ((input.services as Record<string, unknown>)[service]) continue;
    return {
      ok: false,
      status: 501,
      code: 'service_not_configured',
      message: `${service} is not configured for this route`,
    };
  }
  switch (input.route.auth.plane) {
    case 'public':
      return { ok: true, principal: { kind: 'public' } };
    case 'api_credentials':
      return resolvers.apiCredentials
        ? await resolvers.apiCredentials(input)
        : routeAuthNotConfigured('API credential auth resolver is not configured');
    case 'session_principal':
      return resolvers.sessionPrincipal
        ? await resolvers.sessionPrincipal(input)
        : routeAuthNotConfigured('Session-principal auth resolver is not configured');
    default: {
      const plane = (input.route.auth as { plane?: unknown }).plane;
      return routeAuthNotConfigured(`Unsupported route auth plane: ${String(plane || 'unknown')}`);
    }
  }
}

export async function enforceRoutePolicy<
  TServices extends object = Record<string, unknown>,
>(input: {
  headers: HeaderRecord;
  logger: RouteExecutionContext<TServices>['logger'];
  request: RouteRequest;
  resolvers?: {
    apiCredentials?: RoutePolicyResolver<TServices>;
    sessionPrincipal?: RoutePolicyResolver<TServices>;
  };
  route: PolicyRoute;
  services?: TServices;
  sourceIp?: string;
}): Promise<EnforceRoutePolicyResult<TServices>> {
  const services = (input.services || {}) as TServices;
  const authResult = await resolveRoutePrincipal(input.resolvers || {}, {
    headers: input.headers,
    request: input.request,
    route: input.route,
    services,
    ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
  });
  if (!authResult.ok) {
    return {
      ok: false,
      status: authResult.status,
      body: { ok: false, code: authResult.code, message: authResult.message },
    };
  }
  return {
    ok: true,
    request: input.request,
    context: {
      headers: input.headers,
      logger: input.logger,
      principal: authResult.principal,
      services,
      ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
    },
  };
}
