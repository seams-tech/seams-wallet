import type { NearEd25519MaterialIdentity } from '@/core/signingEngine/interfaces/operationDeps';
import {
  exactEd25519SigningLaneIdentity,
  exactSigningLaneIdentityKey,
  exactSigningLaneIdentityMatches,
  nearEd25519SignerBindingFromBoundaryFields,
  type ExactEd25519ExportMaterialIdentity,
  type ExactEd25519SigningLaneIdentity,
} from '../identity/exactSigningLaneIdentity';
import { signingLaneAuthBindingKey } from '../identity/signingLaneAuthBinding';
import {
  isConcreteAvailableSigningLane,
  type AvailableEd25519SigningLane,
  type ConcreteAvailableEd25519SigningLane,
} from '../availability/availableSigningLanes';
import { SigningSessionIds } from '../operationState/types';
import {
  mpcMaterialActivationRefsEqual,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import { materialActivationKey } from '../sealedRecovery/materialActivationKey';

export type NearEd25519CapabilityRehydrationSubject =
  | {
      readonly kind: 'exact_lane';
      readonly laneIdentity: ExactEd25519SigningLaneIdentity;
    }
  | {
      readonly kind: 'export_exact_lane';
      readonly laneIdentity: ExactEd25519ExportMaterialIdentity;
      readonly materialActivation: MpcMaterialActivationRef;
    }
  | {
      readonly kind: 'material_identity';
      readonly materialIdentity: NearEd25519MaterialIdentity;
    };

export function exactEd25519LaneIdentityFromAvailableLane(
  lane: ConcreteAvailableEd25519SigningLane,
): ExactEd25519SigningLaneIdentity {
  if (!lane.authorization) {
    throw new Error('Available Ed25519 lane requires Wallet Session authorization');
  }
  return exactEd25519SigningLaneIdentity({
    signer: nearEd25519SignerBindingFromBoundaryFields({
      walletId: lane.walletId,
      nearAccountId: lane.nearAccountId,
      nearEd25519SigningKeyId: lane.nearEd25519SigningKeyId,
      signerSlot: lane.signerSlot,
    }),
    auth: lane.auth,
    walletSessionId: lane.authorization.operationCredential.walletSessionId,
    quotaId: lane.authorization.session.quotaId,
    thresholdSessionId: lane.thresholdSessionId,
  });
}

function nearEd25519MaterialIdentityKey(identity: NearEd25519MaterialIdentity): string {
  const signer = identity.signer;
  return JSON.stringify([
    String(signer.account.wallet.walletId),
    String(signer.account.nearAccountId),
    String(signer.nearEd25519SigningKeyId),
    signer.signerSlot,
    signingLaneAuthBindingKey(identity.auth),
    String(identity.thresholdSessionId),
  ]);
}

function nearEd25519MaterialIdentityFromAvailableLane(
  lane: ConcreteAvailableEd25519SigningLane,
): NearEd25519MaterialIdentity {
  return {
    kind: 'near_ed25519_material_identity',
    signer: nearEd25519SignerBindingFromBoundaryFields({
      walletId: lane.walletId,
      nearAccountId: lane.nearAccountId,
      nearEd25519SigningKeyId: lane.nearEd25519SigningKeyId,
      signerSlot: lane.signerSlot,
    }),
    auth: lane.auth,
    thresholdSessionId: SigningSessionIds.thresholdEd25519Session(lane.thresholdSessionId),
  };
}

function nearEd25519ExportMaterialIdentityAsMaterialIdentity(
  identity: ExactEd25519ExportMaterialIdentity,
): NearEd25519MaterialIdentity {
  return {
    kind: 'near_ed25519_material_identity',
    signer: identity.signer,
    auth: identity.auth,
    thresholdSessionId: identity.thresholdSessionId,
  };
}

export function nearEd25519CapabilityRehydrationMaterialIdentity(
  subject: NearEd25519CapabilityRehydrationSubject,
): NearEd25519MaterialIdentity {
  switch (subject.kind) {
    case 'exact_lane':
      return {
        kind: 'near_ed25519_material_identity',
        signer: subject.laneIdentity.signer,
        auth: subject.laneIdentity.auth,
        thresholdSessionId: subject.laneIdentity.thresholdSessionId,
      };
    case 'export_exact_lane':
      return nearEd25519ExportMaterialIdentityAsMaterialIdentity(subject.laneIdentity);
    case 'material_identity':
      return subject.materialIdentity;
    default:
      return assertNeverNearEd25519CapabilityRehydrationSubject(subject);
  }
}

export function nearEd25519LaneMatchesCapabilityRehydrationSubject(
  lane: AvailableEd25519SigningLane,
  subject: NearEd25519CapabilityRehydrationSubject,
): boolean {
  if (!isConcreteAvailableSigningLane(lane) || lane.curve !== 'ed25519') return false;
  const subjectIdentity = nearEd25519CapabilityRehydrationMaterialIdentity(subject);
  const subjectSigner = subjectIdentity.signer;
  if (
    String(lane.walletId) !== String(subjectSigner.account.wallet.walletId) ||
    String(lane.nearAccountId) !== String(subjectSigner.account.nearAccountId) ||
    lane.signerSlot !== subjectSigner.signerSlot ||
    String(lane.thresholdSessionId) !== subjectIdentity.thresholdSessionId
  ) {
    return false;
  }
  switch (subject.kind) {
    case 'exact_lane':
      return (
        lane.authorizationState === 'authorized' &&
        exactSigningLaneIdentityMatches(
          exactEd25519LaneIdentityFromAvailableLane(lane),
          subject.laneIdentity,
        )
      );
    case 'export_exact_lane':
      return (
        nearEd25519MaterialIdentityKey(nearEd25519MaterialIdentityFromAvailableLane(lane)) ===
          nearEd25519MaterialIdentityKey(subjectIdentity) &&
        mpcMaterialActivationRefsEqual(lane.materialActivation, subject.materialActivation)
      );
    case 'material_identity':
      return (
        nearEd25519MaterialIdentityKey(nearEd25519MaterialIdentityFromAvailableLane(lane)) ===
        nearEd25519MaterialIdentityKey(subjectIdentity)
      );
    default:
      return assertNeverNearEd25519CapabilityRehydrationSubject(subject);
  }
}

export function nearEd25519CapabilityRehydrationKey(
  subject: NearEd25519CapabilityRehydrationSubject,
): string {
  switch (subject.kind) {
    case 'exact_lane':
      return JSON.stringify([subject.kind, exactSigningLaneIdentityKey(subject.laneIdentity)]);
    case 'export_exact_lane':
      return JSON.stringify([
        subject.kind,
        nearEd25519MaterialIdentityKey(
          nearEd25519ExportMaterialIdentityAsMaterialIdentity(subject.laneIdentity),
        ),
        materialActivationKey(subject.materialActivation),
      ]);
    case 'material_identity':
      return JSON.stringify([
        subject.kind,
        nearEd25519MaterialIdentityKey(subject.materialIdentity),
      ]);
    default:
      return assertNeverNearEd25519CapabilityRehydrationSubject(subject);
  }
}

function assertNeverNearEd25519CapabilityRehydrationSubject(value: never): never {
  throw new Error(`Unknown Ed25519 capability rehydration subject: ${String(value)}`);
}
