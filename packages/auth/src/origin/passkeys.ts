import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';

// The passkey ceremonies of the account origin. They run only here, and they ask for user
// verification each time.

export type PasskeyCreationOptions = {
  readonly rp: { readonly id: string; readonly name: string };
  readonly user: { readonly idB64u: string; readonly name: string };
  readonly challengeB64u: string;
  readonly excludeCredentialIds: readonly string[];
};

/** The user closed the browser's passkey prompt, or the prompt timed out. */
export class PasskeyCancelledError extends Error {}
/** This browser or this frame cannot use passkeys. */
export class PasskeyUnsupportedError extends Error {}

function publicKeyCredential(credential: Credential | null): PublicKeyCredential {
  if (!credential || credential.type !== 'public-key') throw new PasskeyCancelledError();
  return credential as PublicKeyCredential;
}

async function runCeremony<Result>(ceremony: () => Promise<Result>): Promise<Result> {
  if (typeof navigator.credentials?.get !== 'function' || !window.PublicKeyCredential) {
    throw new PasskeyUnsupportedError();
  }
  try {
    return await ceremony();
  } catch (error) {
    if (error instanceof PasskeyCancelledError) throw error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyCancelledError();
    throw error;
  }
}

/** Makes a passkey and gives the registration as the Auth Worker reads it. */
export async function createPasskey(
  options: PasskeyCreationOptions,
  signal: AbortSignal,
): Promise<object> {
  return await runCeremony(async () => {
    const credential = publicKeyCredential(
      await navigator.credentials.create({
        signal,
        publicKey: {
          rp: options.rp,
          user: {
            id: base64UrlDecode(options.user.idB64u),
            name: options.user.name,
            displayName: options.user.name,
          },
          challenge: base64UrlDecode(options.challengeB64u),
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          excludeCredentials: options.excludeCredentialIds.map((id) => ({
            type: 'public-key',
            id: base64UrlDecode(id),
          })),
          attestation: 'none',
          // The passkey can give a PRF result later, when a plugin asks with a secret sink.
          // This asks for no result now.
          extensions: { prf: {} },
        },
      }),
    );
    const response = credential.response as AuthenticatorAttestationResponse;
    return {
      id: credential.id,
      rawId: base64UrlEncode(credential.rawId),
      type: 'public-key',
      response: {
        clientDataJSON: base64UrlEncode(response.clientDataJSON),
        attestationObject: base64UrlEncode(response.attestationObject),
        transports: response.getTransports?.() ?? [],
      },
      clientExtensionResults: {},
    };
  });
}

export type PasskeyAssertion = {
  readonly assertion: object;
  /** The PRF result, when the request gave a salt. Only a secret sink gets it. */
  readonly prfFirst: ArrayBuffer | null;
};

/**
 * Asks a passkey for an assertion. With `prfSalt`, the passkey also gives the PRF result of
 * that salt; the caller sends it into a secret sink and nowhere else.
 */
export async function getPasskeyAssertion(
  input: {
    readonly rpId: string;
    readonly challengeB64u: string;
    readonly prfSalt?: ArrayBuffer;
  },
  signal: AbortSignal,
): Promise<PasskeyAssertion> {
  return await runCeremony(async () => {
    const credential = publicKeyCredential(
      await navigator.credentials.get({
        signal,
        publicKey: {
          rpId: input.rpId,
          challenge: base64UrlDecode(input.challengeB64u),
          userVerification: 'required',
          ...(input.prfSalt ? { extensions: { prf: { eval: { first: input.prfSalt } } } } : {}),
        },
      }),
    );
    const response = credential.response as AuthenticatorAssertionResponse;
    const prf = credential.getClientExtensionResults().prf?.results?.first;
    return {
      assertion: {
        id: credential.id,
        rawId: base64UrlEncode(credential.rawId),
        type: 'public-key',
        response: {
          clientDataJSON: base64UrlEncode(response.clientDataJSON),
          authenticatorData: base64UrlEncode(response.authenticatorData),
          signature: base64UrlEncode(response.signature),
          userHandle: response.userHandle ? base64UrlEncode(response.userHandle) : null,
        },
        clientExtensionResults: {},
      },
      prfFirst: prf
        ? prf instanceof ArrayBuffer
          ? prf
          : new Uint8Array(prf.buffer).slice().buffer
        : null,
    };
  });
}
