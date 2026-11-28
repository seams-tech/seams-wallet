import { extractBearerCredential, readRequestHeader } from '@shared/utils/requestHeaders';
import type {
  RouterApiKeyAuthAdapter,
  RouterApiKeyPrincipal,
  RegistrationContextResolver,
  RegistrationContextResult,
  RouterApiPublishableKeyAuthAdapter,
  RouterApiPublishableKeyAuthFailureCode,
  RouterApiPublishableKeyAuthRequest,
} from './ports';
import {
  routeAuthNotConfigured,
  type PolicyRoute,
  type RoutePolicyResolutionFailure,
  type RoutePolicyResolutionResult,
} from './routePolicy';

// The checks of a publishable key (with its origin and its environment) and of a secret key
// (with the scopes of the route). Each service calls the key store through these functions.

type HeaderBag = Parameters<typeof extractBearerCredential>[0];

export function extractRouterApiEnvironmentId(headers: HeaderBag): string | null {
  return (
    readRequestHeader(headers, 'x-seams-environment-id') ||
    readRequestHeader(headers, 'x-environment-id') ||
    null
  );
}

export type PublishableKeyRequestRefusal = {
  readonly ok: false;
  readonly status: 401 | 403;
  readonly code: Extract<
    RouterApiPublishableKeyAuthFailureCode,
    | 'publishable_key_missing'
    | 'publishable_key_origin_blocked'
    | 'publishable_key_environment_mismatch'
  >;
};

/**
 * Reads the key, the origin and the environment of a request. It refuses a request that has no
 * key or no origin before any call to the key store. `environment: 'cross_check'` accepts a
 * request that names no environment: the key's own record then decides, and the store compares
 * the environment only when the request names one.
 */
export function readPublishableKeyRequest(input: {
  headers: HeaderBag;
  origin?: string | null;
  environmentId?: string | null;
  environment: 'required' | 'cross_check';
}): { ok: true; request: RouterApiPublishableKeyAuthRequest } | PublishableKeyRequestRefusal {
  const secret = extractBearerCredential(input.headers);
  if (!secret) return { ok: false, status: 401, code: 'publishable_key_missing' };
  const origin = String(input.origin || '').trim();
  if (!origin) return { ok: false, status: 403, code: 'publishable_key_origin_blocked' };
  const environmentId = String(input.environmentId || '').trim();
  if (!environmentId && input.environment === 'required') {
    return { ok: false, status: 403, code: 'publishable_key_environment_mismatch' };
  }
  return { ok: true, request: { secret, origin, environmentId } };
}

export function keyRefusalCode(status: 401 | 403): 'unauthorized' | 'forbidden' {
  return status === 403 ? 'forbidden' : 'unauthorized';
}

interface PublishableKeyRouteInput {
  environmentId?: string | null;
  headers: HeaderBag;
  missingEnvironmentMessage: string;
  missingOriginMessage: string;
  missingPublishableKeyMessage: string;
  origin?: string;
  route: PolicyRoute;
  routeAuthNotConfiguredMessage: string;
}

/** The same refusals for each route that takes a publishable key, with the caller's wording. */
function readPublishableKeyRouteRequest(
  input: PublishableKeyRouteInput,
): { ok: true; request: RouterApiPublishableKeyAuthRequest } | RoutePolicyResolutionFailure {
  if (input.route.auth.plane !== 'api_credentials') {
    return routeAuthNotConfigured(input.routeAuthNotConfiguredMessage);
  }
  const parsed = readPublishableKeyRequest({ ...input, environment: 'required' });
  if (parsed.ok) return parsed;
  const messages = {
    publishable_key_missing: input.missingPublishableKeyMessage,
    publishable_key_origin_blocked: input.missingOriginMessage,
    publishable_key_environment_mismatch: input.missingEnvironmentMessage,
  };
  return {
    ok: false,
    status: parsed.status,
    code: keyRefusalCode(parsed.status),
    message: `${parsed.code}: ${messages[parsed.code]}`,
  };
}

function keyStoreAnswer(
  credentialType: 'publishable_key' | 'secret_key',
  result:
    | { ok: true; principal: RouterApiKeyPrincipal }
    | { ok: false; status: 401 | 403; code: string; message: string },
): RoutePolicyResolutionResult {
  if (result.ok) {
    return {
      ok: true,
      principal: { kind: 'api_credentials', credentialType, principal: result.principal },
    };
  }
  return {
    ok: false,
    status: result.status,
    code: keyRefusalCode(result.status),
    message: `${result.code}: ${result.message}`,
  };
}

export async function resolvePublishableKeyApiCredentialAuth(
  input: PublishableKeyRouteInput & { publishableKeyAuth: RouterApiPublishableKeyAuthAdapter },
): Promise<RoutePolicyResolutionResult> {
  const parsed = readPublishableKeyRouteRequest(input);
  if (!parsed.ok) return parsed;
  return keyStoreAnswer(
    'publishable_key',
    await input.publishableKeyAuth.authenticate(parsed.request),
  );
}

/** The route principal of a publishable key that a registration context already checked. */
export async function publishableKeyRoutePrincipal(
  principal: RouterApiKeyPrincipal,
): Promise<RoutePolicyResolutionResult> {
  return keyStoreAnswer('publishable_key', { ok: true, principal });
}

export async function resolveRegistrationContext<TRegistration>(
  input: PublishableKeyRouteInput & {
    registrationContext: RegistrationContextResolver<TRegistration>;
    registration: TRegistration;
  },
): Promise<RegistrationContextResult | RoutePolicyResolutionFailure> {
  const parsed = readPublishableKeyRouteRequest(input);
  if (!parsed.ok) return parsed;
  return input.registrationContext.resolve({ ...parsed.request, registration: input.registration });
}

export async function resolveSecretKeyApiCredentialAuth(input: {
  apiKeyAuth?: RouterApiKeyAuthAdapter | null;
  headers: HeaderBag;
  route: PolicyRoute;
  sourceIp?: string;
  routeAuthNotConfiguredMessage: string;
}): Promise<RoutePolicyResolutionResult> {
  if (input.route.auth.plane !== 'api_credentials' || !input.apiKeyAuth) {
    return routeAuthNotConfigured(input.routeAuthNotConfiguredMessage);
  }
  const credential = extractBearerCredential(input.headers);
  if (!credential) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'secret_key_missing: Missing secret key',
    };
  }
  const environmentId = extractRouterApiEnvironmentId(input.headers);
  return keyStoreAnswer(
    'secret_key',
    await input.apiKeyAuth.authenticate({
      secret: credential,
      endpoint: `${input.route.method} ${input.route.path}`,
      requiredScopes: [...(input.route.auth.scopes || [])],
      ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
      ...(environmentId ? { environmentId } : {}),
    }),
  );
}
