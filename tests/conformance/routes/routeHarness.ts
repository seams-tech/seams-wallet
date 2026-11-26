import {
  buildFullOwnerPermissionsV1,
  buildSigningOnlyDelegatedWalletAuthorityV1,
} from '../../../packages/shared-ts/src/authorization/delegatedAuthority';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import type { RouterApiServiceBag } from '../../../packages/mpc-wallet-server/src/router/framework/authServicePort';
import type { RouterApiOptions } from '../../../packages/mpc-wallet-server/src/router/framework/routerApi';
import { createFetchRouter } from '../../../packages/mpc-wallet-server/src/router/transport/fetch/createFetchRouter';

/** The app origin that calls the Wallet Gateway in these checks. */
export const APP_ORIGIN = 'https://app.example.test';
export const WALLET_ID = 'conformance-wallet-1';
export const WALLET_AUTH_METHOD_ID = 'wallet-auth-method-1';
export const WALLET_AUTHORITY_ID = 'wallet-authority-1';
export const OWNER_SESSION_TOKEN = 'owner-session-token';
export const SIGNING_ONLY_SESSION_TOKEN = 'signing-only-session-token';

/** A WebAuthn assertion with the fields the route parsers require. Its bytes are not checked. */
export function webAuthnAssertion(credentialIdB64u = 'Y3JlZGVudGlhbC0x') {
  return {
    id: credentialIdB64u,
    rawId: credentialIdB64u,
    type: 'public-key',
    response: {
      clientDataJSON: 'Y2xpZW50LWRhdGE',
      authenticatorData: 'YXV0aGVudGljYXRvcg',
      signature: 'c2lnbmF0dXJl',
      userHandle: null,
    },
  };
}

type ServiceFakes = { readonly [Name in keyof RouterApiServiceBag]?: object };

/**
 * Wallet Sessions that the fake session service resolves: one full-owner session and one
 * signing-only session, both for WALLET_ID. Other tokens resolve to no session.
 */
function fakeWalletSessions(tenantId: string) {
  const contexts = new Map([
    [OWNER_SESSION_TOKEN, buildFullOwnerPermissionsV1()],
    [SIGNING_ONLY_SESSION_TOKEN, buildSigningOnlyDelegatedWalletAuthorityV1().permissions],
  ]);
  return {
    tenantId,
    async readWalletSessionAuthorizationV2ByOperationCredential(input: { token: string }) {
      const permissions = contexts.get(input.token);
      if (!permissions) return null;
      return {
        authorization: { session: { walletId: WALLET_ID } },
        authority: { authorityId: WALLET_AUTHORITY_ID, permissions },
        authMethod: { walletAuthMethodId: WALLET_AUTH_METHOD_ID },
      };
    },
  };
}

/**
 * Builds today's fetch router with fake services. A check passes only the services that its
 * route calls; a call to a missing method fails inside the router and returns a 500.
 */
export function routerWith(services: ServiceFakes, options: RouterApiOptions = {}) {
  const tenantId = 'conformance-tenant';
  const bag = {
    authorizationSessions: fakeWalletSessions(tenantId),
    authorizedOperations: { tenantId },
    ...services,
  };
  // The fakes implement only the methods each route calls, so the full bag type does not fit.
  const router = createFetchRouter(bag as unknown as RouterApiServiceBag, options, {
    kind: 'inline',
  });
  type RequestInit = { body?: unknown; headers?: Record<string, string> };
  async function send(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    return await router(
      new Request(`https://gateway.example.test${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...init.headers },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );
  }
  return {
    send,
    async call(
      method: string,
      path: string,
      init: RequestInit = {},
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const response = await send(method, path, init);
      const body: unknown = await response.json();
      if (!isPlainObject(body)) throw new Error(`${method} ${path} did not return a JSON object`);
      return { status: response.status, body };
    },
  };
}

/** Records each call to a fake service method, and answers with the given results in order. */
export function recordedCalls<Result>(...results: Result[]) {
  const calls: unknown[] = [];
  return {
    calls,
    async answer(input: unknown): Promise<Result> {
      calls.push(input);
      const result = results[Math.min(calls.length, results.length) - 1];
      if (result === undefined) throw new Error('No fake result for this call');
      return result;
    },
  };
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, origin: APP_ORIGIN };
}
