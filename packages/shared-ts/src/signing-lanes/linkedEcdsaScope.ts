import type {
  MpcMaterialActivationRef,
  MpcMaterialActivationId,
  WalletId,
} from '../utils/domainIds';
import {
  type LaneEnrollmentId,
  type LaneOperationId,
  type LaneShareEpoch,
  type SigningLaneId,
  type WalletKeyId,
} from './ids';
import { hasWhitespaceOrControlCharacters } from '../utils/domainIds';
import { type DigestB64u } from '../utils/canonicalPrimitives';
import { type Secp256k1CompressedPublicKeyB64u } from '../passkey-custody/primitives';
import {
  type LaneHolderParticipantId,
  type HpkePublicKeyB64u,
  type LaneParticipantBindingDigestB64u,
  type SigningWorkerParticipantId,
  type SigningWorkerRecipientKeyDigestB64u,
  type SigningWorkerRecipientKeyId,
} from './participants';
import type { EcdsaTargetCapabilityBindingV1 } from './rotation';

type LinkedEcdsaScopeOwnerFieldsForbiddenV1 = {
  readonly signingRootId?: never;
  readonly signingRootVersion?: never;
  readonly context?: never;
  readonly publicIdentity?: never;
  readonly signingWorker?: never;
  readonly activationEpoch?: never;
  readonly keyHandle?: never;
  readonly relayerKeyId?: never;
  readonly participantIds?: never;
  readonly runtimePolicyScope?: never;
  readonly authorization?: never;
};

/**
 * Trusted public identity for a linked ECDSA lane.
 *
 * The scope intentionally models the activated lane rather than the owner
 * derivation root. Root metadata and owner public-identity bags are forbidden
 * at the type level and rejected by the exact parser at runtime.
 */
export type LinkedDeviceEcdsaNormalSigningScopeV1 = LinkedEcdsaScopeOwnerFieldsForbiddenV1 & {
  readonly kind: 'linked_device_ecdsa_normal_signing_scope_v1';
  readonly keyFamily: 'ecdsa_secp256k1';
  readonly laneKind: 'linked_device';
  readonly walletId: WalletId;
  readonly walletKeyId: WalletKeyId;
  readonly enrollmentId: LaneEnrollmentId;
  readonly operationId: LaneOperationId;
  readonly laneId: SigningLaneId;
  readonly laneShareEpoch: LaneShareEpoch;
  readonly revocationEpoch: number;
  readonly targetMaterialActivationId: MpcMaterialActivationId;
  readonly materialActivation: MpcMaterialActivationRef;
  readonly targetCapability: EcdsaTargetCapabilityBindingV1;
  readonly thresholdPublicKey33B64u: Secp256k1CompressedPublicKeyB64u;
  readonly evmAddress: string;
  readonly publicIdentityDigestB64u: DigestB64u;
  readonly targetHolderPublicCommitmentB64u: Secp256k1CompressedPublicKeyB64u;
  readonly targetServerPublicCommitmentB64u: Secp256k1CompressedPublicKeyB64u;
  readonly holderParticipantId: LaneHolderParticipantId;
  readonly signingWorkerParticipantId: SigningWorkerParticipantId;
  readonly holderParticipantBindingDigestB64u: LaneParticipantBindingDigestB64u;
  readonly signingWorkerParticipantBindingDigestB64u: LaneParticipantBindingDigestB64u;
  readonly holderRecipientKeyDigestB64u: SigningWorkerRecipientKeyDigestB64u;
  readonly serverRecipientKeyDigestB64u: SigningWorkerRecipientKeyDigestB64u;
  readonly signingWorkerRecipientKeyId: SigningWorkerRecipientKeyId;
  readonly signingWorkerHpkePublicKeyB64u: HpkePublicKeyB64u;
  readonly transcriptHashB64u: DigestB64u;
  readonly protocolCommitReceiptDigestB64u: DigestB64u;
};

export type LinkedDeviceEcdsaNormalSigningScopeInputV1 = Omit<
  LinkedDeviceEcdsaNormalSigningScopeV1,
  'kind' | 'keyFamily' | 'laneKind'
>;

export function buildLinkedDeviceEcdsaNormalSigningScopeV1(
  input: LinkedDeviceEcdsaNormalSigningScopeInputV1,
): LinkedDeviceEcdsaNormalSigningScopeV1 {
  const scope = {
    kind: 'linked_device_ecdsa_normal_signing_scope_v1' as const,
    keyFamily: 'ecdsa_secp256k1' as const,
    laneKind: 'linked_device' as const,
    walletId: input.walletId,
    walletKeyId: input.walletKeyId,
    enrollmentId: input.enrollmentId,
    operationId: input.operationId,
    laneId: input.laneId,
    laneShareEpoch: input.laneShareEpoch,
    revocationEpoch: input.revocationEpoch,
    targetMaterialActivationId: input.targetMaterialActivationId,
    materialActivation: input.materialActivation,
    targetCapability: input.targetCapability,
    thresholdPublicKey33B64u: input.thresholdPublicKey33B64u,
    evmAddress: input.evmAddress,
    publicIdentityDigestB64u: input.publicIdentityDigestB64u,
    targetHolderPublicCommitmentB64u: input.targetHolderPublicCommitmentB64u,
    targetServerPublicCommitmentB64u: input.targetServerPublicCommitmentB64u,
    holderParticipantId: input.holderParticipantId,
    signingWorkerParticipantId: input.signingWorkerParticipantId,
    holderParticipantBindingDigestB64u: input.holderParticipantBindingDigestB64u,
    signingWorkerParticipantBindingDigestB64u: input.signingWorkerParticipantBindingDigestB64u,
    holderRecipientKeyDigestB64u: input.holderRecipientKeyDigestB64u,
    serverRecipientKeyDigestB64u: input.serverRecipientKeyDigestB64u,
    signingWorkerRecipientKeyId: input.signingWorkerRecipientKeyId,
    signingWorkerHpkePublicKeyB64u: input.signingWorkerHpkePublicKeyB64u,
    transcriptHashB64u: input.transcriptHashB64u,
    protocolCommitReceiptDigestB64u: input.protocolCommitReceiptDigestB64u,
  } satisfies LinkedDeviceEcdsaNormalSigningScopeV1;
  validateLinkedDeviceEcdsaNormalSigningScopeV1(scope);
  return scope;
}

function validateLinkedDeviceEcdsaNormalSigningScopeV1(
  scope: LinkedDeviceEcdsaNormalSigningScopeV1,
): void {
  if (scope.kind !== 'linked_device_ecdsa_normal_signing_scope_v1') {
    throw new Error('linked ECDSA scope kind is invalid');
  }
  if (scope.keyFamily !== 'ecdsa_secp256k1' || scope.laneKind !== 'linked_device') {
    throw new Error('linked ECDSA scope discriminator is invalid');
  }
  if (scope.materialActivation.activationId !== scope.targetMaterialActivationId) {
    throw new Error('linked ECDSA scope activation id does not match material activation');
  }
  if (!Number.isSafeInteger(scope.revocationEpoch) || scope.revocationEpoch < 0) {
    throw new Error('linked ECDSA scope revocation epoch is invalid');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(scope.evmAddress)) {
    throw new Error('linked ECDSA scope EVM address is invalid');
  }
  requireVisibleText(scope.holderParticipantId, 'holderParticipantId');
  requireVisibleText(scope.signingWorkerParticipantId, 'signingWorkerParticipantId');
}

function requireVisibleText(value: string, label: string): void {
  if (!value || hasWhitespaceOrControlCharacters(value)) {
    throw new Error(`${label} must contain visible non-whitespace text`);
  }
}
