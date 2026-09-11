import { errorMessage } from '@shared/utils/errors';
import { base64Decode, base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import type { WebAuthnAuthenticationCredential } from '../../core/types';

export type WebAuthnCredentialIdParseResult =
  | { readonly ok: true; readonly credentialIdB64u: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type WebAuthnClientDataJson = {
  readonly challenge: string;
  readonly origin: string;
  readonly type: string;
};

export function decodeWebAuthnBase64UrlOrBase64(input: string, fieldName: string): Uint8Array {
  try {
    return base64UrlDecode(input);
  } catch {
    try {
      return base64Decode(input);
    } catch (error: unknown) {
      throw new Error(
        `Invalid ${fieldName}: expected base64url/base64 string (${errorMessage(error) || 'decode failed'})`,
      );
    }
  }
}

export function parseWebAuthnClientDataJsonBase64url(
  clientDataJSONB64u: string,
): WebAuthnClientDataJson {
  const bytes = decodeWebAuthnBase64UrlOrBase64(
    clientDataJSONB64u,
    'webauthn_authentication.response.clientDataJSON',
  );
  const json = new TextDecoder().decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid clientDataJSON: expected object');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid clientDataJSON: expected object');
  }
  const challenge = toOptionalTrimmedString(Reflect.get(parsed, 'challenge'));
  const origin = toOptionalTrimmedString(Reflect.get(parsed, 'origin'));
  const type = toOptionalTrimmedString(Reflect.get(parsed, 'type'));
  if (!challenge) throw new Error('Invalid clientDataJSON.challenge');
  if (!origin) throw new Error('Invalid clientDataJSON.origin');
  if (!type) throw new Error('Invalid clientDataJSON.type');
  return { challenge, origin, type };
}

export function webAuthnOriginHostnameOrEmpty(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function webAuthnCredentialIdB64uFromCredential(
  input: unknown,
): WebAuthnCredentialIdParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'Missing webauthn_authentication.id/rawId',
    };
  }
  const rawId = toOptionalTrimmedString(Reflect.get(input, 'rawId'));
  const id = toOptionalTrimmedString(Reflect.get(input, 'id'));
  const selected = rawId || id;
  if (!selected) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'Missing webauthn_authentication.id/rawId',
    };
  }
  try {
    return {
      ok: true,
      credentialIdB64u: base64UrlEncode(
        decodeWebAuthnBase64UrlOrBase64(selected, 'webauthn_authentication.rawId'),
      ),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      code: 'invalid_body',
      message: errorMessage(error) || 'Invalid credential rawId',
    };
  }
}

export function parseWebAuthnAuthenticationCredential(
  input: unknown,
): WebAuthnAuthenticationCredential | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const responseValue = Reflect.get(input, 'response');
  if (responseValue === null || typeof responseValue !== 'object' || Array.isArray(responseValue)) {
    return null;
  }
  const id = toOptionalTrimmedString(Reflect.get(input, 'id'));
  const rawId = toOptionalTrimmedString(Reflect.get(input, 'rawId'));
  const type = toOptionalTrimmedString(Reflect.get(input, 'type'));
  const clientDataJSON = toOptionalTrimmedString(Reflect.get(responseValue, 'clientDataJSON'));
  const authenticatorData = toOptionalTrimmedString(
    Reflect.get(responseValue, 'authenticatorData'),
  );
  const signature = toOptionalTrimmedString(Reflect.get(responseValue, 'signature'));
  const rawUserHandle = Reflect.get(responseValue, 'userHandle');
  const userHandle = rawUserHandle === null ? null : toOptionalTrimmedString(rawUserHandle) || null;
  const rawAuthenticatorAttachment = Reflect.get(input, 'authenticatorAttachment');
  const authenticatorAttachment =
    rawAuthenticatorAttachment === null
      ? null
      : toOptionalTrimmedString(rawAuthenticatorAttachment) || null;
  if (!id || !rawId || type !== 'public-key') return null;
  if (!clientDataJSON || !authenticatorData || !signature) return null;
  return {
    id,
    rawId,
    type,
    authenticatorAttachment,
    response: {
      clientDataJSON,
      authenticatorData,
      signature,
      userHandle,
    },
    clientExtensionResults: Reflect.get(input, 'clientExtensionResults') ?? null,
  };
}
