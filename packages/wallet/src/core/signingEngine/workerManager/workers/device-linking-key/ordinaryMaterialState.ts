// The ordinary signer material a key slot holds between steps, and how a repeated step is
// recognized as a replay of the one already taken.
import type {
  CommittedAuthorityPackagesV1,
  CommittedEcdsaSignerPackageV1,
  OrdinarySignerMaterialRecipientRequirementV1,
} from '@shared/device-linking';
import { alphabetizeStringify } from '@shared/utils/digests';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import { sameRouterAbMpcMaterialActivationRef } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  sameRouterAbEd25519YaoActivationBindingV1,
  sameRouterAbEd25519YaoActivationKeysetV1,
  sameRouterAbEd25519YaoByteSequence,
} from '@shared/utils/routerAbEd25519Yao';
import type {
  DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1,
  DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1,
  DeviceLinkingOrdinaryMaterialWorkerRequestV1,
  DeviceLinkingOrdinaryTargetFactorBindingV1,
  DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
  SealedLocalAuthorityMaterialSetV1,
} from '../../deviceLinkingPorts';

type OrdinaryRecipientRequirementsV1 = readonly [
  OrdinarySignerMaterialRecipientRequirementV1,
  ...OrdinarySignerMaterialRecipientRequirementV1[],
];

type OrdinaryRecipientRequestsV1 =
  DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1['recipientRequests'];

type OrdinaryPreparationsV1 = readonly [
  DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
  ...DeviceLinkingOrdinarySignerMaterialReservationPreparationV1[],
];

type OrdinaryResealedExportRootV1 = Extract<
  DeviceLinkingOrdinaryMaterialWorkerRequestV1,
  { readonly kind: 'device_linking_ordinary_signer_material_seal_v1' }
>['resealedExportRoot'];

type OrdinaryCommittedAndResealedExportRootV1 = {
  readonly committed: CommittedAuthorityPackagesV1;
  readonly resealedExportRoot: OrdinaryResealedExportRootV1;
};

export type DeviceLinkingOrdinarySignerMaterialRecipientPreparationStateV1 =
  DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1 & {
    readonly requirements: OrdinaryRecipientRequirementsV1;
  };

export type DeviceLinkingOrdinaryMaterialStateV1 = {
  readonly targetFactor: DeviceLinkingOrdinaryTargetFactorBindingV1;
  readonly preparations: OrdinaryPreparationsV1;
  readonly recipientInputs: DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1;
  readonly factorSecret: Uint8Array;
};

type DeviceLinkingSealReplayIdentityV1 = string & {
  readonly __deviceLinkingSealReplayIdentityV1: true;
};

export type DeviceLinkingOrdinaryMaterialSealStateV1 = {
  readonly committed: CommittedAuthorityPackagesV1;
  readonly targetFactor: DeviceLinkingOrdinaryTargetFactorBindingV1;
  readonly resealedExportRoot: OrdinaryResealedExportRootV1;
  readonly result: SealedLocalAuthorityMaterialSetV1;
  readonly committedAndResealedExportRootReplayIdentity: DeviceLinkingSealReplayIdentityV1;
};

export function deviceLinkingSealReplayIdentityV1(
  value: OrdinaryCommittedAndResealedExportRootV1,
): DeviceLinkingSealReplayIdentityV1 {
  return alphabetizeStringify({
    domain: 'seams/wallet/device-linking/ordinary-seal-replay/v1',
    value,
  }) as DeviceLinkingSealReplayIdentityV1;
}

export function sameOrdinaryRecipientRequirements(
  left: OrdinaryRecipientRequirementsV1,
  right: OrdinaryRecipientRequirementsV1,
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftRequirement = left[index];
    const rightRequirement = right[index];
    if (
      !rightRequirement ||
      leftRequirement.kind !== rightRequirement.kind ||
      leftRequirement.keyFamily !== rightRequirement.keyFamily ||
      leftRequirement.walletKeyId !== rightRequirement.walletKeyId
    ) {
      return false;
    }
  }
  return true;
}

export function sameOrdinaryRecipientRequests(
  left: OrdinaryRecipientRequestsV1,
  right: OrdinaryRecipientRequestsV1,
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftRequest = left[index];
    const rightRequest = right[index];
    if (!leftRequest || !rightRequest || leftRequest.kind !== rightRequest.kind) return false;
    switch (leftRequest.kind) {
      case 'ordinary_ed25519_signer_material_recipient_request_v1':
        if (
          rightRequest.kind !== leftRequest.kind ||
          leftRequest.keyFamily !== rightRequest.keyFamily ||
          leftRequest.walletKeyId !== rightRequest.walletKeyId ||
          leftRequest.recipientPublicKeyB64u !== rightRequest.recipientPublicKeyB64u
        ) {
          return false;
        }
        break;
      case 'ordinary_ecdsa_signer_material_recipient_request_v1':
        if (
          rightRequest.kind !== leftRequest.kind ||
          leftRequest.keyFamily !== rightRequest.keyFamily ||
          leftRequest.walletKeyId !== rightRequest.walletKeyId ||
          leftRequest.clientEphemeralPublicKey !== rightRequest.clientEphemeralPublicKey
        ) {
          return false;
        }
        break;
      default:
        return assertNeverDeviceLinkingReplay(leftRequest);
    }
  }
  return true;
}

export function sameOrdinaryTargetFactor(
  left: DeviceLinkingOrdinaryTargetFactorBindingV1,
  right: DeviceLinkingOrdinaryTargetFactorBindingV1,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'passkey':
      return (
        right.kind === 'passkey' &&
        left.walletAuthMethodId === right.walletAuthMethodId &&
        left.verificationDigestB64u === right.verificationDigestB64u &&
        left.rpId === right.rpId &&
        left.credentialIdB64u === right.credentialIdB64u
      );
    case 'email_otp':
      return (
        right.kind === 'email_otp' &&
        left.walletAuthMethodId === right.walletAuthMethodId &&
        left.verificationDigestB64u === right.verificationDigestB64u &&
        left.emailHashHex === right.emailHashHex &&
        left.registrationAuthorityId === right.registrationAuthorityId
      );
    default:
      return assertNeverDeviceLinkingReplay(left);
  }
}

type DeviceLinkingEd25519PreparationV1 = Extract<
  DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
  { readonly kind: 'linked_device_ed25519_source_contribution_preparation_v1' }
>;

function sameOrdinaryPreparations(
  left: OrdinaryPreparationsV1,
  right: OrdinaryPreparationsV1,
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftPreparation = left[index];
    const rightPreparation = right[index];
    if (!leftPreparation || !rightPreparation) return false;
    if ('kind' in leftPreparation) {
      if (!('kind' in rightPreparation) || leftPreparation.kind !== rightPreparation.kind) {
        return false;
      }
      if (
        leftPreparation.linkSessionId !== rightPreparation.linkSessionId ||
        leftPreparation.enrollmentId !== rightPreparation.enrollmentId ||
        leftPreparation.sourceAuthorityId !== rightPreparation.sourceAuthorityId ||
        leftPreparation.walletKeyId !== rightPreparation.walletKeyId ||
        leftPreparation.targetDeviceId !== rightPreparation.targetDeviceId ||
        leftPreparation.targetFactorVerificationDigestB64u !==
          rightPreparation.targetFactorVerificationDigestB64u ||
        leftPreparation.sourceRevocationEpoch !== rightPreparation.sourceRevocationEpoch ||
        leftPreparation.participantIds[0] !== rightPreparation.participantIds[0] ||
        leftPreparation.participantIds[1] !== rightPreparation.participantIds[1] ||
        !mpcMaterialActivationRefsEqual(
          leftPreparation.targetMaterialActivation,
          rightPreparation.targetMaterialActivation,
        ) ||
        leftPreparation.targetClientRecipientPublicKeyB64u !==
          rightPreparation.targetClientRecipientPublicKeyB64u ||
        leftPreparation.targetSigningWorkerRecipientPublicKeyB64u !==
          rightPreparation.targetSigningWorkerRecipientPublicKeyB64u ||
        leftPreparation.sourceRegisteredPublicKeyB64u !==
          rightPreparation.sourceRegisteredPublicKeyB64u ||
        !sameOrdinaryEd25519SourceBinding(
          leftPreparation.sourceBinding,
          rightPreparation.sourceBinding,
        ) ||
        !sameRouterAbEd25519YaoActivationBindingV1(
          leftPreparation.targetAdmission.binding,
          rightPreparation.targetAdmission.binding,
        ) ||
        !sameRouterAbEd25519YaoActivationKeysetV1(
          leftPreparation.targetAdmission.keyset,
          rightPreparation.targetAdmission.keyset,
        ) ||
        !sameOrdinaryEd25519ApplicationBinding(
          leftPreparation.applicationBinding,
          rightPreparation.applicationBinding,
        )
      ) {
        return false;
      }
      continue;
    }
    if ('kind' in rightPreparation) return false;
    if (
      leftPreparation.linkSessionId !== rightPreparation.linkSessionId ||
      leftPreparation.enrollmentId !== rightPreparation.enrollmentId ||
      leftPreparation.sourceAuthorityId !== rightPreparation.sourceAuthorityId ||
      !sameEcdsaSourceSignerIdentity(leftPreparation.source, rightPreparation.source) ||
      !sameEcdsaTargetRecipientPreparation(leftPreparation.target, rightPreparation.target)
    ) {
      return false;
    }
  }
  return true;
}

function sameOrdinaryEd25519SourceBinding(
  left: DeviceLinkingEd25519PreparationV1['sourceBinding'],
  right: DeviceLinkingEd25519PreparationV1['sourceBinding'],
): boolean {
  return (
    left.operation === right.operation &&
    sameRouterAbEd25519YaoByteSequence(left.session_id, right.session_id) &&
    sameRouterAbEd25519YaoByteSequence(
      left.stable_key_context_binding,
      right.stable_key_context_binding,
    ) &&
    left.lifecycle.lifecycle_id === right.lifecycle.lifecycle_id &&
    left.lifecycle.work_kind === right.lifecycle.work_kind &&
    left.lifecycle.primitive_request_kind === right.lifecycle.primitive_request_kind &&
    left.lifecycle.root_share_epoch === right.lifecycle.root_share_epoch &&
    left.lifecycle.account_id === right.lifecycle.account_id &&
    left.lifecycle.session_id === right.lifecycle.session_id &&
    left.lifecycle.signer_set_id === right.lifecycle.signer_set_id &&
    left.lifecycle.selected_server_id === right.lifecycle.selected_server_id &&
    sameRouterAbMpcMaterialActivationRef(left.material_activation, right.material_activation)
  );
}

function sameOrdinaryEd25519ApplicationBinding(
  left: DeviceLinkingEd25519PreparationV1['applicationBinding'],
  right: DeviceLinkingEd25519PreparationV1['applicationBinding'],
): boolean {
  return (
    left.wallet_id === right.wallet_id &&
    left.near_ed25519_signing_key_id === right.near_ed25519_signing_key_id &&
    left.signing_root_id === right.signing_root_id &&
    left.key_creation_signer_slot === right.key_creation_signer_slot
  );
}

export function sameOrdinaryTargetFactorAndPreparations(
  left: Pick<DeviceLinkingOrdinaryMaterialStateV1, 'targetFactor' | 'preparations'>,
  right: Pick<DeviceLinkingOrdinaryMaterialStateV1, 'targetFactor' | 'preparations'>,
): boolean {
  return (
    sameOrdinaryTargetFactor(left.targetFactor, right.targetFactor) &&
    sameOrdinaryPreparations(left.preparations, right.preparations)
  );
}

function assertNeverDeviceLinkingReplay(value: never): never {
  throw new Error(`unsupported device-linking replay value: ${String(value)}`);
}

export function sameEcdsaSourceSignerIdentity(
  left: Exclude<
    DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
    { readonly kind: string }
  >['source'],
  right: CommittedEcdsaSignerPackageV1['activationReceipt']['binding']['source'],
): boolean {
  return (
    mpcMaterialActivationRefsEqual(left.activation, right.activation) &&
    left.clientPublicKey33B64u === right.clientPublicKey33B64u &&
    left.relayerPublicKey33B64u === right.relayerPublicKey33B64u &&
    left.thresholdPublicKey33B64u === right.thresholdPublicKey33B64u &&
    left.thresholdEthereumAddress20B64u === right.thresholdEthereumAddress20B64u
  );
}

export function sameEcdsaTargetRecipientPreparation(
  left: Exclude<
    DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
    { readonly kind: string }
  >['target'],
  right: CommittedEcdsaSignerPackageV1['activationReceipt']['binding']['target'],
): boolean {
  return (
    mpcMaterialActivationRefsEqual(left.activation, right.activation) &&
    String(left.targetDeviceId) === String(right.targetDeviceId) &&
    left.targetFactorVerificationDigestB64u === right.targetFactorVerificationDigestB64u &&
    left.clientRecipientPublicKeyB64u === right.clientRecipientPublicKeyB64u &&
    left.signingWorkerRecipientPublicKeyB64u === right.signingWorkerRecipientPublicKeyB64u
  );
}
