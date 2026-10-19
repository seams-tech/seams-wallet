import { type RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import { type RegistrationIntentV1 } from '@shared/utils/registrationIntent';
import {
  findRegistrationSignerPlanEvmFamilyEcdsaBranch,
  findRegistrationSignerPlanNearEd25519Branch,
  registrationSignerPlanFromSelection,
  type RegistrationEvmFamilyEcdsaSignerPlan,
  type RegistrationNearEd25519SignerPlan,
  type RegistrationSignerPlan,
} from '@shared/utils/registrationSignerPlan';
import {
  buildStoredWalletRegistrationPreparedContext,
  type StoredWalletRegistrationPreparedContext,
} from '../../../../core/RegistrationCeremonyStore';
import {
  type WalletRegistrationRouteDiagnostics,
  type WalletRegistrationRouteTimingName,
} from '../../../../core/registrationContracts';
import { type ThresholdEcdsaChainTarget } from '../../../../core/thresholdEcdsaChainTarget';
import { normalizeThresholdEcdsaChainTargets } from './d1RegistrationCeremonyRecords';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

export function startD1RegistrationRouteTiming(
  name: WalletRegistrationRouteTimingName,
): D1RegistrationRouteTimingMark {
  return {
    name,
    startedAtMs: Date.now(),
  };
}

export function finishD1RegistrationRouteTiming(
  recorder: D1RegistrationRouteTimingRecorder,
  mark: D1RegistrationRouteTimingMark,
): void {
  recorder.entries.push({
    name: mark.name,
    durationMs: Math.max(0, Date.now() - mark.startedAtMs),
  });
}

export function createD1RegistrationRouteTimingRecorder(
  route: WalletRegistrationRouteDiagnostics['route'],
): D1RegistrationRouteTimingRecorder {
  return {
    route,
    entries: [],
  };
}

export function registrationIntentSignerBranches(
  intent: RegistrationIntentV1,
): RegistrationIntentSignerBranchesResult {
  const plan = registrationSignerPlanFromSelection(intent.signerSelection);
  if (!plan.ok) return plan;
  return { ok: true, value: registrationSignerBranchesFromPlan(plan.value) };
}

export function resolveRegistrationPreparedContextFromPlan(input: {
  readonly signerPlan: RegistrationSignerPlan;
  readonly runtimePolicyScope: RuntimePolicyScope | undefined;
  readonly signingRootId: string;
  readonly signingRootVersion: string;
}): RegistrationPreparedContextResolution {
  const branches = registrationSignerBranchesFromPlan(input.signerPlan);
  const ecdsaChainTargets = branches.evmFamilyEcdsa
    ? normalizeThresholdEcdsaChainTargets(branches.evmFamilyEcdsa.chainTargets)
    : null;
  if (branches.evmFamilyEcdsa && !ecdsaChainTargets) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'ECDSA registration contains an invalid chain target',
    };
  }
  try {
    return {
      ok: true,
      preparedContext: buildStoredWalletRegistrationPreparedContext({
        signingRootId: input.signingRootId,
        signingRootVersion: input.signingRootVersion,
        runtimePolicyScope: input.runtimePolicyScope || null,
        ecdsaChainTargets,
      }),
      ecdsaChainTargets,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      code: 'invalid_body',
      message: errorMessage(error) || 'registration prepared context is invalid',
    };
  }
}

export function registrationPreparedContextEcdsaChainTargets(
  preparedContext: StoredWalletRegistrationPreparedContext,
): readonly ThresholdEcdsaChainTarget[] | null {
  return preparedContext.ecdsa.kind === 'evm_family_ecdsa_requested'
    ? preparedContext.ecdsa.chainTargets
    : null;
}

type D1RegistrationRouteTimingMark = {
  readonly name: WalletRegistrationRouteTimingName;
  readonly startedAtMs: number;
};

export type D1RegistrationRouteTimingRecorder = {
  readonly route: WalletRegistrationRouteDiagnostics['route'];
  readonly entries: WalletRegistrationRouteDiagnostics['entries'];
};

type RegistrationIntentSignerBranchesResult =
  | { ok: true; value: RegistrationIntentSignerBranches }
  | { ok: false; code: string; message: string };

export function registrationSignerBranchesFromPlan(
  plan: RegistrationSignerPlan,
): RegistrationIntentSignerBranches {
  return {
    plan,
    nearEd25519: findRegistrationSignerPlanNearEd25519Branch(plan),
    evmFamilyEcdsa: findRegistrationSignerPlanEvmFamilyEcdsaBranch(plan),
  };
}

type RegistrationPreparedContextResolution =
  | {
      ok: true;
      preparedContext: StoredWalletRegistrationPreparedContext;
      ecdsaChainTargets: readonly ThresholdEcdsaChainTarget[] | null;
    }
  | {
      ok: false;
      code: 'invalid_body';
      message: string;
    };

type RegistrationIntentSignerBranches = {
  readonly plan: RegistrationSignerPlan;
  readonly nearEd25519: RegistrationNearEd25519SignerPlan | null;
  readonly evmFamilyEcdsa: RegistrationEvmFamilyEcdsaSignerPlan | null;
};
