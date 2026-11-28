import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { isPlainObject } from '@shared/utils/validation';
import { authFailure, type AuthFailure } from '../codes';

// The checks of a passkey: an assertion against a stored public key, and a registration. Both
// are pure. They read no store and write none. The Auth Worker calls them for a sign-in, and a
// server that pins the key of a method (the Wallet Gateway) calls the same assertion check.
//
// Each check requires user verification (a PIN, a biometric or a device passcode). The WebAuthn
// library throws on a missing flag before it checks the signature, so its own check is off and
// the code below refuses the missing flag after the signature verifies. Then
// `user_verification_required` means that user verification was the only fault.

/** The public key and the signature counter that a server stored for a passkey. */
export type StoredPasskeyKey = {
  readonly credentialIdB64u: string;
  /** The COSE public key from the registration. */
  readonly publicKeyB64u: string;
  readonly counter: number;
};

export type PasskeyCeremonyScope = {
  readonly rpId: string;
  /** The origins where a passkey ceremony can run: the account origin and its related origins. */
  readonly origins: readonly string[];
};

type AssertionFields = {
  readonly id: string;
  readonly clientDataJSON: string;
  readonly authenticatorData: string;
  readonly signature: string;
  readonly userHandle: string | undefined;
};

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function readAssertion(value: unknown): AssertionFields | null {
  if (!isPlainObject(value) || value.type !== 'public-key' || !isPlainObject(value.response)) {
    return null;
  }
  const { clientDataJSON, authenticatorData, signature, userHandle } = value.response;
  const id = isText(value.rawId) ? value.rawId : value.id;
  if (!isText(id) || !isText(clientDataJSON) || !isText(authenticatorData) || !isText(signature)) {
    return null;
  }
  return {
    id,
    clientDataJSON,
    authenticatorData,
    signature,
    userHandle: isText(userHandle) ? userHandle : undefined,
  };
}

/** The credential ID of an assertion, or null for a value that is not an assertion. */
export function assertionCredentialId(assertion: unknown): string | null {
  return readAssertion(assertion)?.id ?? null;
}

type CeremonyFailure = AuthFailure<
  | 'invalid_body'
  | 'invalid_origin'
  | 'invalid_proof'
  | 'unknown_credential'
  | 'user_verification_required'
>;

function clientDataOrigin(clientDataJSON: string): string | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(clientDataJSON)));
    return isPlainObject(parsed) && isText(parsed.origin) ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** A refusal for an origin that is not in the scope. It makes a wrong site its own code. */
function checkOrigin(clientDataJSON: string, scope: PasskeyCeremonyScope): CeremonyFailure | null {
  const origin = clientDataOrigin(clientDataJSON);
  if (!origin) return authFailure('invalid_body', 'clientDataJSON is not valid');
  return scope.origins.includes(origin) ? null : authFailure('invalid_origin');
}

/**
 * Checks a passkey assertion against the stored key: the origin, the RP ID, the challenge, the
 * signature, user presence, user verification and the counter. The caller stores `newCounter`.
 */
export async function verifyPasskeyAssertion(input: {
  readonly assertion: unknown;
  readonly scope: PasskeyCeremonyScope;
  readonly expectedChallengeB64u: string;
  readonly key: StoredPasskeyKey;
}): Promise<{ readonly ok: true; readonly newCounter: number } | CeremonyFailure> {
  const assertion = readAssertion(input.assertion);
  if (!assertion) return authFailure('invalid_body', 'The passkey assertion is not valid');
  if (assertion.id !== input.key.credentialIdB64u) return authFailure('unknown_credential');
  const wrongOrigin = checkOrigin(assertion.clientDataJSON, input.scope);
  if (wrongOrigin) return wrongOrigin;
  const response: AuthenticationResponseJSON = {
    id: assertion.id,
    rawId: assertion.id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
      ...(assertion.userHandle ? { userHandle: assertion.userHandle } : {}),
    },
  };
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: input.expectedChallengeB64u,
      expectedOrigin: [...input.scope.origins],
      expectedRPID: input.scope.rpId,
      credential: {
        id: input.key.credentialIdB64u,
        publicKey: base64UrlDecode(input.key.publicKeyB64u),
        counter: input.key.counter,
      },
      requireUserVerification: false,
    });
    if (!verification.verified) return authFailure('invalid_proof');
    if (verification.authenticationInfo.userVerified !== true) {
      return authFailure('user_verification_required');
    }
    return { ok: true, newCounter: verification.authenticationInfo.newCounter };
  } catch {
    return authFailure('invalid_proof');
  }
}

export type RegisteredPasskey = StoredPasskeyKey & {
  readonly aaguid: string;
  readonly backedUp: boolean;
  readonly transports: readonly string[];
};

/**
 * Checks a passkey registration: the ceremony type, the challenge, the origin, the RP ID, the
 * attestation, user presence and user verification. It returns the key to store.
 */
export async function verifyPasskeyRegistration(input: {
  readonly registration: unknown;
  readonly scope: PasskeyCeremonyScope;
  readonly expectedChallengeB64u: string;
}): Promise<({ readonly ok: true } & RegisteredPasskey) | CeremonyFailure> {
  const registration = input.registration;
  if (
    !isPlainObject(registration) ||
    registration.type !== 'public-key' ||
    !isPlainObject(registration.response) ||
    !isText(registration.response.clientDataJSON)
  ) {
    return authFailure('invalid_body', 'The passkey registration is not valid');
  }
  const wrongOrigin = checkOrigin(registration.response.clientDataJSON, input.scope);
  if (wrongOrigin) return wrongOrigin;
  try {
    const verification = await verifyRegistrationResponse({
      // The library checks the shape of the response and throws for a malformed one.
      response: registration as unknown as RegistrationResponseJSON,
      expectedChallenge: input.expectedChallengeB64u,
      expectedOrigin: [...input.scope.origins],
      expectedRPID: input.scope.rpId,
      requireUserVerification: false,
    });
    const info = verification.registrationInfo;
    if (!verification.verified || !info) return authFailure('invalid_proof');
    if (info.userVerified !== true) return authFailure('user_verification_required');
    return {
      ok: true,
      credentialIdB64u: info.credential.id,
      publicKeyB64u: base64UrlEncode(info.credential.publicKey),
      counter: info.credential.counter,
      aaguid: info.aaguid,
      backedUp: info.credentialBackedUp,
      transports: info.credential.transports ?? [],
    };
  } catch {
    return authFailure('invalid_proof');
  }
}
