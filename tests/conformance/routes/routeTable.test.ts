import { expect, test } from '@playwright/test';
import {
  createRouterApiRouteDefinitions,
  findRouteDefinitionForRequest,
} from '../../../packages/mpc-wallet-server/src/router/framework/routeDefinitions';

// The route table entries of the auth routes that move to the Auth Worker, and of the routes
// that seams-monorepo forwards or calls. Each keeps its ID, method, path and auth plane, so a
// new Worker's table can be compared entry by entry.

const AUTH_ROUTES = [
  ['relay_well_known_webauthn', 'GET', '/.well-known/webauthn', 'public'],
  ['auth_provider_action', 'POST', '/auth/:provider/:action', 'public'],
  ['auth_identities', 'GET', '/auth/identities', 'session_principal'],
  ['auth_link', 'POST', '/auth/link', 'session_principal'],
  ['auth_unlink', 'POST', '/auth/unlink', 'session_principal'],
  ['sync_account_options', 'POST', '/sync-account/options', 'public'],
  ['sync_account_verify', 'POST', '/sync-account/verify', 'public'],
  ['webauthn_authenticators', 'GET', '/webauthn/authenticators', 'session_principal'],
  ['wallet_email_otp_challenge', 'POST', '/wallet/email-otp/challenge', 'public'],
  ['wallet_email_otp_dev_outbox', 'POST', '/wallet/email-otp/dev/otp-outbox', 'public'],
  ['wallet_custody_credentials_list', 'POST', '/wallets/:walletId/custody/credentials', 'public'],
  ['wallet_registration_setup', 'POST', '/wallets/register/setup', 'api_credentials'],
] as const;

test('each auth route keeps its ID, method, path and auth plane', () => {
  const definitions = createRouterApiRouteDefinitions();
  for (const [id, method, path, plane] of AUTH_ROUTES) {
    const route = definitions.find((definition) => definition.id === id);
    expect(route, id).toBeDefined();
    expect({ id, method: route?.method, path: route?.path, plane: route?.auth.plane }).toEqual({
      id,
      method,
      path,
      plane,
    });
  }
});

test('the paths that seams-monorepo forwards resolve to these entries', () => {
  const definitions = createRouterApiRouteDefinitions();
  const forwarded = [
    ['POST', '/auth/passkey/options', 'auth_provider_action'],
    ['POST', '/auth/passkey/verify', 'auth_provider_action'],
    ['POST', '/auth/google/options', 'auth_provider_action'],
    ['POST', '/auth/google/verify', 'auth_provider_action'],
    ['GET', '/.well-known/webauthn/', 'relay_well_known_webauthn'],
    ['POST', '/sync-account/options', 'sync_account_options'],
    ['POST', '/sync-account/verify', 'sync_account_verify'],
    ['POST', '/wallet/email-otp/challenge', 'wallet_email_otp_challenge'],
    ['POST', '/wallet/email-otp/dev/otp-outbox', 'wallet_email_otp_dev_outbox'],
    ['POST', '/wallets/w-1/custody/credentials', 'wallet_custody_credentials_list'],
  ] as const;
  for (const [method, path, id] of forwarded) {
    expect(findRouteDefinitionForRequest(definitions, method, path)?.id, path).toBe(id);
  }
  // The registration setup route takes a publishable key with the accounts.create scope.
  const setup = definitions.find((definition) => definition.id === 'wallet_registration_setup');
  expect(setup?.auth).toMatchObject({
    plane: 'api_credentials',
    credentials: ['publishable_key'],
    scopes: ['accounts.create'],
  });
});
