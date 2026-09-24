import { expect, test } from '@playwright/test';
import {
  parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
  routerAbEcdsaDerivationEvmDigestSigningRequestCanonicalBytesV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import { buildEcdsaSigningRequestFixture } from './helpers/ecdsaSigningRequest.fixtures';

test('prepare requires the complete material identity and preserves its canonical request', async () => {
  const request = await buildEcdsaSigningRequestFixture();
  const parsed = parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(request);
  expect(parsed).toEqual(request);
  expect(routerAbEcdsaDerivationEvmDigestSigningRequestCanonicalBytesV1(parsed)).toEqual(
    routerAbEcdsaDerivationEvmDigestSigningRequestCanonicalBytesV1(request),
  );
  const { client_presignature_id, ...incomplete } = request;
  expect(client_presignature_id).toBeTruthy();
  expect(() => parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(incomplete)).toThrow();
  expect(() => parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1({
    ...request,
    signing_digest_b64u: request.client_rerandomization_commitment32_b64u,
  })).toThrow('intent digest');
});
