import type { PositiveRemainingUses } from '../../threshold/sessionPolicy';
import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { MpcMaterialActivationRef } from '@shared/utils/domainIds';
import {
  exactSigningLaneCurve,
  exactSigningLaneIdentityKey,
  exactSigningLaneWalletId,
  isExactEcdsaSigningLaneIdentity,
  thresholdSessionIdsFromExactSigningLaneIdentity,
  type ExactSigningLaneIdentity,
  type ExactSigningLaneIdentityKey,
  type NonEmptyThresholdSessionIds,
} from '../identity/exactSigningLaneIdentity';
import { signingLaneAuthMethod } from '../identity/signingLaneAuthBinding';
import type { SigningCurve, SigningOperationFingerprint, SigningOperationId } from './types';
import type {
  MpcWalletSigningQuotaId,
  WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import type { SignerAuthMethod } from '@shared/utils/signerDomain';

type SigningStatusProvenance =
  | {
      kind: 'trusted_server_budget_status';
      projectionVersion: string;
      observedAtMs: number;
    }
  | {
      kind: 'restored_sealed_record_status';
      recordVersion: string;
      updatedAtMs: number;
    }
  | {
      kind: 'email_otp_refresh_boundary';
      httpStatus: 401 | 403;
      observedAtMs: number;
    };

type StepUpProjectionState =
  | {
      kind: 'known';
      version: string;
    }
  | {
      kind: 'unavailable';
      reason:
        | 'restored_record_has_no_projection'
        | 'email_otp_refresh_rejected'
        | 'budget_status_unavailable';
    };

type KnownStepUpProjectionState = Extract<StepUpProjectionState, { kind: 'known' }>;

type StepUpExpiryState =
  | {
      kind: 'known';
      expiresAtMs: number;
    }
  | {
      kind: 'unavailable';
      reason:
        | 'restored_record_has_no_expiry'
        | 'email_otp_refresh_rejected'
        | 'budget_status_unavailable';
    };

export type FreshStepUpRequired = {
  kind: 'fresh_step_up_required';
  walletId: WalletId;
  operationId: SigningOperationId;
  operationFingerprint: SigningOperationFingerprint;
  authMethod: SignerAuthMethod;
  curve: SigningCurve;
  laneIdentity: ExactSigningLaneIdentity;
  laneIdentityKey: ExactSigningLaneIdentityKey;
  authority: StepUpFreshnessAuthority;
  projection: StepUpProjectionState;
  expiry: StepUpExpiryState;
  provenance: SigningStatusProvenance;
  reason:
    | 'wallet_budget_exhausted'
    | 'threshold_session_exhausted'
    | 'threshold_session_expired'
    | 'email_otp_refresh_rejected';
};

type FreshStepUpSatisfied = {
  kind: 'fresh_step_up_satisfied';
  walletId: WalletId;
  operationId: SigningOperationId;
  operationFingerprint: SigningOperationFingerprint;
  authMethod: SignerAuthMethod;
  curve: SigningCurve;
  laneIdentity: ExactSigningLaneIdentity;
  laneIdentityKey: ExactSigningLaneIdentityKey;
  authority: StepUpFreshnessAuthority;
  projection: StepUpProjectionState;
  expiry: StepUpExpiryState;
  remainingUses: PositiveRemainingUses;
  provenance: SigningStatusProvenance;
};

export type FreshStepUpSatisfiedForAdmission = Omit<FreshStepUpSatisfied, 'kind' | 'projection'> & {
  kind: 'fresh_step_up_satisfied_for_admission';
  projection: KnownStepUpProjectionState;
};

type StepUpFreshnessAuthority =
  | {
      kind: 'ed25519_threshold_session';
      walletSessionId: WalletSessionId;
      quotaId: MpcWalletSigningQuotaId;
      thresholdSessionIds: NonEmptyThresholdSessionIds;
    }
  | {
      kind: 'ecdsa_material_activation';
      materialActivation: MpcMaterialActivationRef;
      thresholdSessionIds?: never;
    };

type StepUpFreshnessBaseInput = {
  walletId: WalletId;
  operationId: SigningOperationId;
  operationFingerprint: SigningOperationFingerprint;
  laneIdentity: ExactSigningLaneIdentity;
  projection: StepUpProjectionState;
  expiry: StepUpExpiryState;
  provenance: SigningStatusProvenance;
};

function positiveRemainingUses(value: number): PositiveRemainingUses {
  const remainingUses = Math.floor(Number(value) || 0);
  if (remainingUses <= 0) {
    throw new Error('[StepUpFreshness] remainingUses must be positive');
  }
  return remainingUses as PositiveRemainingUses;
}

function validateBase(input: StepUpFreshnessBaseInput): {
  laneIdentityKey: ExactSigningLaneIdentityKey;
  authority: StepUpFreshnessAuthority;
} {
  const laneIdentityKey = exactSigningLaneIdentityKey(input.laneIdentity);
  const laneWalletId = String(exactSigningLaneWalletId(input.laneIdentity));
  if (String(input.walletId) !== laneWalletId) {
    throw new Error('[StepUpFreshness] walletId does not match exact lane identity');
  }
  return {
    laneIdentityKey,
    authority: isExactEcdsaSigningLaneIdentity(input.laneIdentity)
      ? {
          kind: 'ecdsa_material_activation',
          materialActivation: input.laneIdentity.signer.materialActivation,
        }
      : {
          kind: 'ed25519_threshold_session',
          walletSessionId: input.laneIdentity.walletSessionId,
          quotaId: input.laneIdentity.quotaId,
          thresholdSessionIds: thresholdSessionIdsFromExactSigningLaneIdentity(input.laneIdentity),
        },
  };
}

export function buildFreshStepUpRequired(
  input: StepUpFreshnessBaseInput & {
    reason: FreshStepUpRequired['reason'];
  },
): FreshStepUpRequired {
  const validated = validateBase(input);
  return {
    kind: 'fresh_step_up_required',
    walletId: input.walletId,
    operationId: input.operationId,
    operationFingerprint: input.operationFingerprint,
    authMethod: signingLaneAuthMethod(input.laneIdentity.auth),
    curve: exactSigningLaneCurve(input.laneIdentity),
    laneIdentity: input.laneIdentity,
    laneIdentityKey: validated.laneIdentityKey,
    authority: validated.authority,
    projection: input.projection,
    expiry: input.expiry,
    provenance: input.provenance,
    reason: input.reason,
  };
}

export function buildFreshStepUpSatisfied(
  input: StepUpFreshnessBaseInput & {
    remainingUses: number;
  },
): FreshStepUpSatisfied {
  const validated = validateBase(input);
  return {
    kind: 'fresh_step_up_satisfied',
    walletId: input.walletId,
    operationId: input.operationId,
    operationFingerprint: input.operationFingerprint,
    authMethod: signingLaneAuthMethod(input.laneIdentity.auth),
    curve: exactSigningLaneCurve(input.laneIdentity),
    laneIdentity: input.laneIdentity,
    laneIdentityKey: validated.laneIdentityKey,
    authority: validated.authority,
    projection: input.projection,
    expiry: input.expiry,
    remainingUses: positiveRemainingUses(input.remainingUses),
    provenance: input.provenance,
  };
}

export function buildFreshStepUpSatisfiedForAdmission(
  state: FreshStepUpSatisfied,
): FreshStepUpSatisfiedForAdmission {
  if (state.projection.kind !== 'known') {
    throw new Error('[StepUpFreshness] admission requires a known projection');
  }
  return {
    ...state,
    kind: 'fresh_step_up_satisfied_for_admission',
    projection: state.projection,
  };
}
