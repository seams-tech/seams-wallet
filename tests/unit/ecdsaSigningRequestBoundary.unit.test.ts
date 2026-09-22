import { expect, test } from '@playwright/test';
import {
  parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
  parseRouterAbEcdsaPrepareSourceV1,
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

test('terminal prepare source is bound to the complete request scope and material lifetime', async () => {
  const request = await buildEcdsaSigningRequestFixture();
  const source = {
    kind: 'final_presign_batch',
    batch: {
      scope: request.scope,
      presign_session_id: 'ecdsa-presign-v2:1000:test',
      requested_stage: 'presign',
      outgoing_messages_b64u: ['AQ', 'Ag'],
      ceremony_expires_at_ms: request.expires_at_ms,
      material_expires_at_ms: request.expires_at_ms,
    },
  };
  expect(parseRouterAbEcdsaPrepareSourceV1(source, request)).toEqual(source);
  expect(parseRouterAbEcdsaPrepareSourceV1(undefined, request)).toEqual({ kind: 'available_pool' });
  expect(() => parseRouterAbEcdsaPrepareSourceV1({
    ...source, batch: { ...source.batch, requested_stage: 'triples' },
  }, request)).toThrow();
  expect(() => parseRouterAbEcdsaPrepareSourceV1({
    ...source, batch: { ...source.batch, material_expires_at_ms: request.expires_at_ms - 1 },
  }, request)).toThrow();
  expect(() => parseRouterAbEcdsaPrepareSourceV1({
    ...source, batch: { ...source.batch, scope: { ...request.scope, wallet_id: 'another-wallet' } },
  }, request)).toThrow();
});
