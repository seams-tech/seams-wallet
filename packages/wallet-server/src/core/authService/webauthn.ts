import { base64UrlEncode } from '@shared/utils/encoders';
import { errorMessage } from '@shared/utils/errors';
import { toOptionalTrimmedString } from '@shared/utils/validation';
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
  loadSimpleWebAuthnServer,
  originHostnameOrEmpty,
  parseClientDataJsonBase64url,
} from './webauthnOidcHelpers';

type WebAuthnCredentialVerificationResult =
  | {
      ok: true;
      credential: {
        credentialIdB64u: string;
        credentialPublicKeyB64u: string;
        counter: number;
      };
    }
  | { ok: false; code: string; message: string };

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

function readNestedRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  return readRecord(record[key]);
}

function readStringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : '';
}

function credentialRawIdB64u(
  credential: WebAuthnAuthenticationCredential,
): { ok: true; credentialIdB64u: string } | { ok: false; code: string; message: string } {
  const credentialId = credential.id.trim();
  const rawId = credential.rawId.trim();
  const chosen = rawId || credentialId;
  if (!chosen) {
    return failure('invalid_body', 'Missing webauthn_authentication.id/rawId');
  }
  try {
    return {
      ok: true,
      credentialIdB64u: base64UrlEncode(
        decodeBase64UrlOrBase64(chosen, 'webauthn_authentication.rawId'),
      ),
    };
  } catch (e: unknown) {
    return failure('invalid_body', errorMessage(e) || 'Invalid credential rawId');
  }
}

function credentialPublicKeyBytes(
  record: WebAuthnAuthenticatorRecord,
): { ok: true; bytes: Uint8Array } | { ok: false; code: string; message: string } {
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

function credentialVerificationInput(input: {
  credentialIdB64u: string;
  credentialPublicKeyBytes: Uint8Array;
  counter: number;
}): { id: string; publicKey: Uint8Array | Buffer; counter: number } {
  return {
    id: input.credentialIdB64u,
    publicKey:
      typeof Buffer !== 'undefined'
        ? Buffer.from(input.credentialPublicKeyBytes)
        : input.credentialPublicKeyBytes,
    counter: input.counter,
  };
}

function authenticationNewCounter(verification: unknown): number | null {
  const record = readRecord(verification);
  const authenticationInfo = record ? readNestedRecord(record, 'authenticationInfo') : null;
  const value = authenticationInfo?.newCounter;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null;
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
}): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
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
}): WebAuthnCredentialVerificationResult | { ok: true; originHost: string } {
  const response = readNestedRecord(input.credential, 'response');
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
  const originHost = originHostnameOrEmpty(clientData.origin);
  if (!isHostWithinRpId(originHost, input.rpId)) {
    return failure('invalid_origin', 'WebAuthn origin is not within rpId');
  }
  return { ok: true, originHost };
}

function registrationCredentialCounter(counter: unknown): number {
  const numeric = typeof counter === 'number' ? counter : Number(counter);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
}

export async function verifyWebAuthnRegistrationCredentialForIntent(input: {
  webauthnRegistration: unknown;
  expectedChallenge: string;
  expectedOrigin: string;
  rpId: WebAuthnRpId;
}): Promise<WebAuthnCredentialVerificationResult> {
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

  const mod = await loadSimpleWebAuthnServer();
  const verifyRegistrationResponse = mod.verifyRegistrationResponse;
  if (typeof verifyRegistrationResponse !== 'function') {
    return failure('unsupported', 'WebAuthn registration verifier is unavailable in this runtime');
  }

  const registration = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: input.expectedChallenge,
    expectedOrigin,
    expectedRPID: input.rpId,
    requireUserVerification: false,
  });
  if (!registration.verified) {
    return failure('not_verified', 'Registration verification failed');
  }

  const verifiedCredential = registration.registrationInfo?.credential;
  const credentialIdB64u = String(verifiedCredential?.id || '').trim();
  const credentialPublicKey = verifiedCredential?.publicKey;
  if (!credentialIdB64u || !credentialPublicKey) {
    return failure(
      'internal',
      'Registration verification did not return credential public key material',
    );
  }
  return {
    ok: true,
    credential: {
      credentialIdB64u,
      credentialPublicKeyB64u: base64UrlEncode(credentialPublicKey),
      counter: registrationCredentialCounter(verifiedCredential.counter),
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
    const rpId = input.rpId;
    const expectedChallenge = String(input.expectedChallenge || '').trim();
    const expectedOrigin = toOptionalTrimmedString(input.expectedOrigin);
    const credential = input.webauthnAuthentication;

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
    let clientData: { challenge: string; origin: string; type: string };
    try {
      clientData = parseClientDataJsonBase64url(credential.response.clientDataJSON);
    } catch (e: unknown) {
      return {
        success: false,
        verified: false,
        code: 'invalid_body',
        message: errorMessage(e) || 'Invalid webauthn_authentication.response.clientDataJSON',
      };
    }

    const originHost = originHostnameOrEmpty(clientData.origin);
    if (!isHostWithinRpId(originHost, rpId)) {
      return {
        success: false,
        verified: false,
        code: 'invalid_origin',
        message: 'WebAuthn origin is not within rpId',
      };
    }

    const credentialId = credentialRawIdB64u(credential);
    if (!credentialId.ok) {
      return {
        success: false,
        verified: false,
        code: credentialId.code,
        message: credentialId.message,
      };
    }

    const matched = await input.authenticatorStore.get(userId, credentialId.credentialIdB64u);
    if (!matched) {
      return {
        success: false,
        verified: false,
        code: 'unknown_credential',
        message: 'Credential is not registered for user',
      };
    }

    const mod = await loadSimpleWebAuthnServer();
    const verifyAuthenticationResponse = mod.verifyAuthenticationResponse;
    if (typeof verifyAuthenticationResponse !== 'function') {
      return {
        success: false,
        verified: false,
        code: 'unsupported',
        message: 'WebAuthn verifier is unavailable in this runtime',
      };
    }

    const publicKey = credentialPublicKeyBytes(matched);
    if (!publicKey.ok) {
      return {
        success: false,
        verified: false,
        code: publicKey.code,
        message: publicKey.message,
      };
    }

    let verification: unknown;
    try {
      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpId,
        credential: credentialVerificationInput({
          credentialIdB64u: credentialId.credentialIdB64u,
          credentialPublicKeyBytes: publicKey.bytes,
          counter: matched.counter,
        }),
        requireUserVerification: false,
      });
    } catch (e: unknown) {
      return {
        success: false,
        verified: false,
        code: 'invalid_assertion',
        message: errorMessage(e) || 'Authentication assertion verification threw',
      };
    }

    const verificationRecord = readRecord(verification);
    if (verificationRecord?.verified !== true) {
      return {
        success: false,
        verified: false,
        code: 'not_verified',
        message: 'Authentication verification failed',
      };
    }

    const newCounter = authenticationNewCounter(verification);
    if (newCounter !== null) {
      const counterUpdate = await persistAuthenticatorCounter({
        store: input.authenticatorStore,
        userId,
        credentialIdB64u: credentialId.credentialIdB64u,
        newCounter,
      });
      if (!counterUpdate.ok) {
        return {
          success: false,
          verified: false,
          code: counterUpdate.code,
          message: counterUpdate.message,
        };
      }
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
