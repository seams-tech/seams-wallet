import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { base64UrlEncode } from '@shared/utils/encoders';
import { errorMessage } from '@shared/utils/errors';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import {
  PASSKEY_USER_VERIFICATION_REQUIRED_CODE,
  PASSKEY_USER_VERIFICATION_REQUIRED_MESSAGE,
} from '@shared/utils/passkeyUserVerification';
import type { WebAuthnRpId } from '@shared/utils/domainIds';
import type { ThresholdEd25519AuthorityScope } from '../types';
import type { NormalizedLogger } from '../logger';
import type {
  WebAuthnAuthenticatorRecord,
  WebAuthnAuthenticatorStore,
} from '../WebAuthnAuthenticatorStore';
import type { WebAuthnAuthenticationCredential } from '../types';
import { type ResolvedEd25519WalletBinding } from './webauthnWalletBinding';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import { failure } from '@shared/utils/failure';
import {
  decodeBase64UrlOrBase64,
  isHostWithinRpId,
  originHostnameOrEmpty,
  parseClientDataJsonBase64url,
} from './webauthnOidcHelpers';
import { webAuthnCredentialIdB64uFromCredential } from '../../router/auth/webAuthnCredentialCodecs';

/*
 * This file is the one place the server checks a passkey ceremony with
 * SimpleWebAuthn. Every registration and every assertion requires user
 * verification (UV): a PIN, a biometric or a device passcode.
 *
 * SimpleWebAuthn can enforce UV itself, but it throws on a missing UV flag
 * before it checks the signature. So each library call turns its own UV check
 * off, and the code refuses a missing flag after the rest of the ceremony
 * verifies. Then `user_verification_required` means that UV was the only fault.
 */

type WebAuthnCeremonyFailure = { ok: false; code: string; message: string };

type VerifiedPasskeyRegistration = {
  ok: true;
  credential: {
    credentialIdB64u: string;
    credentialPublicKeyB64u: string;
    counter: number;
  };
  /** What the verified attestation says about the authenticator, for its device record. */
  authenticator: {
    aaguid: string;
    backedUp: boolean;
    transports: string[];
  };
};

/** The key and counter the server stored for a passkey at registration. */
type StoredPasskeyKey = {
  readonly credentialPublicKeyB64u: string;
  readonly counter: number;
};

type VerifiedPasskeyAssertion<A extends StoredPasskeyKey> = {
  ok: true;
  credentialIdB64u: string;
  authenticator: A;
  /** The counter the assertion signed. The caller stores it with the rest of its writes. */
  newCounter: number;
};

type WebAuthnAuthenticationLiteResult = {
  success: boolean;
  verified: boolean;
  code?: string;
  message?: string;
};

export type WebAuthnSyncAccountVerificationResult =
  | {
      ok: true;
      verified: true;
      accountId: string;
      walletId: string;
      nearAccountId: string;
      nearEd25519SigningKeyId: string;
      /** The manifest recorded on this wallet's Ed25519 signer at registration. */
      custodyKeyManifestDigestB64u: DigestB64u;
      walletBinding: ResolvedEd25519WalletBinding;
      rpId: string;
      signerSlot: number;
      publicKey: string;
      relayerKeyId?: string;
      credentialIdB64u: string;
      credentialPublicKeyB64u: string;
      thresholdEd25519?: {
        relayerKeyId: string;
        authorityScope: ThresholdEd25519AuthorityScope;
        publicKey: string;
        keyVersion?: string;
        recoveryExportCapable?: boolean;
        clientParticipantId?: number;
        relayerParticipantId?: number;
        participantIds?: number[];
      };
    }
  | {
      ok: false;
      verified?: false;
      code: string;
      message: string;
    };

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : '';
}

/* Loaded on first use, so a runtime that never checks a passkey does not load the verifier. */
async function loadSimpleWebAuthnServer(): Promise<typeof import('@simplewebauthn/server')> {
  try {
    return await import('@simplewebauthn/server');
  } catch (e: unknown) {
    throw new Error(
      `Server WebAuthn route selected but '@simplewebauthn/server' dependency is not available: ${
        errorMessage(e) || 'import failed'
      }`,
    );
  }
}

function userVerificationRequired(): WebAuthnCeremonyFailure {
  return failure(
    PASSKEY_USER_VERIFICATION_REQUIRED_CODE,
    PASSKEY_USER_VERIFICATION_REQUIRED_MESSAGE,
  );
}

function credentialPublicKeyBytes(
  record: StoredPasskeyKey,
): { ok: true; bytes: Uint8Array<ArrayBuffer> } | WebAuthnCeremonyFailure {
  try {
    return {
      ok: true,
      bytes: decodeBase64UrlOrBase64(
        record.credentialPublicKeyB64u,
        'authenticator.credentialPublicKeyB64u',
      ),
    };
  } catch (e: unknown) {
    return failure(
      'internal',
      `Stored credential public key is invalid: ${errorMessage(e) || 'decode failed'}`,
    );
  }
}

function authenticationResponseJson(
  credential: WebAuthnAuthenticationCredential,
): AuthenticationResponseJSON {
  return {
    id: credential.id,
    rawId: credential.rawId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: credential.response.clientDataJSON,
      authenticatorData: credential.response.authenticatorData,
      signature: credential.response.signature,
      ...(credential.response.userHandle === null
        ? {}
        : { userHandle: credential.response.userHandle }),
    },
  };
}

/**
 * Checks a passkey assertion against the key the server stored for it: the
 * origin, the RP ID, the challenge, the signature, user presence, user
 * verification and the counter. It writes nothing; the caller stores
 * `newCounter` together with the rest of its writes.
 */
export async function verifyPasskeyAssertion<A extends StoredPasskeyKey>(input: {
  readonly credential: WebAuthnAuthenticationCredential;
  readonly rpId: WebAuthnRpId;
  readonly expectedChallenge: string;
  readonly expectedOrigin: string;
  /** The stored key of the asserted credential, or null when the user has no such credential. */
  readonly readAuthenticator: (credentialIdB64u: string) => Promise<A | null>;
}): Promise<VerifiedPasskeyAssertion<A> | WebAuthnCeremonyFailure> {
  const { credential } = input;
  if (credential.type !== 'public-key') {
    return failure('invalid_body', 'webauthn_authentication.type must be public-key');
  }
  let clientData: { challenge: string; origin: string; type: string };
  try {
    clientData = parseClientDataJsonBase64url(credential.response.clientDataJSON);
  } catch (e: unknown) {
    return failure(
      'invalid_body',
      errorMessage(e) || 'Invalid webauthn_authentication.response.clientDataJSON',
    );
  }
  if (!isHostWithinRpId(originHostnameOrEmpty(clientData.origin), input.rpId)) {
    return failure('invalid_origin', 'WebAuthn origin is not within rpId');
  }

  const credentialId = webAuthnCredentialIdB64uFromCredential(credential);
  if (!credentialId.ok) return credentialId;
  const authenticator = await input.readAuthenticator(credentialId.credentialIdB64u);
  if (!authenticator) {
    return failure('unknown_credential', 'Credential is not registered for user');
  }
  const publicKey = credentialPublicKeyBytes(authenticator);
  if (!publicKey.ok) return publicKey;

  const { verifyAuthenticationResponse } = await loadSimpleWebAuthnServer();
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: authenticationResponseJson(credential),
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.rpId,
      credential: {
        id: credentialId.credentialIdB64u,
        publicKey: publicKey.bytes,
        counter: authenticator.counter,
      },
      // Refused below, after the signature verifies. See the note at the top of this file.
      requireUserVerification: false,
    });
  } catch (e: unknown) {
    return failure(
      'invalid_assertion',
      errorMessage(e) || 'Authentication assertion verification threw',
    );
  }
  if (!verification.verified) {
    return failure('not_verified', 'Authentication verification failed');
  }
  if (verification.authenticationInfo.userVerified !== true) return userVerificationRequired();
  const newCounter = verification.authenticationInfo.newCounter;
  if (!Number.isSafeInteger(newCounter) || newCounter < 0) {
    return failure('internal', 'Verifier omitted the authenticator counter');
  }
  return {
    ok: true,
    credentialIdB64u: credentialId.credentialIdB64u,
    authenticator,
    newCounter,
  };
}

function updatedAuthenticatorRecord(input: {
  latest: WebAuthnAuthenticatorRecord;
  newCounter: number;
}): WebAuthnAuthenticatorRecord {
  return {
    version: 'webauthn_authenticator_v1',
    credentialIdB64u: input.latest.credentialIdB64u,
    credentialPublicKeyB64u: input.latest.credentialPublicKeyB64u,
    counter: input.newCounter,
    createdAtMs: input.latest.createdAtMs,
    updatedAtMs: Date.now(),
    /* An assertion advances the counter and nothing else. Registration-time
       device metadata is carried forward untouched. */
    deviceInfo: input.latest.deviceInfo,
  };
}

async function persistAuthenticatorCounter(input: {
  store: WebAuthnAuthenticatorStore;
  userId: string;
  credentialIdB64u: string;
  newCounter: number;
}): Promise<{ ok: true } | WebAuthnCeremonyFailure> {
  try {
    const latest = await input.store.get(input.userId, input.credentialIdB64u);
    if (latest && input.newCounter > latest.counter) {
      await input.store.put(
        input.userId,
        updatedAuthenticatorRecord({ latest, newCounter: input.newCounter }),
      );
    }
    return { ok: true };
  } catch (e: unknown) {
    return failure(
      'internal',
      `Failed to persist authenticator counter: ${errorMessage(e) || 'store error'}`,
    );
  }
}

function parseWebAuthnClientDataForRegistration(input: {
  credential: Record<string, unknown>;
  expectedChallenge: string;
  rpId: WebAuthnRpId;
}): WebAuthnCeremonyFailure | { ok: true } {
  const response = readRecord(input.credential.response);
  const clientDataJSON = response ? readStringField(response, 'clientDataJSON') : '';
  const clientData = parseClientDataJsonBase64url(clientDataJSON);
  if (clientData.type !== 'webauthn.create') {
    return failure(
      'invalid_body',
      'Invalid webauthn_registration.clientDataJSON.type (expected webauthn.create)',
    );
  }
  if (clientData.challenge !== input.expectedChallenge) {
    return failure('challenge_mismatch', 'Registration challenge mismatch');
  }
  if (!isHostWithinRpId(originHostnameOrEmpty(clientData.origin), input.rpId)) {
    return failure('invalid_origin', 'WebAuthn origin is not within rpId');
  }
  return { ok: true };
}

/**
 * Checks a passkey registration: the ceremony type, the challenge, the origin,
 * the RP ID, the attestation, user presence and user verification. A malformed
 * response makes the WebAuthn library throw.
 */
export async function verifyWebAuthnRegistrationCredentialForIntent(input: {
  webauthnRegistration: unknown;
  expectedChallenge: string;
  expectedOrigin: string;
  rpId: WebAuthnRpId;
}): Promise<VerifiedPasskeyRegistration | WebAuthnCeremonyFailure> {
  const credential = readRecord(input.webauthnRegistration);
  if (!credential) {
    return failure('invalid_body', 'Missing webauthn_registration');
  }
  const parsedClientData = parseWebAuthnClientDataForRegistration({
    credential,
    expectedChallenge: input.expectedChallenge,
    rpId: input.rpId,
  });
  if (!parsedClientData.ok) return parsedClientData;

  const expectedOrigin = toOptionalTrimmedString(input.expectedOrigin);
  if (!expectedOrigin) {
    return failure(
      'invalid_body',
      'expected_origin is required for WebAuthn registration verification',
    );
  }

  const { verifyRegistrationResponse } = await loadSimpleWebAuthnServer();
  const registration = await verifyRegistrationResponse({
    // The library checks the response shape and throws on a malformed one.
    response: credential as unknown as RegistrationResponseJSON,
    expectedChallenge: input.expectedChallenge,
    expectedOrigin,
    expectedRPID: input.rpId,
    // Refused below, after the attestation verifies. See the note at the top of this file.
    requireUserVerification: false,
  });
  const registrationInfo = registration.registrationInfo;
  if (!registration.verified || !registrationInfo) {
    return failure('not_verified', 'Registration verification failed');
  }
  if (registrationInfo.userVerified !== true) return userVerificationRequired();

  const verifiedCredential = registrationInfo.credential;
  const credentialIdB64u = verifiedCredential.id.trim();
  if (!credentialIdB64u || verifiedCredential.publicKey.length === 0) {
    return failure(
      'internal',
      'Registration verification did not return credential public key material',
    );
  }
  const counter = verifiedCredential.counter;
  return {
    ok: true,
    credential: {
      credentialIdB64u,
      credentialPublicKeyB64u: base64UrlEncode(verifiedCredential.publicKey),
      counter: Number.isSafeInteger(counter) && counter >= 0 ? counter : 0,
    },
    authenticator: {
      aaguid: registrationInfo.aaguid,
      backedUp: registrationInfo.credentialBackedUp,
      transports: [...(verifiedCredential.transports ?? [])],
    },
  };
}

export async function verifyWebAuthnAuthenticationLiteWithStore(input: {
  userId: string;
  rpId: WebAuthnRpId;
  expectedChallenge: string;
  webauthnAuthentication: WebAuthnAuthenticationCredential;
  expectedOrigin: string;
  authenticatorStore: WebAuthnAuthenticatorStore;
  logger: NormalizedLogger;
}): Promise<WebAuthnAuthenticationLiteResult> {
  try {
    const userId = String(input.userId || '').trim();
    const expectedChallenge = String(input.expectedChallenge || '').trim();
    const expectedOrigin = toOptionalTrimmedString(input.expectedOrigin);

    if (!userId)
      return { success: false, verified: false, code: 'invalid_body', message: 'Missing userId' };
    if (!expectedChallenge)
      return {
        success: false,
        verified: false,
        code: 'invalid_body',
        message: 'Missing expectedChallenge',
      };
    if (!expectedOrigin)
      return {
        success: false,
        verified: false,
        code: 'invalid_body',
        message: 'expected_origin is required for WebAuthn authentication verification',
      };

    const verified = await verifyPasskeyAssertion({
      credential: input.webauthnAuthentication,
      rpId: input.rpId,
      expectedChallenge,
      expectedOrigin,
      readAuthenticator: (credentialIdB64u) =>
        input.authenticatorStore.get(userId, credentialIdB64u),
    });
    if (!verified.ok) {
      return { success: false, verified: false, code: verified.code, message: verified.message };
    }

    const counterUpdate = await persistAuthenticatorCounter({
      store: input.authenticatorStore,
      userId,
      credentialIdB64u: verified.credentialIdB64u,
      newCounter: verified.newCounter,
    });
    if (!counterUpdate.ok) {
      return {
        success: false,
        verified: false,
        code: counterUpdate.code,
        message: counterUpdate.message,
      };
    }

    return { success: true, verified: true };
  } catch (e: unknown) {
    const msg = errorMessage(e) || 'Verification failed';
    input.logger.error('[webauthn] verifyWebAuthnAuthenticationLite internal error', {
      message: msg,
      userId: String(input.userId || ''),
      rpId: String(input.rpId || ''),
    });
    return { success: false, verified: false, code: 'internal', message: msg };
  }
}
