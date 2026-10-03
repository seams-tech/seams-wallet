import { toOptionalTrimmedString } from '@shared/utils/validation';
import { failedVerification } from '@shared/utils/failure';
import {
  CloudflareD1OidcJwksCache,
  parseRs256JwtForVerification,
  validateGoogleIdTokenClaims,
  verifyRs256JwtSignature,
  type GoogleIdTokenClaimValidationResult,
} from './d1OidcBoundary';

const googleJwks = new CloudflareD1OidcJwksCache();

/** Verifies provider proof without reading or mutating wallet identity state. */
export async function verifyGoogleOidcToken(
  configuredClientId: string | undefined,
  rawToken: unknown,
): Promise<GoogleIdTokenClaimValidationResult> {
  const clientId = toOptionalTrimmedString(configuredClientId);
  if (!clientId) {
    return failedVerification('not_configured', 'Google OIDC is not configured on this Worker');
  }
  const token = toOptionalTrimmedString(rawToken);
  if (!token) return failedVerification('invalid_body', 'id_token is required');
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return failedVerification('unsupported', 'WebCrypto (crypto.subtle) is unavailable in this runtime');
  }
  const parsed = parseRs256JwtForVerification({ token, tokenLabel: 'id_token' });
  if (!parsed.ok) return parsed;
  try {
    const jwks = await googleJwks.getGoogleJwks();
    const jwk = jwks.keysByKid.get(parsed.jwt.kid);
    if (!jwk) return failedVerification('unknown_kid', 'Unknown Google key id (kid)');
    const signature = await verifyRs256JwtSignature({
      subtle,
      jwt: parsed.jwt,
      jwk,
      tokenLabel: 'id_token',
      invalidSignatureMessage: 'Invalid Google id_token signature',
    });
    if (!signature.ok) return signature;
    return validateGoogleIdTokenClaims({ payload: parsed.jwt.payload, clientId });
  } catch {
    return failedVerification('internal', 'Google OIDC verification unavailable');
  }
}
