import {
  buildPreparedOwnerWalletExecution,
  type ClaimedWalletExecutionAuthorization,
  type PreparedLinkedDeviceWalletExecution,
  type PreparedOwnerWalletExecution,
} from './execution';
import type { MpcMaterialActivationRef } from '../utils/domainIds';

declare const authorization: ClaimedWalletExecutionAuthorization;
declare const materialActivation: MpcMaterialActivationRef;
declare const ownerLane: PreparedOwnerWalletExecution['lane'];
declare const linkedLane: PreparedLinkedDeviceWalletExecution['lane'];

buildPreparedOwnerWalletExecution({ authorization, materialActivation, lane: ownerLane });

buildPreparedOwnerWalletExecution({
  authorization,
  materialActivation,
  // @ts-expect-error linked-device lanes cannot construct owner execution
  lane: linkedLane,
});
