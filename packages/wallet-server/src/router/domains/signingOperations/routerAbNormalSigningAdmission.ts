import type { D1EcdsaAdmissionPolicyRead } from '../../cloudflare/d1/signingAdmission/d1RouterAbNormalSigningAdmissionStore';
// What both normal-signing routes share: JSON results and refusals, the owner step-up decision
// a failed Wallet Session leads to, route admissions and the policy admission adapter, and the
// authorized-operation record an admitted request carries.
import type { RouterAbNormalSigningAuthorizationIdentity } from '../../../core/routerAbSigning/RouterAbNormalSigningRuntime';
import type { RouterAbNormalSigningRuntime } from '../../../core/routerAbSigning/RouterAbNormalSigningRuntime';
import type { ThresholdEd25519AuthorityScope } from '../../../core/types';
import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type { WalletSessionFailureCode } from '@shared/utils/walletSessionFailure';
import { walletSessionFailureStatus } from '../../auth/walletSessionFailure';
import type { AuthorizationParseResult } from '@shared/authorization/capabilityKinds';
import type {
  AuthorizedOperation,
  AuthorizedOperationReplayResponse,
  OwnerOperationStepUpReason,
} from '../../../authorization/domain';
import type { RouterAbMpcMaterialActivationRefWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  parseMpcMaterialActivationId,
  type MpcMaterialActivationId,
} from '@shared/utils/domainIds';

export type RouterAbSigningWorkerJsonResult =
  | {
      ok: true;
      body: unknown;
      replay: AuthorizedOperationReplayResponse;
    }
  | {
      ok: false;
      status: number;
      body: { ok: false; code: string; message: string };
    };
export type RouterAbSigningWorkerJsonError = Extract<
  RouterAbSigningWorkerJsonResult,
  { ok: false }
>;

export type RouterAbJsonRouteResult = {
  status: number;
  body: unknown;
};

export type RouterAbEcdsaOperationAdmissionKind = 'claimed' | 'operation_in_progress' | 'replayed';

export type RouterAbEcdsaOperationAdmission = {
  readonly kind: RouterAbEcdsaOperationAdmissionKind;
  readonly operation: AuthorizedOperation;
};

// On prepare, a missing, expired, exhausted or ended Wallet Session asks the owner to step up,
// or is denied when no step-up can be prepared. Every other failure is left to the caller.
export function routerAbOwnerOperationStepUpDecision<TStepUp>(input: {
  readonly code: string;
  readonly phase: 'prepare' | 'finalize';
  readonly stepUp?: TStepUp;
}):
  | {
      readonly kind: 'step_up_required';
      readonly reason: OwnerOperationStepUpReason;
      readonly step_up: TStepUp;
    }
  | {
      readonly kind: 'denied';
      readonly denial: { readonly code: 'authorization_unavailable'; readonly message: string };
    }
  | null {
  const reason: OwnerOperationStepUpReason | null = (() => {
    switch (input.code) {
      case 'wallet_session_missing':
        return 'wallet_session_missing';
      case 'wallet_session_expired':
        return 'wallet_session_expired';
      case 'wallet_budget_exhausted':
      case 'wallet_session_quota_exhausted':
        return 'wallet_session_exhausted';
      case 'wallet_session_invalid':
        return 'wallet_session_ended';
      default:
        return null;
    }
  })();
  if (!reason || input.phase !== 'prepare') return null;
  if (input.stepUp) return { kind: 'step_up_required', reason, step_up: input.stepUp };
  return {
    kind: 'denied',
    denial: {
      code: 'authorization_unavailable',
      message: 'Owner operation step-up preparation is unavailable',
    },
  };
}

export function routerAbOwnerOperationFailureResult(
  input: { readonly status: number; readonly code: string; readonly message: string },
  decision: object | null,
): RouterAbJsonRouteResult {
  return {
    status: input.status,
    body: {
      ok: false,
      code: input.code,
      message: input.message,
      ...(decision ? { authorization_decision: decision } : {}),
    },
  };
}

export type RouterAbNormalSigningRouteRuntime = Pick<
  RouterAbNormalSigningRuntime,
  'getSigningWorkerPrivateTransport' | 'reservePrepareReplay'
>;

type AcceptedRouteAdmission = {
  ok: true;
  thresholdSessionId: string;
  requestId: string;
  expiresAtMs: number;
  readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
};

export type AcceptedEcdsaRouteAdmission = AcceptedRouteAdmission & {
  readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
};

type RejectedRouteAdmission = {
  ok: false;
  error: RouterAbSigningWorkerJsonError;
};

export type RouterAbNormalSigningRouteAdmission =
  | AcceptedRouteAdmission
  | AcceptedEcdsaRouteAdmission
  | RejectedRouteAdmission;

export type RouterAbNormalSigningAdmissionFailureCode =
  | 'project_policy_rejected'
  | 'abuse_rejected'
  | 'rate_limited'
  | 'unauthorized'
  | 'invalid_body'
  | 'not_configured'
  | 'internal';

export type RouterAbNormalSigningAdmissionFailure = {
  ok: false;
  status: 400 | 401 | 403 | 408 | 409 | 429 | 500 | 501 | 503;
  code: RouterAbNormalSigningAdmissionFailureCode;
  message: string;
};

export type RouterAbNormalSigningAdmissionResult =
  | { ok: true }
  | RouterAbNormalSigningAdmissionFailure;

type RouterAbNormalSigningPolicyReadSource =
  | { readonly kind: 'database'; readonly policyRead?: never }
  | { readonly kind: 'credential_snapshot'; readonly policyRead: D1EcdsaAdmissionPolicyRead };

export type RouterAbNormalSigningAdmissionInput =
  | {
      curve: 'ed25519';
      readonly policyReadSource?: never;
      authorityKind: 'wallet_authority_v1';
      authorityId: string;
      authorityScope?: never;
      phase: 'prepare' | 'finalize';
      walletId: string;
      thresholdSessionId: string;
      walletSessionId: string;
      quotaId: string;
      requestId: string;
      expiresAtMs: number;
      signingWorkerId: string;
      runtimePolicyScope: RuntimePolicyScope;
    }
  | {
      curve: 'ed25519';
      readonly policyReadSource?: never;
      authorityKind?: never;
      authorityId?: never;
      phase: 'prepare' | 'finalize';
      walletId: string;
      authorityScope: ThresholdEd25519AuthorityScope;
      thresholdSessionId: string;
      walletSessionId: string;
      quotaId: string;
      requestId: string;
      expiresAtMs: number;
      signingWorkerId: string;
      runtimePolicyScope: RuntimePolicyScope;
    }
  | {
      curve: 'ecdsa';
      readonly policyReadSource: RouterAbNormalSigningPolicyReadSource;
      phase: 'prepare' | 'finalize';
      walletId: string;
      materialActivationId: MpcMaterialActivationId;
      authorizationIdentity: RouterAbNormalSigningAuthorizationIdentity;
      requestId: string;
      expiresAtMs: number;
      signingWorkerId: string;
      keyHandle: string;
      runtimePolicyScope: RuntimePolicyScope;
    };

export interface RouterAbNormalSigningAdmissionAdapter {
  evaluatePolicy(
    input: RouterAbNormalSigningAdmissionInput,
  ): Promise<RouterAbNormalSigningAdmissionResult>;
}

export type RouterAbNormalSigningAdmissionEvaluationInput =
  | {
      adapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
      curve: 'ed25519';
      readonly policyReadSource?: never;
      authorizationKind: 'wallet_session_operation_credential_v1';
      phase: 'prepare' | 'finalize';
      walletId: string;
      authorityId: string;
      thresholdSessionId: string;
      walletSessionId: string;
      quotaId: string;
      requestId: string;
      expiresAtMs: number;
      signingWorkerId: string;
      runtimePolicyScope: RuntimePolicyScope;
    }
  | {
      adapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
      curve: 'ecdsa';
      readonly policyReadSource: RouterAbNormalSigningPolicyReadSource;
      authorizationKind: 'wallet_session_operation_credential_v1';
      phase: 'prepare' | 'finalize';
      walletId: string;
      walletSessionId: string;
      materialActivation: RouterAbMpcMaterialActivationRefWire;
      requestId: string;
      expiresAtMs: number;
      signingWorkerId: string;
      keyHandle: string;
      runtimePolicyScope: RuntimePolicyScope;
      admission: AcceptedEcdsaRouteAdmission;
    };

export async function evaluateRouterAbNormalSigningAdmission(
  input: RouterAbNormalSigningAdmissionEvaluationInput,
): Promise<RouterAbNormalSigningAdmissionResult> {
  if (!input.adapter) {
    return {
      ok: false,
      status: 501,
      code: 'not_configured',
      message: 'Router A/B normal-signing admission adapter is not configured',
    };
  }

  if (input.curve === 'ed25519') {
    return await input.adapter.evaluatePolicy({
      curve: 'ed25519',
      authorityKind: 'wallet_authority_v1',
      authorityId: input.authorityId,
      phase: input.phase,
      walletId: input.walletId,
      thresholdSessionId: input.thresholdSessionId,
      walletSessionId: input.walletSessionId,
      quotaId: input.quotaId,
      requestId: input.requestId,
      expiresAtMs: input.expiresAtMs,
      signingWorkerId: input.signingWorkerId,
      runtimePolicyScope: input.runtimePolicyScope,
    });
  }

  return await input.adapter.evaluatePolicy({
    curve: 'ecdsa',
    policyReadSource: input.policyReadSource,
    phase: input.phase,
    walletId: input.walletId,
    materialActivationId: requireMpcMaterialActivationId(
      input.admission.materialActivation.activation_id,
    ),
    authorizationIdentity: {
      kind: 'reusable_wallet_session',
      walletSessionId: input.walletSessionId,
    },
    requestId: input.admission.requestId,
    expiresAtMs: input.admission.expiresAtMs,
    signingWorkerId: input.signingWorkerId,
    keyHandle: input.keyHandle,
    runtimePolicyScope: input.runtimePolicyScope,
  });
}

export function routerAbSigningError(
  status: number,
  code: string,
  message: string,
): RouterAbSigningWorkerJsonError {
  return { ok: false, status, body: { ok: false, code, message } };
}

export function routerAbWalletSessionValidationStatus(
  code: 'sessions_disabled' | WalletSessionFailureCode,
): number {
  if (code === 'sessions_disabled') return 501;
  return walletSessionFailureStatus(code);
}

export function requireMpcMaterialActivationId(value: unknown): MpcMaterialActivationId {
  const parsed = parseMpcMaterialActivationId(value);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

export function requireAuthorizationValue<T>(result: AuthorizationParseResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function routerAbStepUpError(
  status: number,
  code: string,
  message: string,
): RouterAbJsonRouteResult {
  return { status, body: { ok: false, code, message } };
}

export function routerAbErrorMessage(error: unknown): string {
  return String(
    error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message
      : error || 'unknown error',
  );
}
