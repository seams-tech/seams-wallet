import {
  SIGNING_SESSION_SEAL_OPRF_KEY_INFO,
  signingSessionSealOprfInfo,
} from '@shared/utils/signingSessionSeal';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import { evaluateOprf } from '../../../../core/oprfWasm';
import { createOprfKeyring, UnknownOprfKeyVersionError } from '../../../../core/oprfKeyring';
import type { SigningSessionSealEvaluator } from '../signingSessionSeal.types';

const SEED_CONTEXT = ['seams/signing-session-seal/oprf', 'poprf-ristretto255-sha512/v1'];
const RISTRETTO255_ELEMENT_BYTES = 32;

/**
 * The server half of the signing-session seal (RFC 9497 POPRF, ristretto255-SHA512). The device
 * keeps a random input and the warm secret encrypted under the POPRF output. The server applies
 * the key of one key version to a blinded element, with `info` built from the admitted wallet
 * and threshold session. It learns neither the input, the output nor the secret.
 */
export function createSigningSessionSealEvaluator(input: {
  readonly rootSecretB64u: string;
  readonly currentKeyVersion: string;
  readonly acceptedKeyVersions: readonly string[];
}): SigningSessionSealEvaluator {
  const keyring = createOprfKeyring({
    label: 'signing-session seal',
    rootSecretB64u: input.rootSecretB64u,
    seedContext: SEED_CONTEXT,
    keyInfo: SIGNING_SESSION_SEAL_OPRF_KEY_INFO,
    currentKeyVersion: input.currentKeyVersion,
    acceptedKeyVersions: input.acceptedKeyVersions,
  });
  const publicKeys = new Map<string, Promise<string>>();
  const publicKeyB64u = (keyVersion: string): Promise<string> => {
    let publicKey = publicKeys.get(keyVersion);
    if (!publicKey) {
      publicKey = keyring.publicKey(keyVersion).then(base64UrlEncode);
      publicKey.catch(() => publicKeys.delete(keyVersion));
      publicKeys.set(keyVersion, publicKey);
    }
    return publicKey;
  };
  return {
    currentKeyVersion: keyring.currentKeyVersion,
    evaluate: async ({ walletId, thresholdSessionId, keyVersion, blindedElementB64u }) => {
      if (!toOptionalTrimmedString(walletId) || !toOptionalTrimmedString(thresholdSessionId)) {
        return failure('invalid_scope', 'Authenticated wallet and threshold session are required');
      }
      let blindedElement: Uint8Array;
      try {
        blindedElement = base64UrlDecode(blindedElementB64u);
      } catch {
        return failure('invalid_blinded_element', 'blindedElementB64u is not base64url');
      }
      if (blindedElement.length !== RISTRETTO255_ELEMENT_BYTES) {
        return failure('invalid_blinded_element', 'blindedElementB64u must be 32 bytes');
      }
      try {
        const evaluation = await keyring.evaluate({
          keyVersion,
          blindedElement,
          info: signingSessionSealOprfInfo({ walletId, thresholdSessionId }),
        });
        return {
          ok: true,
          evaluatedElementB64u: base64UrlEncode(evaluation.evaluatedElement),
          proofB64u: base64UrlEncode(evaluation.proof),
          publicKeyB64u: await publicKeyB64u(keyVersion),
          keyVersion,
        };
      } catch (error: unknown) {
        if (error instanceof UnknownOprfKeyVersionError) {
          return failure('invalid_key_version', error.message);
        }
        // The runtime refuses an encoding that is not a ristretto255 element.
        return failure(
          'invalid_blinded_element',
          error instanceof Error ? error.message : 'The blinded element was refused',
        );
      }
    },
  };
}

/** The encoding of the ristretto255 generator, a valid element that holds no secret. */
const WARM_UP_ELEMENT = Uint8Array.from([
  0xe2, 0xf2, 0xae, 0x0a, 0x6a, 0xbc, 0x4e, 0x71, 0xa8, 0x84, 0xa9, 0x61, 0xc5, 0x00, 0x51, 0x5f,
  0x58, 0xe3, 0x0b, 0x6a, 0xa5, 0x82, 0xdd, 0x8d, 0xb6, 0xa6, 0x59, 0x45, 0xe0, 0x8d, 0x2d, 0x76,
]);

/**
 * Starts the WASM runtime and runs one evaluation under a key from a zero seed, so the first
 * seal in this isolate runs warm code. It uses no secret, and its result is discarded.
 */
export async function warmSigningSessionSealRuntime(): Promise<void> {
  await evaluateOprf({
    seed32: new Uint8Array(32),
    keyInfo: SIGNING_SESSION_SEAL_OPRF_KEY_INFO,
    blindedElement: WARM_UP_ELEMENT,
    info: signingSessionSealOprfInfo({ walletId: 'warm-up', thresholdSessionId: 'warm-up' }),
  });
}
