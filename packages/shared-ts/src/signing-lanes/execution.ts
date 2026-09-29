import type { AuthorizedOperationId, CapabilityId } from '../authorization/capabilityKinds';
import type { CapabilityOperationFingerprintDigest } from '../authorization/operationFingerprint';
import type { MpcMaterialActivationRef } from '../utils/domainIds';
import type { LinkedDeviceEnrollmentId } from './ids';
import type { ActiveSigningLaneReference } from './records';

export type ClaimedWalletExecutionAuthorization = {
  readonly kind: 'claimed_wallet_execution_authorization_v1';
  readonly authorizedOperationId: AuthorizedOperationId;
  readonly operationFingerprintDigest: CapabilityOperationFingerprintDigest;
  readonly capabilityId: CapabilityId;
};

type PreparedWalletExecutionBase = {
  readonly authorization: ClaimedWalletExecutionAuthorization;
  readonly materialActivation: MpcMaterialActivationRef;
};

export type PreparedOwnerWalletExecution = PreparedWalletExecutionBase & {
  readonly kind: 'prepared_owner_wallet_execution';
  readonly laneKind: 'owner_passkey' | 'owner_email_otp' | 'recovery' | 'break_glass';
  readonly lane: ActiveSigningLaneReference & {
    readonly laneKind: PreparedOwnerWalletExecution['laneKind'];
  };
  readonly linkedDeviceEnrollmentId?: never;
  readonly delegatedAuthorizationId?: never;
  readonly budgetClaim?: never;
};

export type PreparedLinkedDeviceWalletExecution = PreparedWalletExecutionBase & {
  readonly kind: 'prepared_linked_device_wallet_execution';
  readonly laneKind: 'linked_device';
  readonly lane: ActiveSigningLaneReference & { readonly laneKind: 'linked_device' };
  readonly linkedDeviceEnrollmentId: LinkedDeviceEnrollmentId;
  readonly delegatedAuthorizationId?: never;
  readonly budgetClaim?: never;
};

export function buildPreparedOwnerWalletExecution(input: {
  readonly authorization: ClaimedWalletExecutionAuthorization;
  readonly materialActivation: MpcMaterialActivationRef;
  readonly lane: PreparedOwnerWalletExecution['lane'];
}): PreparedOwnerWalletExecution {
  return {
    kind: 'prepared_owner_wallet_execution',
    laneKind: input.lane.laneKind,
    authorization: input.authorization,
    materialActivation: input.materialActivation,
    lane: input.lane,
  };
}
