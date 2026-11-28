import { hasExactKeys } from '@shared/utils/exactKeys';
import { isPlainObject } from '@shared/utils/validation';
import { AUTH_CODES, authFailure, isAuthCode } from '../codes';
import { parseAudience, parseChallenge } from '../proofs/audience';
import { parseAuthLocale } from './emailText';
import { parseFactorProof, parseIdentityProof } from './core';
import type { AuthService } from './service';

// The routes of the Auth Worker. Each route declares its plane, and the service shell
// (`packages/host`) checks the publishable key, the origin and the environment before it calls
// `handleAuthRoute`. A route of the key plane gets the project environment of the checked key.

type AuthRoutePolicy =
  | {
      readonly plane: 'api_credentials';
      readonly credentials: ['publishable_key'];
      readonly environmentBinding: 'required';
      readonly originBinding: 'required';
    }
  | { readonly plane: 'public'; readonly rationale: string };

const KEY_PLANE: AuthRoutePolicy = {
  plane: 'api_credentials',
  credentials: ['publishable_key'],
  environmentBinding: 'required',
  originBinding: 'required',
};

export const AUTH_JWKS_PATH = '/.well-known/jwks.json';

const KEY_ROUTES = {
  auth_sign_in_start: ['/v1/sign-in/start', 'Start a sign-in with a passkey or a device key'],
  auth_sign_in: ['/v1/sign-in', 'Sign in with the proof of a method'],
  auth_email_code_send: ['/v1/email-codes', 'Send an email code'],
  auth_prove: ['/v1/proofs', 'Prove a method to an audience and get a signed statement'],
  auth_account: ['/v1/account', 'Read the account and the methods of a login session'],
  auth_login_token: ['/v1/session/token', 'Get a new login token for a login session'],
  auth_sign_out: ['/v1/session/sign-out', 'End a login session'],
  auth_passkey_options: ['/v1/passkeys/options', 'Get the options of a passkey registration'],
  auth_passkey_register: ['/v1/passkeys', 'Store a registered passkey'],
  auth_method_change_start: ['/v1/methods/change', 'Start the add or the removal of a method'],
  auth_method_add_email: ['/v1/methods/email', 'Add an email address as a method'],
  auth_method_add_device_key: ['/v1/methods/device-key', 'Add a device key as a method'],
  auth_method_remove: ['/v1/methods/remove', 'Remove a method'],
} as const;

export type AuthRouteId = keyof typeof KEY_ROUTES;

export type AuthRouteDefinition = {
  readonly id: AuthRouteId | 'auth_jwks';
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly auth: AuthRoutePolicy;
  readonly summary: string;
};

function keyRoute(id: AuthRouteId): AuthRouteDefinition {
  const [path, summary] = KEY_ROUTES[id];
  return { id, method: 'POST', path, auth: KEY_PLANE, summary };
}

export const AUTH_ROUTES: readonly AuthRouteDefinition[] = [
  {
    id: 'auth_jwks',
    method: 'GET',
    path: AUTH_JWKS_PATH,
    auth: { plane: 'public', rationale: 'The public keys that check a token of this Worker.' },
    summary: 'The key set of the login token and the proof statement',
  },
  ...(Object.keys(KEY_ROUTES) as AuthRouteId[]).map(keyRoute),
];

export type AuthRouteRequest = {
  readonly body: unknown;
  /** The login session secret from the `x-seams-session` header, when the request has one. */
  readonly sessionToken: string | null;
  readonly sourceIp: string;
};

export type AuthRouteResponse = { readonly status: number; readonly body: object };

function answer(result: { readonly ok: boolean; readonly code?: unknown }): AuthRouteResponse {
  if (result.ok) return { status: 200, body: result };
  return { status: isAuthCode(result.code) ? AUTH_CODES[result.code].status : 500, body: result };
}

const INVALID_BODY = answer(authFailure('invalid_body'));

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined;
}

/** Runs one route of the key plane. The body is checked here; the service gets typed input. */
export async function handleAuthRoute(
  routeId: AuthRouteId,
  service: AuthService,
  request: AuthRouteRequest,
): Promise<AuthRouteResponse> {
  const body = request.body;
  if (!isPlainObject(body)) return INVALID_BODY;
  const sessionToken = request.sessionToken ?? undefined;
  switch (routeId) {
    case 'auth_sign_in_start':
      return answer(await service.startSignIn());
    case 'auth_sign_in': {
      const proof = parseFactorProof(body.proof) ?? parseIdentityProof(body.proof);
      if (!proof) return INVALID_BODY;
      return answer(
        await service.signIn({
          proof,
          challengeId: optionalText(body.challengeId),
          accountId: optionalText(body.accountId),
        }),
      );
    }
    case 'auth_email_code_send': {
      const audience = parseAudience(body.audience);
      const challenge = body.challenge === undefined ? undefined : parseChallenge(body.challenge);
      if (!audience || challenge === null) return INVALID_BODY;
      return answer(
        await service.sendEmailCode({
          audience,
          challenge,
          purpose: optionalText(body.purpose),
          email: optionalText(body.email),
          methodId: optionalText(body.methodId),
          sessionToken,
          locale: parseAuthLocale(body.locale),
          sourceIp: request.sourceIp,
        }),
      );
    }
    case 'auth_prove': {
      const audience = parseAudience(body.audience);
      const challenge = parseChallenge(body.challenge);
      const proof = parseFactorProof(body.proof);
      if (!hasExactKeys(body, ['audience', 'challenge', 'proof']) || !audience || !challenge) {
        return INVALID_BODY;
      }
      if (!proof) return INVALID_BODY;
      return answer(await service.prove({ audience, challenge, proof }));
    }
    case 'auth_account':
      return answer(await service.account(sessionToken));
    case 'auth_login_token':
      return answer(await service.loginToken(sessionToken));
    case 'auth_sign_out':
      return answer(await service.signOut(sessionToken));
    case 'auth_passkey_options':
      return answer(
        await service.passkeyOptions({ sessionToken, userName: optionalText(body.userName) }),
      );
    case 'auth_passkey_register': {
      const challengeId = optionalText(body.challengeId);
      if (!challengeId || !isPlainObject(body.registration)) return INVALID_BODY;
      return answer(
        await service.registerPasskey({
          challengeId,
          registration: body.registration,
          sessionToken,
        }),
      );
    }
    case 'auth_method_change_start':
      return answer(
        await service.startMethodChange({
          sessionToken,
          removeMethodId: optionalText(body.removeMethodId),
        }),
      );
    case 'auth_method_add_email': {
      const proof = parseFactorProof(body.proof);
      if (proof?.factor !== 'email_code') return INVALID_BODY;
      return answer(await service.addEmail({ sessionToken, proof }));
    }
    case 'auth_method_add_device_key': {
      const challengeId = optionalText(body.challengeId);
      const publicKeyB64u = optionalText(body.publicKeyB64u);
      const signatureB64u = optionalText(body.signatureB64u);
      if (!challengeId || !publicKeyB64u || !signatureB64u) return INVALID_BODY;
      return answer(
        await service.addDeviceKey({ sessionToken, challengeId, publicKeyB64u, signatureB64u }),
      );
    }
    case 'auth_method_remove': {
      const methodId = optionalText(body.methodId);
      const challengeId = optionalText(body.challengeId);
      const proof = parseFactorProof(body.proof);
      if (!methodId || !challengeId || !proof) return INVALID_BODY;
      return answer(await service.removeMethod({ sessionToken, methodId, challengeId, proof }));
    }
  }
}
