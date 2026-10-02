import {
  buildPreparedOwnerWalletExecution,
  type ClaimedWalletExecutionAuthorization,
  type PreparedOwnerWalletExecution,
} from './execution';
import type { ActiveSigningLaneReference } from './records';
import type { MpcMaterialActivationRef } from '../utils/domainIds';

declare const authorization: ClaimedWalletExecutionAuthorization;
declare const materialActivation: MpcMaterialActivationRef;
declare const ownerLane: PreparedOwnerWalletExecution['lane'];
declare const linkedLane: ActiveSigningLaneReference & { readonly laneKind: 'linked_device' };

buildPreparedOwnerWalletExecution({ authorization, materialActivation, lane: ownerLane });

buildPreparedOwnerWalletExecution({
  authorization,
  materialActivation,
  // @ts-expect-error linked-device lanes cannot construct owner execution
  lane: linkedLane,
});
