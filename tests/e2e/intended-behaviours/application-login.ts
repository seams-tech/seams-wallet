import { expect, type Page } from '@playwright/test';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';

/** The app verifies its own passkey. Seams only receives the stable app-session subject afterward. */
export async function authenticateApplicationPasskey(
  page: Page,
  appOrigin: string,
): Promise<{ verified: true; rpId: string }> {
  await page.addScriptTag({ content: `${decode.toString()}\n${encode.toString()}` });
  const rpId = new URL(appOrigin).hostname;
  const registration = await generateRegistrationOptions({
    rpID: rpId,
    rpName: 'GetSignal acceptance application',
    userName: 'getsignal-user-42',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const response = await page.evaluate(registerApplicationPasskey, registration);
  const registered = await verifyRegistrationResponse({
    response,
    expectedChallenge: registration.challenge,
    expectedOrigin: appOrigin,
    expectedRPID: rpId,
    requireUserVerification: true,
  });
  if (!registered.verified) throw new Error('Application passkey registration failed.');
  const credential = registered.registrationInfo.credential;
  const authentication = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: 'required',
    allowCredentials: [{ id: credential.id, transports: ['internal'] }],
  });
  const assertion = await page.evaluate(authenticateApplicationCredential, authentication);
  const authenticated = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge: authentication.challenge,
    expectedOrigin: appOrigin,
    expectedRPID: rpId,
    credential,
    requireUserVerification: true,
  });
  expect(authenticated.verified).toBe(true);
  return { verified: true, rpId };
}

async function registerApplicationPasskey(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: decode(options.challenge),
      rp: options.rp,
      user: {
        id: decode(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      authenticatorSelection: options.authenticatorSelection,
      attestation: 'none',
    },
  });
  if (
    !(credential instanceof PublicKeyCredential) ||
    !(credential.response instanceof AuthenticatorAttestationResponse)
  ) {
    throw new Error('Missing application passkey attestation.');
  }
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: encode(credential.response.clientDataJSON),
      attestationObject: encode(credential.response.attestationObject),
      transports: ['internal'],
    },
  };
}

async function authenticateApplicationCredential(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  const credentials = options.allowCredentials;
  if (!credentials || credentials.length !== 1 || !credentials[0])
    throw new Error('Missing application credential selector.');
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: decode(options.challenge),
      rpId: options.rpId,
      userVerification: 'required',
      allowCredentials: [
        { id: decode(credentials[0].id), type: 'public-key', transports: ['internal'] },
      ],
    },
  });
  if (
    !(credential instanceof PublicKeyCredential) ||
    !(credential.response instanceof AuthenticatorAssertionResponse)
  ) {
    throw new Error('Missing application passkey assertion.');
  }
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: encode(credential.response.clientDataJSON),
      authenticatorData: encode(credential.response.authenticatorData),
      signature: encode(credential.response.signature),
      userHandle: credential.response.userHandle
        ? encode(credential.response.userHandle)
        : undefined,
    },
  };
}

// These browser functions execute in isolation, so their encoding helpers are injected once.
function decode(value: string): Uint8Array<ArrayBuffer> {
  const text = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

function encode(value: ArrayBuffer): string {
  let text = '';
  for (const byte of new Uint8Array(value)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
