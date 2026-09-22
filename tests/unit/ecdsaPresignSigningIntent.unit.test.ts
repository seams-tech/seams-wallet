import { expect, test } from '@playwright/test';
import {
  bindRouterAbEcdsaPresignSigningIntentV1,
  parseRouterAbEcdsaPresignSigningIntentV1,
  parseRouterAbEcdsaDerivationNormalSigningScopeV1,
  parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
  routerAbEcdsaDerivationEvmDigestSigningRequestCanonicalBytesV1,
  type RouterAbEcdsaPresignSigningIntentV1Wire,
} from '@shared/utils/routerAbEcdsaDerivation';
import { buildEcdsaSigningRequestFixture } from './helpers/ecdsaSigningRequest.fixtures';

async function fixture() {
  const completedRequest = await buildEcdsaSigningRequestFixture();
  const { client_presignature_id, ...request } = completedRequest;
  const intent = parseRouterAbEcdsaPresignSigningIntentV1({
    kind: 'ecdsa_presign_signing_intent_v1',
    presign_session_id: 'ceremony:signing-intent',
    request,
  });
  return {
    completedRequest,
    intent,
    completedSessionId: intent.presign_session_id,
    completedScope: completedRequest.scope,
    presignatureId: client_presignature_id,
    materialExpiresAtMs: 60_000,
    nowMs: 1_000,
  };
}

test('completion binds the material ID without changing the existing request transcript', async () => {
  const input = await fixture();
  const request = bindRouterAbEcdsaPresignSigningIntentV1(input);
  expect(request).toEqual(input.completedRequest);
  expect(routerAbEcdsaDerivationEvmDigestSigningRequestCanonicalBytesV1(request)).toEqual(
    routerAbEcdsaDerivationEvmDigestSigningRequestCanonicalBytesV1(input.completedRequest),
  );
  expect(input.intent.request).not.toHaveProperty('client_presignature_id');
  expect(() => parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(input.intent.request)).toThrow();
});

test('the boundary rejects preselected material and conflicting operation digests', async () => {
  const input = await fixture();
  expect(() => parseRouterAbEcdsaPresignSigningIntentV1({
    ...input.intent,
    request: input.completedRequest,
  })).toThrow();
  expect(() => parseRouterAbEcdsaPresignSigningIntentV1({
    ...input.intent,
    request: {
      ...input.intent.request,
      signing_digest_b64u: input.completedRequest.client_rerandomization_commitment32_b64u,
    },
  })).toThrow('intent digest');
});

test('completion rejects another ceremony, authority scope, expiry, or shortened material lifetime', async () => {
  const input = await fixture();
  expect(() => bindRouterAbEcdsaPresignSigningIntentV1({
    ...input,
    completedSessionId: 'ceremony:another',
  })).toThrow('completed ceremony');
  expect(() => bindRouterAbEcdsaPresignSigningIntentV1({
    ...input,
    completedScope: parseRouterAbEcdsaDerivationNormalSigningScopeV1({
      ...input.completedScope,
      activation_epoch: 'other',
    }),
  })).toThrow('completed ceremony');
  expect(() => bindRouterAbEcdsaPresignSigningIntentV1({
    ...input,
    nowMs: input.intent.request.expires_at_ms,
  })).toThrow('lifetime');
  expect(() => bindRouterAbEcdsaPresignSigningIntentV1({
    ...input,
    materialExpiresAtMs: input.intent.request.expires_at_ms - 1,
  })).toThrow('lifetime');
});

function rejectPreselectedMaterialType(intent: RouterAbEcdsaPresignSigningIntentV1Wire): void {
  const invalid: RouterAbEcdsaPresignSigningIntentV1Wire = {
    ...intent,
    request: {
      ...intent.request,
      // @ts-expect-error A pending intent cannot select a material identity, even via spread.
      client_presignature_id: 'preselected',
    },
  };
  void invalid;
}
void rejectPreselectedMaterialType;
