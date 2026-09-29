import type { LaneShareEpoch, SigningLaneId, WalletKeyId } from '@shared/signing-lanes/ids';
import type { MpcMaterialActivationRef } from '@shared/utils/domainIds';

export type ExactLaneMaterialInvalidationTargetV1 = {
  readonly walletKeyId: WalletKeyId;
  readonly laneId: SigningLaneId;
  readonly laneShareEpoch: LaneShareEpoch;
  readonly materialActivation: MpcMaterialActivationRef;
};

type LaneMaterialInvalidationReasonV1 = 'refresh' | 'revoke';

export type LaneMaterialInvalidationPlanV1 = {
  readonly kind: 'lane_material_invalidation_plan_v1';
  readonly target: ExactLaneMaterialInvalidationTargetV1;
  readonly reason: LaneMaterialInvalidationReasonV1;
  readonly keyFamily: 'ecdsa_secp256k1' | 'ed25519';
  readonly effect: 'worker_lane_material_and_curve_state';
};

function exactTarget(
  target: ExactLaneMaterialInvalidationTargetV1,
): ExactLaneMaterialInvalidationTargetV1 {
  if (!String(target.walletKeyId).trim()) throw new Error('walletKeyId is required');
  if (!String(target.laneId).trim()) throw new Error('laneId is required');
  if (!String(target.laneShareEpoch).trim()) throw new Error('laneShareEpoch is required');
  if (!String(target.materialActivation.activationId).trim()) {
    throw new Error('materialActivation.activationId is required');
  }
  return target;
}

export function buildLaneMaterialInvalidationPlanV1(args: {
  readonly target: ExactLaneMaterialInvalidationTargetV1;
  readonly reason: LaneMaterialInvalidationReasonV1;
  readonly keyFamily: 'ecdsa_secp256k1' | 'ed25519';
}): LaneMaterialInvalidationPlanV1 {
  const target = exactTarget(args.target);
  return {
    kind: 'lane_material_invalidation_plan_v1',
    target,
    reason: args.reason,
    keyFamily: args.keyFamily,
    effect: 'worker_lane_material_and_curve_state',
  };
}
