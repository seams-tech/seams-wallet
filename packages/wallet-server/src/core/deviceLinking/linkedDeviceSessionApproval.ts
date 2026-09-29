// Checks that an owner's claim, approval or source-contribution re-approval stays within the
// owner's authority and matches the session and target preparation it names.
import {
  hasDelegatedWalletPermissionV1,
  sameDelegatedWalletAuthorityV1,
  validateDelegatedWalletAuthorityAttenuationV1,
  type DelegatedWalletAuthorityV1,
} from '@shared/authorization/delegatedAuthority';
import type {
  LinkedDeviceApprovalV1,
  LinkedDeviceEd25519SourceContributionPreparationV1,
  LinkedDeviceEcdsaSourceContributionPreparationV1,
  LinkedDeviceOrdinaryMaterialSourceContributionV1,
} from '@shared/device-linking/contracts';
import { assertLinkedDeviceOrdinaryMaterialSourceContributionMatchesContextV1 } from '@shared/device-linking/sourceContribution';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import {
  routerAbMpcMaterialActivationRefFromWire,
  sameRouterAbMpcMaterialActivationRef,
} from '@shared/utils/routerAbNormalSigningIdentity';
import type { RouterAbEd25519YaoCeremonyBindingV1 } from '@shared/utils/routerAbEd25519Yao';
import { type LinkedDeviceSessionRecordV1, parseDeviceIdValue } from './linkedDeviceSessionRecord';

export function validateApprovalMatchesSession(
  record: LinkedDeviceSessionRecordV1,
  approval: LinkedDeviceApprovalV1,
  nowMs: number,
): void {
  if (record.state.state !== 'claimed' || !record.claimTranscript)
    throw new Error('link session is not awaiting owner approval');
  const claim = record.claimTranscript.value;
  if (
    claim.walletId !== approval.walletId ||
    claim.enrollmentId !== approval.enrollmentId ||
    claim.deviceId !== approval.deviceId ||
    claim.devicePublicKeyB64u !== approval.devicePublicKeyB64u ||
    approval.linkPublicKeyB64u !== record.qrPayload.linkPublicKeyB64u ||
    approval.devicePublicKeyB64u !== record.qrPayload.devicePublicKeyB64u
  )
    throw new Error('approval identity does not match the claimed session');
  if (!sameDelegatedWalletAuthorityV1(approval.permission, record.qrPayload.requestedPermission))
    throw new Error('approval permission does not match QR payload');
  if (approval.targetFactor.kind !== record.qrPayload.targetFactor.kind)
    throw new Error('approval target factor does not match the QR session');
  if (approval.expiresAtMs <= nowMs || approval.expiresAtMs > claim.claimExpiresAtMs)
    throw new Error('approval expiry is outside the claim lifetime');
  if (approval.approvedAtMs > nowMs) throw new Error('approval is from the future');
}

export function validateSourceContributionApprovalMatchesSession(
  record: LinkedDeviceSessionRecordV1,
  approval: LinkedDeviceApprovalV1,
  nowMs: number,
): void {
  if (record.state.state !== 'awaiting_source_contribution' || !record.approvalTranscript) {
    throw new Error('link session is not awaiting source contribution');
  }
  if (!approval.sourceContribution) {
    throw new Error('source contribution is required');
  }
  const initial = record.approvalTranscript.value;
  if (
    approval.linkSessionId !== initial.linkSessionId ||
    approval.walletId !== initial.walletId ||
    approval.enrollmentId !== initial.enrollmentId ||
    approval.deviceId !== initial.deviceId ||
    approval.linkPublicKeyB64u !== initial.linkPublicKeyB64u ||
    approval.devicePublicKeyB64u !== initial.devicePublicKeyB64u ||
    approval.targetFactor.kind !== initial.targetFactor.kind ||
    approval.approvedAtMs !== initial.approvedAtMs ||
    approval.expiresAtMs !== initial.expiresAtMs ||
    !sameDelegatedWalletAuthorityV1(approval.permission, initial.permission) ||
    !linkedDeviceOwnerAuthorizationsEqualV1(approval.ownerAuthorization, initial.ownerAuthorization)
  ) {
    throw new Error('source contribution approval changes the owner approval transcript');
  }
  if (approval.expiresAtMs <= nowMs || approval.approvedAtMs > nowMs) {
    throw new Error('source contribution approval is outside its validity window');
  }
}

export function validateSourceContributionPreparationMatchesApproval(
  record: LinkedDeviceSessionRecordV1,
  approval: LinkedDeviceApprovalV1,
): void {
  if (record.state.state !== 'awaiting_source_contribution') {
    throw new Error('link session is not awaiting source contribution');
  }
  const preparations = record.sourceContributionPreparation;
  const contributions = approval.sourceContribution;
  if (!preparations || !contributions || preparations.length !== contributions.length) {
    throw new Error('source contribution families do not match target preparation');
  }
  preparations.forEach((preparation, index) => {
    const contribution = contributions[index];
    if (!contribution) throw new Error('source contribution tuple is incomplete');
    if (preparation.linkSessionId !== approval.linkSessionId) {
      throw new Error('source contribution preparation session differs from approval');
    }
    if (preparation.enrollmentId !== approval.enrollmentId) {
      throw new Error('source contribution preparation enrollment differs from approval');
    }
    if ('kind' in preparation) {
      if (contribution.keyFamily !== 'ed25519') {
        throw new Error('source contribution family order differs from preparation');
      }
      assertEd25519ContributionMatchesPreparation(preparation, contribution, approval);
      return;
    }
    if (contribution.keyFamily !== 'ecdsa_secp256k1') {
      throw new Error('source contribution family order differs from preparation');
    }
    assertEcdsaContributionMatchesPreparation(preparation, contribution, approval);
  });
}

function assertEd25519ContributionMatchesPreparation(
  preparation: LinkedDeviceEd25519SourceContributionPreparationV1,
  contribution: LinkedDeviceOrdinaryMaterialSourceContributionV1,
  approval: LinkedDeviceApprovalV1,
): void {
  if (contribution.keyFamily !== 'ed25519') {
    throw new Error('source contribution is not Ed25519');
  }
  assertLinkedDeviceOrdinaryMaterialSourceContributionMatchesContextV1({
    contribution,
    linkSessionId: preparation.linkSessionId,
    enrollmentId: preparation.enrollmentId,
    sourceAuthorityId: preparation.sourceAuthorityId,
    walletKeyId: preparation.walletKeyId,
    targetDeviceId: preparation.targetDeviceId,
    targetFactorVerificationDigestB64u: preparation.targetFactorVerificationDigestB64u,
    sourceMaterialActivation: routerAbMpcMaterialActivationRefFromWire(
      preparation.sourceBinding.material_activation,
    ),
    targetMaterialActivation: preparation.targetMaterialActivation,
    sourceSigner: {
      keyFamily: 'ed25519',
      walletKeyId: preparation.walletKeyId,
      registeredPublicKeyB64u: preparation.sourceRegisteredPublicKeyB64u,
    },
  });
  if (
    contribution.targetDeviceId !== parseDeviceIdValue(approval.deviceId) ||
    contribution.targetMaterialActivation.activationId !==
      preparation.targetMaterialActivation.activationId ||
    contribution.targetClientRecipientPublicKeyB64u !==
      preparation.targetClientRecipientPublicKeyB64u ||
    contribution.targetSigningWorkerRecipientPublicKeyB64u !==
      preparation.targetSigningWorkerRecipientPublicKeyB64u ||
    contribution.sourceRegisteredPublicKeyB64u !== preparation.sourceRegisteredPublicKeyB64u ||
    !linkedDeviceEd25519BindingsEqualV1(contribution.sourceBinding, preparation.sourceBinding) ||
    contribution.participantIds[0] !== preparation.participantIds[0] ||
    contribution.participantIds[1] !== preparation.participantIds[1]
  ) {
    throw new Error('Ed25519 source contribution does not match target preparation');
  }
}

function assertEcdsaContributionMatchesPreparation(
  preparation: LinkedDeviceEcdsaSourceContributionPreparationV1,
  contribution: LinkedDeviceOrdinaryMaterialSourceContributionV1,
  approval: LinkedDeviceApprovalV1,
): void {
  if (contribution.keyFamily !== 'ecdsa_secp256k1') {
    throw new Error('source contribution is not ECDSA');
  }
  assertLinkedDeviceOrdinaryMaterialSourceContributionMatchesContextV1({
    contribution,
    linkSessionId: preparation.linkSessionId,
    enrollmentId: preparation.enrollmentId,
    sourceAuthorityId: preparation.sourceAuthorityId,
    walletKeyId: contribution.walletKeyId,
    targetDeviceId: preparation.target.targetDeviceId,
    targetFactorVerificationDigestB64u: preparation.target.targetFactorVerificationDigestB64u,
    sourceMaterialActivation: preparation.source.activation,
    targetMaterialActivation: preparation.target.activation,
    sourceSigner: {
      keyFamily: 'ecdsa_secp256k1',
      walletKeyId: contribution.walletKeyId,
      thresholdPublicKey33B64u: preparation.source.thresholdPublicKey33B64u,
    },
  });
  if (
    contribution.targetDeviceId !== parseDeviceIdValue(approval.deviceId) ||
    !mpcMaterialActivationRefsEqual(
      contribution.target.activation,
      preparation.target.activation,
    ) ||
    contribution.target.targetFactorVerificationDigestB64u !==
      preparation.target.targetFactorVerificationDigestB64u ||
    contribution.target.clientRecipientPublicKeyB64u !==
      preparation.target.clientRecipientPublicKeyB64u ||
    contribution.target.signingWorkerRecipientPublicKeyB64u !==
      preparation.target.signingWorkerRecipientPublicKeyB64u ||
    !mpcMaterialActivationRefsEqual(
      contribution.sourceSigner.activation,
      preparation.source.activation,
    )
  ) {
    throw new Error('ECDSA source contribution does not match target preparation');
  }
}

export function validateLinkedDeviceRequestedAuthorityV1(
  sourceAuthority: DelegatedWalletAuthorityV1,
  authority: DelegatedWalletAuthorityV1,
): string | null {
  if (!hasDelegatedWalletPermissionV1(sourceAuthority, 'link_devices'))
    return 'linking authority does not contain link_devices';
  const attenuation = validateDelegatedWalletAuthorityAttenuationV1({
    parent: sourceAuthority,
    child: authority,
  });
  return attenuation.ok ? null : attenuation.error.message;
}

function linkedDeviceOwnerAuthorizationsEqualV1(
  left: LinkedDeviceApprovalV1['ownerAuthorization'],
  right: LinkedDeviceApprovalV1['ownerAuthorization'],
): boolean {
  return (
    left.kind === 'wallet_session' &&
    right.kind === 'wallet_session' &&
    left.walletSessionId === right.walletSessionId &&
    left.authorizationId === right.authorizationId
  );
}

function linkedDeviceEd25519BindingsEqualV1(
  left: RouterAbEd25519YaoCeremonyBindingV1,
  right: RouterAbEd25519YaoCeremonyBindingV1,
): boolean {
  return (
    left.operation === right.operation &&
    sameRouterAbEd25519YaoByteSequence(left.session_id, right.session_id) &&
    sameRouterAbEd25519YaoByteSequence(
      left.stable_key_context_binding,
      right.stable_key_context_binding,
    ) &&
    sameRouterAbMpcMaterialActivationRef(left.material_activation, right.material_activation) &&
    left.lifecycle.lifecycle_id === right.lifecycle.lifecycle_id &&
    left.lifecycle.work_kind === right.lifecycle.work_kind &&
    left.lifecycle.primitive_request_kind === right.lifecycle.primitive_request_kind &&
    left.lifecycle.root_share_epoch === right.lifecycle.root_share_epoch &&
    left.lifecycle.account_id === right.lifecycle.account_id &&
    left.lifecycle.session_id === right.lifecycle.session_id &&
    left.lifecycle.signer_set_id === right.lifecycle.signer_set_id &&
    left.lifecycle.selected_server_id === right.lifecycle.selected_server_id
  );
}

function sameRouterAbEd25519YaoByteSequence(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
