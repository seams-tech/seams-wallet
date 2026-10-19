import { base64UrlEncode } from '@shared/utils/base64';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireBytes32 } from '@shared/utils/routerAbEd25519YaoDigests';
import { requireCanonicalString } from '@shared/utils/validation';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { RouterAbNormalSigningRouterProxy } from '../../../framework/routerApi';
import {
  normalizeRouterAbInternalServiceAuthSecret,
  ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
} from '../../../../core/ThresholdService/routerAb/internalServiceHttp';

type RecipientKey = {
  readonly publicKeyB64u: string;
  readonly keyVersion: string;
};

type RecipientDiscovery = ReadonlyExclusiveUnion<
  | { readonly kind: 'ready'; readonly a: RecipientKey; readonly b: RecipientKey }
  | { readonly kind: 'unavailable'; readonly reason: 'transport' | 'refused' | 'invalid_response' }
>;

function recipientKey(value: unknown, expectedRole: 'a' | 'b'): RecipientKey {
  const record = exactRecord(value, ['role', 'key_version', 'public_key'], 'ML-DSA recipient');
  if (record.role !== expectedRole) throw new Error('ML-DSA recipient role mismatch');
  const bytes = requireBytes32(record.public_key, 'ML-DSA recipient public key', true);
  return {
    publicKeyB64u: base64UrlEncode(new Uint8Array(bytes)),
    keyVersion: requireCanonicalString(record.key_version, 'ML-DSA recipient key version'),
  };
}

/** Private Gateway transport. Discovery grants no wallet or registration authority. */
export async function discoverMlDsaRecipientKeys(
  proxy: RouterAbNormalSigningRouterProxy,
): Promise<RecipientDiscovery> {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(
    ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
    normalizeRouterAbInternalServiceAuthSecret(proxy.internalServiceAuthSecret),
  );
  let response: Response;
  try {
    response = await proxy.fetch(
      new Request('https://router-ab.internal/router-ab/ml-dsa/registration/recipient-keys', {
        method: 'POST',
        headers,
        body: '{}',
      }),
    );
  } catch {
    return { kind: 'unavailable', reason: 'transport' };
  }
  if (response.status !== 200) return { kind: 'unavailable', reason: 'refused' };
  try {
    const record = exactRecord(await response.json(), ['a', 'b'], 'ML-DSA recipients');
    const a = recipientKey(record.a, 'a');
    const b = recipientKey(record.b, 'b');
    if (a.publicKeyB64u === b.publicKeyB64u) {
      return { kind: 'unavailable', reason: 'invalid_response' };
    }
    return { kind: 'ready', a, b };
  } catch {
    return { kind: 'unavailable', reason: 'invalid_response' };
  }
}
