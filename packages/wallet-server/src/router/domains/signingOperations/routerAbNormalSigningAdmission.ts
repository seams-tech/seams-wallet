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

type RouterAbAcceptedAuthorizedOperationBindingV1 =
  | {
      readonly kind: 'reusable_wallet_session';
      readonly walletSessionId: string;
      readonly quotaId: string;
    }
  | {
      readonly kind: 'gateway_owner_wallet_session';
      readonly subjectId: string;
      readonly accountId: string;
      readonly authorizationId: string;
      readonly walletSessionId: string;
      readonly quotaId: string;
      readonly thresholdSessionId: string;
      readonly orgId: string;
      readonly projectId: string;
      readonly environment: string;
      readonly signingWorkerId: string;
      readonly expiresAtMs: number;
    }
  | {
      readonly kind: 'operation_step_up';
      readonly authorizationSessionId: string;
      readonly orgId: string;
      readonly projectId: string;
      readonly environment: string;
      readonly subjectId: string;
    };

export function buildRouterAbEd25519AcceptedAuthorizedOperationV1(input: {
  readonly operation: AuthorizedOperation;
  readonly binding: RouterAbAcceptedAuthorizedOperationBindingV1;
}) {
  const operation = input.operation;
  const operationRef = operation.operation.operation;
  if (operationRef.capabilityKind !== 'near_ed25519_mpc_signing') {
    throw new Error('Ed25519 authorized operation capability is invalid');
  }
  if (operationRef.operationKind === 'near.export_key') {
    throw new Error('Ed25519 export cannot use normal-signing admission');
  }
  return buildRouterAbAcceptedAuthorizedOperationV1({
    operation,
    operationKind: operationRef.operationKind,
    capabilityKind: 'near_ed25519_mpc_signing',
    binding: input.binding,
  });
}

export function buildRouterAbEcdsaAcceptedAuthorizedOperationV1(input: {
  readonly operation: AuthorizedOperation;
  readonly binding: RouterAbAcceptedAuthorizedOperationBindingV1;
}) {
  const operation = input.operation;
  const operationRef = operation.operation.operation;
  if (
    operationRef.capabilityKind !== 'evm_ecdsa_mpc_signing' ||
    operationRef.operationKind !== 'evm.sign_transaction'
  ) {
    throw new Error('ECDSA authorized operation capability or operation kind is invalid');
  }
  return buildRouterAbAcceptedAuthorizedOperationV1({
    operation,
    operationKind: 'evm.sign_transaction',
    capabilityKind: 'evm_ecdsa_mpc_signing',
    binding: input.binding,
  });
}

function buildRouterAbAcceptedAuthorizedOperationV1(input: {
  readonly operation: AuthorizedOperation;
  readonly capabilityKind: 'near_ed25519_mpc_signing' | 'evm_ecdsa_mpc_signing';
  readonly operationKind:
    | 'near.sign_transaction'
    | 'near.sign_delegate_action'
    | 'near.sign_nep413_message'
    | 'evm.sign_transaction';
  readonly binding: RouterAbAcceptedAuthorizedOperationBindingV1;
}) {
  const operation = input.operation;
  const commonAuthorizedOperation = {
    authorized_operation_id: operation.authorizedOperationId,
    operation_id: operation.operation.operationId,
    capability_kind: input.capabilityKind,
    operation_kind: input.operationKind,
    lane_digest_b64u: operation.operation.digests.laneDigest,
    intent_digest_b64u: operation.operation.digests.intentDigest,
    display_digest_b64u: operation.operation.digests.displayDigest,
    operation_fingerprint_digest: operation.operationFingerprintDigest,
  };
  switch (input.binding.kind) {
    case 'reusable_wallet_session':
      if (
        operation.authorization.kind !== 'authorization_grant' ||
        operation.quota.kind !== 'consume_reusable_wallet_session'
      ) {
        throw new Error('Reusable Wallet Session authorized operation is invalid');
      }
      return {
        binding: {
          kind: 'reusable_wallet_session' as const,
          authorization_id: operation.authorization.authorizationGrantRef.authorizationId,
          wallet_session_id: input.binding.walletSessionId,
          quota_id: input.binding.quotaId,
        },
        authorized_operation: {
          kind: 'reusable_wallet_session_authorized_operation_v1' as const,
          ...commonAuthorizedOperation,
        },
      };
    case 'gateway_owner_wallet_session':
      if (
        operation.authorization.kind !== 'authorization_grant' ||
        operation.quota.kind !== 'consume_reusable_wallet_session'
      ) {
        throw new Error('Gateway owner Wallet Session authorized operation is invalid');
      }
      return {
        binding: {
          kind: 'gateway_owner_wallet_session' as const,
          subject_id: input.binding.subjectId,
          account_id: input.binding.accountId,
          authorization_id: input.binding.authorizationId,
          wallet_session_id: input.binding.walletSessionId,
          quota_id: input.binding.quotaId,
          threshold_session_id: input.binding.thresholdSessionId,
          org_id: input.binding.orgId,
          project_id: input.binding.projectId,
          environment: input.binding.environment,
          signing_worker_id: input.binding.signingWorkerId,
          expires_at_ms: input.binding.expiresAtMs,
        },
        authorized_operation: {
          kind: 'reusable_wallet_session_authorized_operation_v1' as const,
          ...commonAuthorizedOperation,
        },
      };
    case 'operation_step_up':
      if (
        operation.authorization.kind !== 'verified_step_up' ||
        operation.quota.kind !== 'quota_neutral'
      ) {
        throw new Error('Verified step-up authorized operation is invalid');
      }
      return {
        binding: {
          kind: 'operation_step_up' as const,
          authorization_session_id: input.binding.authorizationSessionId,
          org_id: input.binding.orgId,
          project_id: input.binding.projectId,
          environment: input.binding.environment,
          subject_id: input.binding.subjectId,
        },
        authorized_operation: {
          kind: 'verified_step_up_authorized_operation_v1' as const,
          authorization_session_id: input.binding.authorizationSessionId,
          evidence_set_digest: operation.authorization.evidenceSetDigest,
          ...commonAuthorizedOperation,
        },
      };
  }
}

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

export type RouterAbNormalSigningAdmissionInput =
  | {
      curve: 'ed25519';
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
