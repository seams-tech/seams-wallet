import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import {
  parseRouterAbEd25519YaoCeremonyBindingV1,
  type RouterAbEd25519YaoActivationPublicReceiptV1,
  type RouterAbEd25519YaoActivationClientPackageV1,
} from '@shared/utils/routerAbEd25519Yao';
import { parseLinkedDeviceOrdinaryMaterialSourceContributionV1 } from '@shared/device-linking/sourceContribution';
import type { OrdinaryEd25519SignerMaterialReservationPreparationV1 } from '../../../packages/wallet-server/src/core/signingMaterial/ordinaryInactiveSignerMaterialReservation';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  buildMpcMaterialActivationRef,
  parseMpcMaterialActivationId,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import { buildMpcMaterialActivationRefFixture } from './ecdsaMaterialRef.fixtures';

export function buildOrdinaryEd25519ClientMaterialFixture(label: string) {
  const session = bytes(32, label.length + 9);
  const transcript = bytes(32, label.length + 10);
  return {
    kind: 'ordinary_ed25519_client_material_v1' as const,
    deriver_a_client_package: buildEd25519ClientPackage(
      'deriver_a',
      label.length + 11,
      session,
      transcript,
    ),
    deriver_b_client_package: buildEd25519ClientPackage(
      'deriver_b',
      label.length + 17,
      session,
      transcript,
    ),
  };
}

export function buildOrdinaryEd25519ActivationReceiptFixture(
  label: string,
  materialActivation: MpcMaterialActivationRef,
): RouterAbEd25519YaoActivationPublicReceiptV1 {
  return {
    transcript: bytes(32, label.length + 10),
    registered_public_key: bytes(32, label.length + 71),
    joined_client_commitment: bytes(32, label.length + 72),
    joined_signing_worker_commitment: bytes(32, label.length + 73),
    signing_worker_verifying_share: bytes(32, label.length + 74),
    state_epoch: 1,
    material_activation: routerAbMpcMaterialActivationRefToWire(materialActivation),
  };
}

export function buildOrdinaryMaterialActivationFixture(label: string): MpcMaterialActivationRef {
  return buildMpcMaterialActivationRefFixture(
    `ordinary-reservation-${label}`,
    `wallet:ordinary-reservation:${label}`,
    `worker:ordinary-reservation:${label}`,
  );
}

export function buildOrdinaryEd25519ReservationPreparationFixture(
  label: string,
  materialActivation: MpcMaterialActivationRef,
): OrdinaryEd25519SignerMaterialReservationPreparationV1 {
  const sourceActivation = sourceMaterialActivation(materialActivation, label);
  const sourceBinding = parseRouterAbEd25519YaoCeremonyBindingV1(
    ordinaryEd25519Binding(sourceActivation, label),
  );
  const targetBinding = parseRouterAbEd25519YaoCeremonyBindingV1(
    ordinaryEd25519Binding(materialActivation, label),
  );
  const transcript = bytes(32, label.length + 44);
  const sourceRegisteredPublicKeyB64u = encodedBytes(32, label.length + 45);
  const sourceContribution = parseLinkedDeviceOrdinaryMaterialSourceContributionV1({
    kind: 'linked_device_ed25519_source_contribution_v1',
    keyFamily: 'ed25519',
    linkSessionId: `link-session:ordinary-reservation:${label}`,
    enrollmentId: `linked-enrollment:ordinary-reservation:${label}`,
    sourceAuthorityId: `wallet-authority:ordinary-reservation:${label}`,
    walletKeyId: `wallet-key:ordinary-reservation:${label}`,
    targetDeviceId: `linked-device:ordinary-reservation:${label}`,
    targetFactorVerificationDigestB64u: encodedBytes(32, label.length + 46),
    targetMaterialActivation: materialActivation,
    targetClientRecipientPublicKeyB64u: encodedBytes(32, label.length + 47),
    targetSigningWorkerRecipientPublicKeyB64u: encodedBytes(32, label.length + 48),
    sourceBinding,
    reservationId: `ed25519-reservation:ordinary-reservation:${label}`,
    targetBinding,
    activationReceipt: {
      transcript,
      registered_public_key: Array.from(base64UrlDecode(sourceRegisteredPublicKeyB64u)),
      joined_client_commitment: bytes(32, label.length + 49),
      joined_signing_worker_commitment: bytes(32, label.length + 50),
      signing_worker_verifying_share: bytes(32, label.length + 51),
      state_epoch: 1,
      material_activation: routerAbMpcMaterialActivationRefToWire(materialActivation),
    },
    participantIds: [1, 2],
    deriver_a_client_package: buildEd25519ClientPackage(
      'deriver_a',
      label.length + 52,
      targetBinding.session_id,
      transcript,
    ),
    deriver_b_client_package: buildEd25519ClientPackage(
      'deriver_b',
      label.length + 54,
      targetBinding.session_id,
      transcript,
    ),
    sourceRegisteredPublicKeyB64u,
  });
  if (sourceContribution.keyFamily !== 'ed25519') {
    throw new Error('ordinary Ed25519 source contribution has the wrong family');
  }
  return {
    kind: 'ordinary_ed25519_signer_material_reservation_preparation_v1',
    sourceContribution,
    targetBinding,
    applicationBinding: {
      wallet_id: String(materialActivation.materialOwner),
      near_ed25519_signing_key_id: `near-signing-key:ordinary-reservation:${label}`,
      signing_root_id: `signing-root:ordinary-reservation:${label}`,
      key_creation_signer_slot: 1,
    },
  };
}

function sourceMaterialActivation(
  target: MpcMaterialActivationRef,
  label: string,
): MpcMaterialActivationRef {
  const activationId = parseMpcMaterialActivationId(
    `activation:ordinary-reservation:${label}:source`,
  );
  if (!activationId.ok) throw new Error(activationId.error.message);
  return buildMpcMaterialActivationRef({
    activationId: activationId.value,
    capability: target.capability,
    materialOwner: target.materialOwner,
    keyBinding: target.keyBinding,
    lifecycleBinding: target.lifecycleBinding,
    signingWorker: target.signingWorker,
  });
}

function ordinaryEd25519Binding(
  materialActivation: MpcMaterialActivationRef,
  label: string,
) {
  return {
    lifecycle: {
      lifecycle_id: `ordinary-reservation:${label}`,
      work_kind: 'registration_prepare' as const,
      primitive_request_kind: 'registration' as const,
      root_share_epoch: `epoch:ordinary-reservation:${label}`,
      account_id: String(materialActivation.materialOwner),
      session_id: `session:ordinary-reservation:${label}`,
      signer_set_id: `signer-set:ordinary-reservation:${label}`,
      selected_server_id: String(materialActivation.signingWorker),
    },
    operation: 'registration' as const,
    session_id: bytes(32, label.length + 43),
    stable_key_context_binding: bytes(32, label.length + 47),
    material_activation: routerAbMpcMaterialActivationRefToWire(materialActivation),
  };
}

function buildEd25519ClientPackage(
  deriver: 'deriver_a' | 'deriver_b',
  seed: number,
  session: readonly number[],
  transcript: readonly number[],
): RouterAbEd25519YaoActivationClientPackageV1<typeof deriver> {
  return {
    kind: 'activation_client',
    deriver,
    session,
    transcript,
    encapsulated_key: bytes(32, seed + 2),
    ciphertext: bytes(32, seed + 3),
  };
}

function encodedBytes(length: number, seed: number, firstByte?: number): string {
  const value = bytes(length, seed);
  if (firstByte !== undefined) value[0] = firstByte;
  return base64UrlEncode(new Uint8Array(value));
}

function bytes(length: number, seed: number): number[] {
  return Array.from({ length }, (_, index) => (seed + index) % 256);
}
