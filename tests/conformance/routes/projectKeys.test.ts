import { expect, test } from '@playwright/test';
import type {
  RouterApiKeyAuthResult,
  RouterApiPublishableKeyAuthResult,
  WalletRegistrationContextResult,
} from '../../../packages/mpc-wallet-server/src/router/framework/apiCredentialPorts';
import { resolveThresholdRuntimePolicyScope } from '../../../packages/mpc-wallet-server/src/router/auth/commonRouterUtils';
import {
  resolvePublishableKeyApiCredentialAuth,
  resolveSecretKeyApiCredentialAuth,
  resolveWalletRegistrationContext,
} from '../../../packages/mpc-wallet-server/src/router/auth/routerApiCredentialAuth';
import {
  extractBearerCredential,
  extractRouterApiEnvironmentId,
} from '../../../packages/mpc-wallet-server/src/router/auth/routerApiKeyAuth';
import {
  createRouterApiRouteDefinitions,
  defineRoute,
  findRouteDefinitionById,
} from '../../../packages/mpc-wallet-server/src/router/framework/routeDefinitions';
import { APP_ORIGIN, recordedCalls } from './routeHarness';

// The publishable key, origin and environment checks, the secret key check, and the login
// scope check. seams-monorepo calls the first two through @seams/host/cloud-host, and
// its key store returns the adapter codes used below.

const ENVIRONMENT_ID = 'project-1:production';
const PRINCIPAL = {
  apiKeyId: 'key-1',
  orgId: 'org-1',
  environmentId: ENVIRONMENT_ID,
  scopes: ['accounts.create' as const],
};

function routeById(id: string) {
  const route = findRouteDefinitionById(createRouterApiRouteDefinitions(), id);
  if (!route) throw new Error(`route ${id} is missing`);
  return route;
}

const REGISTRATION_SETUP = routeById('wallet_registration_setup');
const WELL_KNOWN = routeById('relay_well_known_webauthn');
const SECRET_KEY_ROUTE = defineRoute({
  id: 'conformance_secret_key_wallets',
  surface: 'relay',
  method: 'GET',
  path: '/v1/wallets',
  auth: { plane: 'api_credentials', credentials: ['secret_key'], scopes: ['wallets.read'] },
  metering: { kind: 'none' },
  summary: 'A secret-key route as seams-monorepo defines it',
});

function publishableKeyInput(
  overrides: { headers?: Record<string, string>; origin?: string; environmentId?: string } = {},
) {
  return {
    environmentId: ENVIRONMENT_ID,
    headers: { authorization: 'Bearer pk_live_1' },
    origin: APP_ORIGIN,
    route: REGISTRATION_SETUP,
    missingEnvironmentMessage: 'environment missing',
    missingOriginMessage: 'origin missing',
    missingPublishableKeyMessage: 'key missing',
    routeAuthNotConfiguredMessage: 'route not configured',
    ...overrides,
  };
}

function publishableKeyAuth(result: RouterApiPublishableKeyAuthResult) {
  const authenticate = recordedCalls(result);
  return { publishableKeyAuth: { authenticate: authenticate.answer }, calls: authenticate.calls };
}

test('the publishable key check refuses before it calls the key store', async () => {
  const store = publishableKeyAuth({ ok: true, principal: PRINCIPAL });
  const cases = [
    [
      publishableKeyInput({ headers: {} }),
      { status: 401, code: 'unauthorized', message: 'publishable_key_missing: key missing' },
    ],
    [
      publishableKeyInput({ headers: { authorization: 'Basic pk_live_1' } }),
      { status: 401, code: 'unauthorized', message: 'publishable_key_missing: key missing' },
    ],
    [
      publishableKeyInput({ origin: ' ' }),
      { status: 403, code: 'forbidden', message: 'publishable_key_origin_blocked: origin missing' },
    ],
    [
      publishableKeyInput({ environmentId: '' }),
      {
        status: 403,
        code: 'forbidden',
        message: 'publishable_key_environment_mismatch: environment missing',
      },
    ],
    [
      { ...publishableKeyInput(), route: WELL_KNOWN },
      { status: 500, code: 'route_auth_not_configured', message: 'route not configured' },
    ],
  ] as const;
  for (const [input, refusal] of cases) {
    expect(await resolvePublishableKeyApiCredentialAuth({ ...input, ...store })).toEqual({
      ok: false,
      ...refusal,
    });
  }
  expect(store.calls).toEqual([]);
});

test('a key store refusal keeps its status, and its code leads the message', async () => {
  const refusals = [
    [401, 'publishable_key_invalid', 'unauthorized'],
    [403, 'publishable_key_revoked', 'forbidden'],
    [403, 'publishable_key_origin_blocked', 'forbidden'],
    [403, 'publishable_key_environment_mismatch', 'forbidden'],
  ] as const;
  for (const [status, storeCode, code] of refusals) {
    const store = publishableKeyAuth({ ok: false, status, code: storeCode, message: 'refused' });
    expect(
      await resolvePublishableKeyApiCredentialAuth({ ...publishableKeyInput(), ...store }),
    ).toEqual({ ok: false, status, code, message: `${storeCode}: refused` });
  }
});

test('an accepted publishable key becomes the route principal', async () => {
  const store = publishableKeyAuth({ ok: true, principal: PRINCIPAL });
  expect(
    await resolvePublishableKeyApiCredentialAuth({ ...publishableKeyInput(), ...store }),
  ).toEqual({
    ok: true,
    principal: { kind: 'api_credentials', credentialType: 'publishable_key', principal: PRINCIPAL },
  });
  expect(store.calls).toEqual([
    { secret: 'pk_live_1', origin: APP_ORIGIN, environmentId: ENVIRONMENT_ID },
  ]);
});

test('registration setup makes the same refusals before it resolves its context', async () => {
  const resolve = recordedCalls<WalletRegistrationContextResult>({
    ok: false,
    status: 403,
    code: 'publishable_key_revoked',
    message: 'revoked',
  });
  const registrationContext = { resolve: resolve.answer };
  const registration = { kind: 'conformance' } as never;
  expect(
    await resolveWalletRegistrationContext({
      ...publishableKeyInput({ origin: '' }),
      registrationContext,
      registration,
    }),
  ).toEqual({
    ok: false,
    status: 403,
    code: 'forbidden',
    message: 'publishable_key_origin_blocked: origin missing',
  });
  expect(resolve.calls).toEqual([]);
  await resolveWalletRegistrationContext({
    ...publishableKeyInput(),
    registrationContext,
    registration,
  });
  expect(resolve.calls).toEqual([
    { secret: 'pk_live_1', origin: APP_ORIGIN, environmentId: ENVIRONMENT_ID, registration },
  ]);
});

test('the secret key check names the route scopes, the environment and the source IP', async () => {
  const authenticate = recordedCalls<RouterApiKeyAuthResult>(
    { ok: false, status: 403, code: 'secret_key_forbidden_scope', message: 'scope' },
    { ok: true, principal: PRINCIPAL },
  );
  const base = {
    route: SECRET_KEY_ROUTE,
    routeAuthNotConfiguredMessage: 'secret key auth missing',
    apiKeyAuth: { authenticate: authenticate.answer },
  };
  expect(await resolveSecretKeyApiCredentialAuth({ ...base, headers: {} })).toEqual({
    ok: false,
    status: 401,
    code: 'unauthorized',
    message: 'secret_key_missing: Missing secret key',
  });
  expect(
    await resolveSecretKeyApiCredentialAuth({ ...base, apiKeyAuth: null, headers: {} }),
  ).toEqual({
    ok: false,
    status: 500,
    code: 'route_auth_not_configured',
    message: 'secret key auth missing',
  });

  const headers = { authorization: 'Bearer sk_live_1', 'x-environment-id': ENVIRONMENT_ID };
  expect(
    await resolveSecretKeyApiCredentialAuth({ ...base, headers, sourceIp: '192.0.2.1' }),
  ).toEqual({
    ok: false,
    status: 403,
    code: 'forbidden',
    message: 'secret_key_forbidden_scope: scope',
  });
  expect(await resolveSecretKeyApiCredentialAuth({ ...base, headers })).toEqual({
    ok: true,
    principal: { kind: 'api_credentials', credentialType: 'secret_key', principal: PRINCIPAL },
  });
  expect(authenticate.calls).toEqual([
    {
      secret: 'sk_live_1',
      endpoint: 'GET /v1/wallets',
      requiredScopes: ['wallets.read'],
      sourceIp: '192.0.2.1',
      environmentId: ENVIRONMENT_ID,
    },
    {
      secret: 'sk_live_1',
      endpoint: 'GET /v1/wallets',
      requiredScopes: ['wallets.read'],
      environmentId: ENVIRONMENT_ID,
    },
  ]);
});

test('the header reads take a Bearer credential and prefer x-seams-environment-id', () => {
  expect(extractBearerCredential({ authorization: '  bEaReR  pk_1  ' })).toBe('pk_1');
  expect(extractBearerCredential(new Headers({ Authorization: 'Bearer pk_2' }))).toBe('pk_2');
  expect(extractBearerCredential({ authorization: ['Bearer pk_3', 'Bearer pk_4'] })).toBe('pk_3');
  expect(extractBearerCredential({ authorization: 'Bearer ' })).toBeNull();
  expect(extractBearerCredential({ authorization: 'pk_5' })).toBeNull();
  expect(
    extractRouterApiEnvironmentId({ 'x-seams-environment-id': 'a', 'x-environment-id': 'b' }),
  ).toBe('a');
  expect(extractRouterApiEnvironmentId({ 'x-environment-id': 'b' })).toBe('b');
  expect(extractRouterApiEnvironmentId({})).toBeNull();
});

function loginScopeInput(overrides: Record<string, unknown> = {}) {
  const authenticate = recordedCalls<RouterApiPublishableKeyAuthResult>({
    ok: true,
    principal: PRINCIPAL,
  });
  return {
    calls: authenticate.calls,
    input: {
      explicitScopeRaw: undefined,
      projectEnvironmentIdRaw: ENVIRONMENT_ID,
      headers: { authorization: 'Bearer pk_live_1' },
      origin: APP_ORIGIN,
      publishableKeyAuth: { authenticate: authenticate.answer },
      orgProjectEnv: {
        listEnvironments: async () => [
          {
            id: ENVIRONMENT_ID,
            projectId: 'project-1',
            key: 'production',
            signingRootVersion: 'v1',
          },
        ],
      },
      ...overrides,
    },
  };
}

test('the login scope needs no key when the request names no environment', async () => {
  const { input, calls } = loginScopeInput({ projectEnvironmentIdRaw: undefined, headers: {} });
  expect(await resolveThresholdRuntimePolicyScope(input)).toEqual({ ok: true });
  expect(calls).toEqual([]);
});

test('the login scope refuses an environment with no key, no Origin or no key check', async () => {
  const cases = [
    [
      { headers: {} },
      {
        status: 401,
        code: 'unauthorized',
        message: 'Managed runtime scope bootstrap requires a publishable key',
      },
    ],
    [
      { origin: null },
      {
        status: 403,
        code: 'forbidden',
        message: 'Managed runtime scope bootstrap requires an Origin header',
      },
    ],
    [
      { publishableKeyAuth: null },
      {
        status: 500,
        code: 'route_auth_not_configured',
        message: 'Runtime scope bootstrap requires publishable key auth on this server',
      },
    ],
  ] as const;
  for (const [overrides, refusal] of cases) {
    const { input, calls } = loginScopeInput(overrides);
    expect(await resolveThresholdRuntimePolicyScope(input)).toEqual({ ok: false, ...refusal });
    expect(calls).toEqual([]);
  }
});

test('the login scope comes from the key principal, and a refusal keeps only its message', async () => {
  const accepted = loginScopeInput({ projectEnvironmentIdRaw: undefined });
  expect(await resolveThresholdRuntimePolicyScope(accepted.input)).toEqual({
    ok: true,
    scope: {
      orgId: 'org-1',
      projectId: 'project-1',
      envId: 'production',
      signingRootVersion: 'v1',
    },
  });
  // With no environment in the request, the key's own environment decides.
  expect(accepted.calls).toEqual([{ secret: 'pk_live_1', origin: APP_ORIGIN, environmentId: '' }]);

  const unknownEnvironment = loginScopeInput({
    orgProjectEnv: { listEnvironments: async () => [] },
  });
  expect(await resolveThresholdRuntimePolicyScope(unknownEnvironment.input)).toEqual({ ok: true });

  const refused = recordedCalls<RouterApiPublishableKeyAuthResult>({
    ok: false,
    status: 403,
    code: 'publishable_key_environment_mismatch',
    message: 'wrong environment',
  });
  const { input } = loginScopeInput({ publishableKeyAuth: { authenticate: refused.answer } });
  expect(await resolveThresholdRuntimePolicyScope(input)).toEqual({
    ok: false,
    status: 403,
    code: 'forbidden',
    message: 'wrong environment',
  });
});
