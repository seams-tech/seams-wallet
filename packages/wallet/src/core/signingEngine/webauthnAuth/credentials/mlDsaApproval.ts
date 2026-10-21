import { base64UrlDecode } from '@shared/utils/base64';
import { normalizeAuthenticationCredential } from './helpers';
import { redactCredentialExtensionOutputs } from './credentialExtensions';

/** Collect an exact owner assertion after the transaction review. No PRF is requested. */
export async function collectMlDsaApproval(input: {
  readonly rpId: string;
  readonly credentialIdB64u: string;
  readonly challengeB64u: string;
  readonly signal: AbortSignal | null;
}) {
  const credential = await navigator.credentials.get({
    publicKey: {
      rpId: input.rpId,
      challenge: Uint8Array.from(base64UrlDecode(input.challengeB64u)),
      allowCredentials: [
        {
          type: 'public-key',
          id: Uint8Array.from(base64UrlDecode(input.credentialIdB64u)),
        },
      ],
      userVerification: 'required',
    },
    ...(input.signal === null ? {} : { signal: input.signal }),
  });
  if (!(credential instanceof PublicKeyCredential) || credential.id !== input.credentialIdB64u)
    throw new Error('ML-DSA approval was cancelled or selected a different owner');
  return redactCredentialExtensionOutputs(normalizeAuthenticationCredential(credential.toJSON()));
}
