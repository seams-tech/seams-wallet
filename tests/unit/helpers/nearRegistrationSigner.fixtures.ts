import { createHash } from 'node:crypto';
import { normalizeRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1,
  parseRouterAbEd25519YaoRegistrationActivationResultV1,
} from '@shared/utils/routerAbEd25519Yao';
import { buildRouterAbEd25519YaoRegistrationCapabilityRecordV1 } from '../../../packages/wallet-server/src/router/domains/ed25519Yao/recovery/routerAbEd25519YaoRecovery';
import {
  buildYaoEd25519WalletSignerRecord,
  ed25519NearPublicKeyFromBytes,
  implicitNearAccountIdFromEd25519PublicKeyBytes,
} from '../../../packages/wallet-server/src/router/cloudflare/d1/ed25519Yao/d1Ed25519YaoWalletSigner';
import { buildNearRegistrationAuthorityFixture } from './nearRegistration.fixtures';

function clientPackage(deriver: 'deriver_a' | 'deriver_b') {
  return {
    kind: 'activation_client',
    deriver,
    session: new Array(32).fill(1),
    transcript: new Array(32).fill(1),
    encapsulated_key: new Array(32).fill(1),
    ciphertext: new Array(16).fill(1),
  };
}

export async function buildNearRegistrationSignerFixture(label: string, now: number) {
  const fixture = await buildNearRegistrationAuthorityFixture(label);
  const runtimePolicyScope = normalizeRuntimePolicyScope(fixture.intent.runtimePolicyScope);
  const request = fixture.admission;
  const scope = request.scope;
  const binding = {
    lifecycle: {
      lifecycle_id: scope.lifecycle_id,
      work_kind: 'registration_prepare',
      primitive_request_kind: 'registration',
      root_share_epoch: scope.root_share_epoch,
      account_id: scope.account_id,
      session_id: scope.threshold_session_id,
      signer_set_id: scope.signer_set_id,
      selected_server_id: scope.signing_worker_id,
    },
    operation: 'registration',
    session_id: new Array(32).fill(1),
    stable_key_context_binding: new Array(32).fill(1),
    material_activation: scope.material_activation,
  };
  const receipt = parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1({
    binding,
    keyset: {
      deriver_a_input_public_key: new Array(32).fill(1),
      deriver_b_input_public_key: new Array(32).fill(2),
      signing_worker_recipient_public_key: new Array(32).fill(3),
    },
  });
  if (!receipt.ok) throw new Error(receipt.message);
  const publicKey = Array.from(createHash('sha256').update(label).digest());
  const result = parseRouterAbEd25519YaoRegistrationActivationResultV1({
    binding,
    deriver_a_client_package: clientPackage('deriver_a'),
    deriver_b_client_package: clientPackage('deriver_b'),
    public_receipt: {
      transcript: new Array(32).fill(1),
      registered_public_key: publicKey,
      joined_client_commitment: new Array(32).fill(1),
      joined_signing_worker_commitment: new Array(32).fill(1),
      signing_worker_verifying_share: new Array(32).fill(1),
      state_epoch: 1,
      material_activation: scope.material_activation,
    },
  });
  if (!result.ok) throw new Error(result.message);
  const nearAccountId = implicitNearAccountIdFromEd25519PublicKeyBytes(publicKey);
  const capability = buildRouterAbEd25519YaoRegistrationCapabilityRecordV1({
    kind: 'router_ab_ed25519_yao_registration_finalize_capability_v1',
    activeCapabilityBinding: publicKey,
    nearAccountId,
    registrationAdmissionRequest: request,
    registrationAdmissionReceipt: receipt.value,
    registrationResult: result.value,
    runtimePolicyScope,
  });
  if (!capability.ok) throw new Error(capability.message);
  return buildYaoEd25519WalletSignerRecord({
    walletId: fixture.intent.walletId,
    nearAccountId,
    nearEd25519SigningKeyId: request.application_binding.near_ed25519_signing_key_id,
    thresholdSessionId: scope.threshold_session_id,
    signerSlot: request.application_binding.key_creation_signer_slot,
    publicKey: ed25519NearPublicKeyFromBytes(publicKey),
    signingWorkerId: scope.signing_worker_id,
    keyVersion: scope.root_share_epoch,
    participantIds: request.participant_ids,
    signingRootId: request.application_binding.signing_root_id,
    signingRootVersion: scope.root_share_epoch,
    runtimePolicyScope,
    activeYaoCapability: capability.record,
    custodyKeyManifestDigestB64u: createHash('sha256')
      .update(`manifest-${label}`)
      .digest('base64url'),
    now,
  });
}
