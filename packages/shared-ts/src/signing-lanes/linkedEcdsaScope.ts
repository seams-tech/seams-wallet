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
