import type { MpcMaterialActivationRef } from '../utils/domainIds';
import type { LaneShareEpoch, SigningLaneId } from './ids';
import type {
  LaneHolderParticipantId,
  SigningWorkerParticipantId,
  SigningWorkerRecipientKeyId,
} from './participants';
import type { SigningLaneKind } from './records';
import type { OwnerLaneParticipantContinuityV1 } from './ownerContinuity';

type ActiveLaneProtocolSourceBaseV1 = {
  laneId: SigningLaneId;
  laneShareEpoch: LaneShareEpoch;
  revocationEpoch: number;
  participantBindingDigestB64u: string;
  materialActivation: MpcMaterialActivationRef;
};

/** Existing owner signer rows expose continuity, without linked-lane HPKE identities. */
type OwnerLaneProtocolSourceV1 = ActiveLaneProtocolSourceBaseV1 & {
  sourceKind: 'owner_registration';
  laneKind: 'owner_passkey' | 'owner_email_otp';
  ownerParticipantContinuity: OwnerLaneParticipantContinuityV1;
  holderParticipantId?: never;
  signingWorkerParticipantId?: never;
  signingWorkerRecipientKeyId?: never;
};

/** Independently provisioned lanes carry their durable holder/worker identities. */
type ProvisionedLaneProtocolSourceV1 = ActiveLaneProtocolSourceBaseV1 & {
  sourceKind: 'provisioned_lane';
  laneKind: Exclude<SigningLaneKind, 'owner_passkey' | 'owner_email_otp'>;
  holderParticipantId: LaneHolderParticipantId;
  signingWorkerParticipantId: SigningWorkerParticipantId;
  signingWorkerRecipientKeyId: SigningWorkerRecipientKeyId;
  ownerParticipantContinuity?: never;
};

export type ActiveLaneProtocolSourceV1 =
  | OwnerLaneProtocolSourceV1
  | ProvisionedLaneProtocolSourceV1;
