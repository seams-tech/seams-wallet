import { base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  buildRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
  parseRouterAbEcdsaDerivationNormalSigningScopeV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import { buildMpcMaterialActivationRefFixture } from './ecdsaMaterialRef.fixtures';
import { buildEmailOtpEcdsaWalletSessionFixture } from './linkedDeviceManagement.fixtures';

export async function buildEcdsaSigningRequestFixture() {
  const walletId = 'wallet:signing-intent';
  const fixture = await buildEmailOtpEcdsaWalletSessionFixture({
    label: 'signing-intent',
    walletId,
    materialActivation: buildMpcMaterialActivationRefFixture('signing-intent', walletId),
    expiresAtMs: Date.now() + 60_000,
  });
  const activation = fixture.authority.signerActivations.ecdsa;
  if (!activation) throw new Error('ECDSA fixture requires a signer activation');
  const materialActivation = routerAbMpcMaterialActivationRefToWire(fixture.materialActivation);
  const digest = parseDigestB64u(base64UrlEncode(new Uint8Array(32).fill(1)));
  const scope = parseRouterAbEcdsaDerivationNormalSigningScopeV1({
    wallet_id: walletId,
    ecdsa_threshold_key_id: 'threshold-key:signing-intent',
    signing_root_id: 'project:signing-intent',
    signing_root_version: 'v1',
    context: { application_binding_digest_b64u: digest },
    public_identity: {
      context_binding_b64u: digest,
      derivation_client_share_public_key33_b64u: activation.signer.thresholdPublicKey33B64u,
      server_public_key33_b64u: activation.signer.thresholdPublicKey33B64u,
      threshold_public_key33_b64u: activation.signer.thresholdPublicKey33B64u,
      ethereum_address20_b64u: base64UrlEncode(new Uint8Array(20).fill(0x11)),
      client_share_retry_counter: 0,
      server_share_retry_counter: 0,
    },
    material_activation: materialActivation,
    signing_worker: {
      server_id: materialActivation.signing_worker,
      key_epoch: 'epoch:signing-intent',
      recipient_encryption_key: `x25519:${'05'.repeat(32)}`,
    },
    activation_epoch: 'v1',
  });
  return buildRouterAbEcdsaDerivationEvmDigestSigningRequestV1({
    scope,
    requestId: 'request:signing-intent',
    operationId: 'operation:signing-intent',
    operationDigests: {
      lane_digest_b64u: digest,
      intent_digest_b64u: digest,
      display_digest_b64u: digest,
    },
    authorization: { kind: 'operation_step_up' },
    materialActivation,
    clientPresignatureId: 'presign:completed-material',
    expiresAtMs: 50_000,
    signingDigest32: new Uint8Array(32).fill(1),
    clientRerandomizationCommitment32: new Uint8Array(32).fill(2),
  });
}
