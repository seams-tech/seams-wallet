import { errorMessage } from '@shared/utils/errors';
import { base64UrlEncode } from '@shared/utils/encoders';
import { isPlainObject, toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import type { WebAuthnAuthenticationCredential } from '../../core/types';
import { decodeBase64UrlOrBase64 } from '../../core/authService/webauthnOidcHelpers';

type WebAuthnCredentialIdParseResult =
  | { readonly ok: true; readonly credentialIdB64u: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

function containsWebAuthnExtensionOutput(value: unknown): boolean {
  if (value == null) return false;
  if (!isPlainObject(value)) return true;
  for (const nested of Object.values(value)) {
    if (containsWebAuthnExtensionOutput(nested)) return true;
  }
  return false;
}

export function unredactedWebAuthnExtensionField(input: unknown): string | null {
  if (!isPlainObject(input)) return null;

  if (containsWebAuthnExtensionOutput(input.clientExtensionResults)) {
    return 'clientExtensionResults';
  }

  const response = input.response;
  if (!isPlainObject(response)) return null;
  if (containsWebAuthnExtensionOutput(response.clientExtensionResults)) {
    return 'response.clientExtensionResults';
  }
  return null;
}

export function webAuthnCredentialIdB64uFromCredential(
  input: unknown,
): WebAuthnCredentialIdParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return failure('invalid_body', 'Missing webauthn_authentication.id/rawId');
  }
  const rawId = toOptionalTrimmedString(Reflect.get(input, 'rawId'));
  const id = toOptionalTrimmedString(Reflect.get(input, 'id'));
  const selected = rawId || id;
  if (!selected) {
    return failure('invalid_body', 'Missing webauthn_authentication.id/rawId');
  }
  try {
    return {
      ok: true,
      credentialIdB64u: base64UrlEncode(
        decodeBase64UrlOrBase64(selected, 'webauthn_authentication.rawId'),
      ),
    };
  } catch (error: unknown) {
    return failure('invalid_body', errorMessage(error) || 'Invalid credential rawId');
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
