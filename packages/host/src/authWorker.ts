import {
  extractBearerCredential,
  resolveSourceIpFromFetchHeaders,
} from '@shared/utils/requestHeaders';
import {
  AUTH_ROUTES,
  handleAuthRoute,
  type AuthRouteDefinition,
} from '../../auth/src/worker/routes';
import {
  AuthService,
  type AuthServiceConfig,
  type AuthServicePorts,
} from '../../auth/src/worker/service';
import { extractRouterApiEnvironmentId, resolveRegistrationContext } from './credentials/keyChecks';
import type {
  RouterApiProjectEnvironmentResolver,
  RouterApiPublishableKeyAuthAdapter,
} from './credentials/ports';
import { createWalletRegistrationContextResolver } from './credentials/registrationContext';

// The Auth Worker: the routes of the auth module behind the project credential checks. This
// file checks the publishable key, the two origins and the environment. Then it calls the
// module with the project environment of the checked key.

export type AuthWorkerDependencies = {
  readonly config: AuthServiceConfig;
  readonly ports: AuthServicePorts;
  readonly publishableKeyAuth: RouterApiPublishableKeyAuthAdapter;
  readonly projectEnvironments: RouterApiProjectEnvironmentResolver;
};

/** The account origin names the app page that embeds it in this header. */
const APP_ORIGIN_HEADER = 'x-seams-app-origin';
const SESSION_HEADER = 'x-seams-session';
const CORS_HEADERS = `authorization, content-type, x-seams-environment-id, ${SESSION_HEADER}, ${APP_ORIGIN_HEADER}`;

function json(status: number, body: object, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function refusal(status: number, code: string, message: string, headers: Record<string, string>) {
  return json(status, { ok: false, code, message }, headers);
}

export function createAuthWorkerHandler(
  dependencies: AuthWorkerDependencies,
): (request: Request) => Promise<Response> {
  const { config, ports, publishableKeyAuth } = dependencies;
  const registrationContext = createWalletRegistrationContextResolver(
    publishableKeyAuth,
    dependencies.projectEnvironments,
  );

  /** Only the account origin reads an answer of a key route. Each other site gets no CORS header. */
  function corsHeaders(origin: string): Record<string, string> {
    if (!config.passkeys.origins.includes(origin)) return { 'cache-control': 'no-store' };
    return {
      'cache-control': 'no-store',
      'access-control-allow-origin': origin,
      vary: 'origin',
    };
  }

  async function handleKeyRoute(
    route: AuthRouteDefinition & { id: Exclude<AuthRouteDefinition['id'], 'auth_jwks'> },
    request: Request,
    origin: string,
  ): Promise<Response> {
    const headers = corsHeaders(origin);
    const context = await resolveRegistrationContext({
      environmentId: extractRouterApiEnvironmentId(request.headers),
      headers: request.headers,
      missingEnvironmentMessage: 'Environment header is required',
      missingOriginMessage: 'Origin header is required',
      missingPublishableKeyMessage: 'Missing publishable key',
      origin,
      registrationContext,
      registration: null,
      route,
      routeAuthNotConfiguredMessage: 'This route requires a publishable key',
    });
    if (!context.ok) return refusal(context.status, context.code, context.message, headers);
    // The key must also allow the app page that embeds the account origin.
    const appOrigin = (request.headers.get(APP_ORIGIN_HEADER) || '').trim();
    const forApp = appOrigin
      ? await publishableKeyAuth.authenticate({
          secret: extractBearerCredential(request.headers) ?? '',
          origin: appOrigin,
          environmentId: context.environment.id,
        })
      : null;
    if (!forApp?.ok || forApp.principal.apiKeyId !== context.principal.apiKeyId) {
      return refusal(
        403,
        'forbidden',
        'publishable_key_origin_blocked: The app origin is not allowed for this key',
        headers,
      );
    }
    const service = new AuthService(config, ports, {
      orgId: context.principal.orgId,
      projectId: context.environment.projectId,
      envId: context.environment.key,
    });
    const response = await handleAuthRoute(route.id, service, {
      body: await request.json().catch(() => null),
      sessionToken: request.headers.get(SESSION_HEADER),
      sourceIp: resolveSourceIpFromFetchHeaders(request.headers) ?? '',
    });
    return json(response.status, response.body, headers);
  }

  return async function handleAuthWorkerRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = (request.headers.get('origin') || '').trim();
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': CORS_HEADERS,
          'access-control-max-age': '600',
        },
      });
    }
    const route = AUTH_ROUTES.find(
      (candidate) => candidate.method === request.method && candidate.path === url.pathname,
    );
    if (!route) return refusal(404, 'not_found', 'No such route', { 'cache-control': 'no-store' });
    if (route.id === 'auth_jwks') {
      return json(200, config.jwks, {
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*',
      });
    }
    try {
      return await handleKeyRoute({ ...route, id: route.id }, request, origin);
    } catch {
      return refusal(500, 'internal', 'The request failed', corsHeaders(origin));
    }
  };
}
