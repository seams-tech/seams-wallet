import type { EcdsaWalletSessionAdmission } from '../../../authorization/ecdsaWalletSessionAdmission';
// The ECDSA derivation normal-signing route: Wallet Session and step-up authorization, operation
// admission, replay and completion, and forwarding to the SigningWorker.
import {
  validateRouterAbEcdsaDerivationWalletSessionInputs,
  type ThresholdEcdsaSessionInputs,
} from '../../auth/commonRouterUtils';
import type { SessionAdapter } from '../../framework/routerApi';
import { extractBearerCredential } from '../../auth/routerApiKeyAuth';
import {
  ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_STATE_KIND_V1,
  parseRouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
  parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
  routerAbEcdsaDerivationActiveStateId,
  sameRouterAbEcdsaDerivationNormalSigningScopeV1,
  type RouterAbEcdsaDerivationEvmDigestSigningFinalizeCoreRequestV1Wire,
  type RouterAbEcdsaDerivationEvmDigestSigningRequestV1Wire,
  type RouterAbEcdsaDerivationNormalSigningScopeV1,
  type RouterAbEcdsaOperationStepUpPreparationV1Wire,
  type RouterAbOwnerOperationAuthorizationDecisionV1Wire,
} from '@shared/utils/routerAbEcdsaDerivation';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  WALLET_SESSION_FAILURE_CODES,
  type WalletSessionFailureCode,
} from '@shared/utils/walletSessionFailure';
import { walletSessionFailure, walletSessionFailureStatus } from '../../auth/walletSessionFailure';
import type {
  RouterApiAuthorizedOperationService,
  RouterApiAuthorizationSessionService,
  RouterApiWalletRegistrationService,
  RouterApiWalletSessionAuthorizationV2AdmissionContext,
  RouterApiWalletSessionExactOperationContext,
  RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext,
} from '../../framework/authServicePort';
import {
  buildEvmEcdsaMpcOperationRef,
  buildAuthorizationGrantRef,
  parseAuthorizationAuditEventId,
  parseAuthorizedOperationId,
  parseCapabilityId,
  parseCapabilityOperationId,
  type AuthorizedOperationId,
} from '@shared/authorization/capabilityKinds';
import {
  buildCapabilityOperationEnvelope,
  computeCapabilityOperationFingerprintDigest,
} from '@shared/authorization/operationFingerprint';
import {
  authorizedOperationReplayBodyInit,
  type AuthorizedOperation,
  type AuthorizedOperationReplayResponse,
  type OwnerOperationAuthorizationDecision,
  type SessionOrigin,
} from '../../../authorization/domain';
import {
  routerAbMpcMaterialActivationRefToWire,
  sameRouterAbMpcMaterialActivationRef,
  type RouterAbNormalSigningAuthorizationWire,
  type RouterAbMpcMaterialActivationRefWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { parseWalletId } from '@shared/utils/domainIds';
import {
  type AcceptedEcdsaRouteAdmission,
  evaluateRouterAbNormalSigningAdmission,
  requireAuthorizationValue,
  requireMpcMaterialActivationId,
  type RouterAbEcdsaOperationAdmission,
  type RouterAbEcdsaOperationAdmissionKind,
  routerAbErrorMessage,
  type RouterAbJsonRouteResult,
  type RouterAbNormalSigningAdmissionAdapter,
  type RouterAbNormalSigningRouteRuntime,
  routerAbOwnerOperationFailureResult,
  routerAbOwnerOperationStepUpDecision,
  routerAbSigningError,
  type RouterAbSigningWorkerJsonError,
  routerAbStepUpError,
  routerAbWalletSessionValidationStatus,
} from './routerAbNormalSigningAdmission';
import {
  type ActiveEcdsaMaterialActivation,
  ecdsaStepUpActiveMaterial,
  exactOperationStepUpSession,
  parseStepUpRequestOrigin,
  readExhaustedWalletSessionCandidate,
  recordedStepUpOperationClaim,
  type RouterAbExactOperationStepUpWalletSession,
  type RouterAbOperationStepUpAuthenticationFailure,
  routerAbOperationStepUpClaimFailure,
  type RouterAbOperationStepUpWalletSession,
  walletSessionCandidateAdmission,
  walletSessionScopeInvalidFailure,
  walletSessionUnavailableFailure,
} from './routerAbOperationStepUp';
import {
  buildRouterAbEcdsaDerivationPrivateSigningWorkerBody,
  isRouterAbEcdsaSigningWorkerOperationInProgress,
  postRouterAbSigningWorkerJson,
  replayResponseFromSigningWorkerResult,
  type RouterAbEcdsaDerivationPrivateSigningPath,
  type RouterAbEcdsaOperationStepUpRequest,
} from './routerAbPrivateSigningWorker';

export function routerAbEcdsaAtomicAuthorizationConfigured(
  authorizedOperations: Pick<RouterApiAuthorizedOperationService, 'admitAuthorizedOperation'>,
): boolean {
  const runtime = authorizedOperations as unknown as Record<string, unknown>;
  return typeof runtime.admitAuthorizedOperation === 'function';
}

export function routerAbEcdsaOperationInProgressResult(): RouterAbJsonRouteResult {
  return routerAbStepUpError(
    409,
    'operation_in_progress',
    'ECDSA signing operation is already in progress',
  );
}

export function buildRouterAbEcdsaOwnerOperationStepUpPreparation(input: {
  readonly request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1Wire;
  readonly keyHandle: string;
  readonly relayerKeyId: string;
  readonly participantIds: readonly number[];
}): RouterAbEcdsaOperationStepUpPreparationV1Wire | null {
  const [firstParticipantId, secondParticipantId] = input.participantIds;
  if (
    !input.keyHandle ||
    !input.relayerKeyId ||
    firstParticipantId === undefined ||
    secondParticipantId === undefined ||
    input.participantIds.length !== 2
  ) {
    return null;
  }
  return {
    wallet_id: input.request.scope.wallet_id,
    operation_kind: 'evm.sign_transaction',
    operation_id: input.request.operation_id,
    operation_digests: input.request.operation_digests,
    material_activation: input.request.material_activation,
    normal_signing_scope: input.request.scope,
    signing_worker_id: input.request.scope.signing_worker.server_id,
    key_handle: input.keyHandle,
    relayer_key_id: input.relayerKeyId,
    participant_ids: [firstParticipantId, secondParticipantId],
    expires_at_ms: input.request.expires_at_ms,
  };
}

async function resolveRouterAbEcdsaOwnerOperationStepUpPreparation(input: {
  readonly body: Record<string, unknown>;
  readonly phase: 'prepare' | 'finalize';
  readonly resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
}): Promise<RouterAbEcdsaOperationStepUpPreparationV1Wire | undefined> {
  if (input.phase !== 'prepare') return undefined;
  try {
    const request = parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(input.body);
    const walletId = parseWalletId(request.scope.wallet_id);
    if (!walletId.ok) return undefined;
    const activeMaterial = await input.resolveEcdsaMaterialActivation({
      walletId: walletId.value,
      materialActivation: request.material_activation,
    });
    if (!activeMaterial.ok) return undefined;
    return (
      buildRouterAbEcdsaOwnerOperationStepUpPreparation({
        request,
        keyHandle: activeMaterial.keyHandle,
        relayerKeyId: activeMaterial.relayerKeyId,
        participantIds: activeMaterial.participantIds,
      }) ?? undefined
    );
  } catch {
    return undefined;
  }
}

export function decideRouterAbEcdsaOwnerOperationAuthorization(input: {
  readonly operation: AuthorizedOperation;
}): OwnerOperationAuthorizationDecision<RouterAbEcdsaOperationStepUpPreparationV1Wire> {
  if (
    input.operation.lifecycle !== 'claimed' ||
    input.operation.authorization.kind !== 'authorization_grant' ||
    input.operation.quota.kind !== 'consume_reusable_wallet_session' ||
    input.operation.authorization.authorizationGrantRef.kind !== 'wallet_session_authorization'
  ) {
    return {
      kind: 'denied',
      denial: {
        code: 'invalid_authority',
        message: 'ECDSA reusable Wallet Session authorization is invalid',
      },
    };
  }
  return {
    kind: 'authorized',
    operation: input.operation,
    source: {
      kind: 'authorization_grant',
      authorizationGrantRef: input.operation.authorization.authorizationGrantRef,
    },
  };
}

function routerAbEcdsaOwnerOperationDecisionForFailure(input: {
  readonly code: string;
  readonly phase: 'prepare' | 'finalize';
  readonly stepUp?: RouterAbEcdsaOperationStepUpPreparationV1Wire;
}): RouterAbOwnerOperationAuthorizationDecisionV1Wire | null {
  const stepUpDecision = routerAbOwnerOperationStepUpDecision(input);
  if (stepUpDecision) return stepUpDecision;
  switch (input.code) {
    case 'invalid_body':
      return {
        kind: 'denied',
        denial: { code: 'invalid_operation', message: 'ECDSA operation request is invalid' },
      };
    case 'wallet_session_mismatch':
    case 'wallet_session_scope_mismatch':
    case 'scope_mismatch':
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
      return {
        kind: 'denied',
        denial: { code: 'invalid_authority', message: 'ECDSA operation authority is invalid' },
      };
    case 'material_mismatch':
      return {
        kind: 'denied',
        denial: { code: 'inactive_material', message: 'ECDSA signing material is inactive' },
      };
    case 'internal':
    case 'not_configured':
      return {
        kind: 'denied',
        denial: {
          code: 'authorization_unavailable',
          message: 'ECDSA operation authorization is unavailable',
        },
      };
    default:
      return null;
  }
}

export function routerAbEcdsaOwnerOperationFailureResult(input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly phase: 'prepare' | 'finalize';
  readonly stepUp?: RouterAbEcdsaOperationStepUpPreparationV1Wire;
}): RouterAbJsonRouteResult {
  return routerAbOwnerOperationFailureResult(
    input,
    routerAbEcdsaOwnerOperationDecisionForFailure(input),
  );
}

export function routerAbEcdsaReplayUnavailableResult(): RouterAbJsonRouteResult {
  return routerAbStepUpError(
    409,
    'authorized_operation_replay_unavailable',
    'Completed ECDSA signing operation has no replayable response',
  );
}

export function routerAbEcdsaRecordedResponse(
  operation: AuthorizedOperation,
): AuthorizedOperationReplayResponse | null {
  return operation.lifecycle === 'completed' ? operation.response : null;
}

export function routerAbEcdsaReplayResult(operation: AuthorizedOperation): RouterAbJsonRouteResult {
  const response = routerAbEcdsaRecordedResponse(operation);
  if (!response) return routerAbEcdsaReplayUnavailableResult();
  let body: unknown = response.bodyText;
  try {
    body = JSON.parse(response.bodyText);
  } catch {
    // Keep a non-JSON worker response as text for the JSON route adapter.
  }
  return { status: response.status, body };
}

export function routerAbEcdsaReplayHttpResponse(operation: AuthorizedOperation): Response | null {
  const response = routerAbEcdsaRecordedResponse(operation);
  if (!response) return null;
  return new Response(authorizedOperationReplayBodyInit(response), {
    status: response.status,
    headers: { 'content-type': response.contentType },
  });
}

function routerAbEcdsaPrivateSigningWorkerUnavailableResult(): RouterAbJsonRouteResult {
  return {
    status: 501,
    body: {
      ok: false,
      code: 'not_configured',
      message: 'Router A/B SigningWorker private HTTP target is not configured',
    },
  };
}

type RouterAbEcdsaWalletSessionValidationSuccess = Extract<
  ThresholdEcdsaSessionInputs,
  { readonly ok: true }
>;

type RouterAbEcdsaV2WalletSessionValidationSuccess = Extract<
  RouterAbEcdsaWalletSessionValidationSuccess,
  { readonly kind: 'wallet_session_operation_credential_v1' }
>;

export type RouterAbEcdsaNormalSigningAuthorizationResult =
  | {
      readonly ok: true;
      readonly kind: 'wallet_session_operation_credential_v1';
      readonly validated: RouterAbEcdsaV2WalletSessionValidationSuccess;
      readonly admission: AcceptedEcdsaRouteAdmission;
      readonly activeMaterial: ActiveEcdsaMaterialActivation;
    }
  | {
      readonly ok: true;
      readonly kind: 'wallet_session_operation_credential_exhausted_candidate_v1';
      readonly candidate: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext;
      readonly admission: AcceptedEcdsaRouteAdmission;
      readonly activeMaterial: ActiveEcdsaMaterialActivation;
    }
  | {
      readonly ok: true;
      readonly kind: 'operation_step_up';
      readonly phase: 'prepare' | 'finalize';
      readonly operation: AuthorizedOperation;
      readonly session: RouterAbOperationStepUpWalletSession;
      readonly admissionKind: RouterAbEcdsaOperationAdmissionKind;
    }
  | { readonly ok: false; readonly result: RouterAbJsonRouteResult };

function routerAbWalletSessionError(
  code: WalletSessionFailureCode,
): RouterAbSigningWorkerJsonError {
  const failure = walletSessionFailure(code);
  return routerAbSigningError(walletSessionFailureStatus(code), failure.code, failure.message);
}

/**
 * Re-resolve the complete activation reference immediately before a claim or
 * evidence write. The resolver is authoritative for capability identity and
 * all owner/key/lifecycle/worker bindings; a stale or superseded reference
 * must fail before any authorization side effect is attempted.
 */
export async function resolveFreshRouterAbEcdsaMaterialActivation(input: {
  readonly resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
  readonly walletId: string;
  readonly expected: RouterAbMpcMaterialActivationRefWire;
}): Promise<
  | {
      readonly ok: true;
      readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
      readonly keyHandle: string;
      readonly relayerKeyId: string;
      readonly participantIds: readonly [number, number];
      readonly runtimePolicyScope: RuntimePolicyScope;
    }
  | { readonly ok: false; readonly code: 'not_found' | 'internal'; readonly message: string }
  | { readonly ok: false; readonly code: 'scope_mismatch'; readonly message: string }
> {
  const resolved = await input.resolveEcdsaMaterialActivation({
    walletId: input.walletId,
    materialActivation: input.expected,
  });
  if (!resolved.ok) return resolved;
  if (!sameRouterAbMpcMaterialActivationRef(resolved.materialActivation, input.expected)) {
    return {
      ok: false,
      code: 'scope_mismatch',
      message: 'ECDSA material activation changed before authorization claim',
    };
  }
  return {
    ok: true,
    materialActivation: resolved.materialActivation,
    keyHandle: resolved.keyHandle,
    relayerKeyId: resolved.relayerKeyId,
    participantIds: resolved.participantIds,
    runtimePolicyScope: resolved.runtimePolicyScope,
  };
}

type RouterAbEcdsaWalletSessionOperationBinding =
  | {
      readonly kind: 'wallet_session_operation_credential_v1';
      readonly context: RouterApiWalletSessionAuthorizationV2AdmissionContext;
    }
  | {
      readonly kind: 'wallet_session_operation_credential_exhausted_candidate_v1';
      readonly candidate: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext;
    };

type RouterAbEcdsaV2NormalSigningValidation =
  | {
      readonly ok: true;
      readonly request: RouterAbEcdsaOperationStepUpRequest;
      readonly admission: AcceptedEcdsaRouteAdmission;
    }
  | { readonly ok: false; readonly error: RouterAbJsonRouteResult };

function validateRouterAbEcdsaV2NormalSigningRequestForSession(input: {
  readonly phase: 'prepare' | 'finalize';
  readonly body: Record<string, unknown>;
  readonly session: RouterApiWalletSessionAuthorizationV2AdmissionContext['authorization']['session'];
  readonly admittedMaterialActivation: RouterAbMpcMaterialActivationRefWire;
}): RouterAbEcdsaV2NormalSigningValidation {
  let request: RouterAbEcdsaOperationStepUpRequest;
  try {
    request = parseRouterAbEcdsaOperationStepUpRequest(input);
  } catch (error: unknown) {
    return {
      ok: false,
      error: routerAbStepUpError(400, 'invalid_body', routerAbErrorMessage(error)),
    };
  }
  if (
    request.authorization.kind !== 'reusable_wallet_session' ||
    request.authorization.wallet_session_id !== input.session.walletSessionId ||
    request.scope.wallet_id !== String(input.session.walletId) ||
    request.material_activation.material_owner !== String(input.session.walletId) ||
    request.material_activation.signing_worker !== request.scope.signing_worker.server_id ||
    !sameRouterAbMpcMaterialActivationRef(
      request.material_activation,
      request.scope.material_activation,
    ) ||
    !sameRouterAbMpcMaterialActivationRef(
      request.material_activation,
      input.admittedMaterialActivation,
    )
  ) {
    return {
      ok: false,
      error: routerAbWalletSessionError(WALLET_SESSION_FAILURE_CODES.scopeMismatch),
    };
  }
  if (request.expires_at_ms <= Date.now()) {
    return {
      ok: false,
      error: routerAbSigningError(
        408,
        'expired_request',
        'Router A/B ECDSA derivation normal-signing request is expired',
      ),
    };
  }
  if (request.expires_at_ms > input.session.expiresAtMs) {
    return {
      ok: false,
      error: routerAbWalletSessionError(WALLET_SESSION_FAILURE_CODES.scopeMismatch),
    };
  }
  return {
    ok: true,
    request,
    admission: {
      ok: true,
      thresholdSessionId: routerAbEcdsaDerivationActiveStateId({
        kind: ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_STATE_KIND_V1,
        scope: request.scope,
      }),
      requestId: request.request_id,
      expiresAtMs: request.expires_at_ms,
      materialActivation: input.admittedMaterialActivation,
    },
  };
}

export async function admitRouterAbEcdsaReusableWalletSessionOperation(input: {
  request: RouterAbEcdsaOperationStepUpRequest;
  materialActivation: RouterAbMpcMaterialActivationRefWire;
  binding: RouterAbEcdsaWalletSessionOperationBinding;
  authorizedOperations: Pick<
    RouterApiAuthorizedOperationService,
    'tenantId' | 'admitEcdsaWalletSessionOperation'
  >;
  resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
}): Promise<
  | {
      readonly ok: true;
      readonly admission: EcdsaWalletSessionAdmission;
    }
  | { readonly ok: false; readonly error: RouterAbJsonRouteResult }
> {
  if (typeof input.authorizedOperations.admitEcdsaWalletSessionOperation !== 'function') {
    return {
      ok: false,
      error: routerAbStepUpError(
        501,
        'not_configured',
        'ECDSA atomic authorization is not configured',
      ),
    };
  }
  if (input.request.authorization.kind !== 'reusable_wallet_session') {
    return {
      ok: false,
      error: routerAbStepUpError(
        400,
        'invalid_body',
        'Reusable Wallet Session authority is required',
      ),
    };
  }
  const nowMs = Date.now();
  try {
    const session =
      input.binding.kind === 'wallet_session_operation_credential_v1'
        ? input.binding.context.authorization.session
        : input.binding.candidate.status.session;
    const tenantId = session.tenantId;
    const principalId = session.principalId;
    const walletId = session.walletId;
    const walletSessionId = session.walletSessionId;
    const authorizationId = session.authorizationId;
    const quotaId = session.quotaId;
    if (
      tenantId !== input.authorizedOperations.tenantId ||
      input.request.authorization.wallet_session_id !== walletSessionId
    ) {
      return {
        ok: false,
        error: routerAbStepUpError(
          403,
          'wallet_session_mismatch',
          'Reusable Wallet Session identity does not match',
        ),
      };
    }
    const freshMaterial = await resolveFreshRouterAbEcdsaMaterialActivation({
      resolveEcdsaMaterialActivation: input.resolveEcdsaMaterialActivation,
      walletId: String(walletId),
      expected: input.materialActivation,
    });
    if (!freshMaterial.ok) {
      return {
        ok: false,
        error: routerAbStepUpError(
          freshMaterial.code === 'internal' ? 500 : 403,
          freshMaterial.code === 'internal' ? 'internal' : 'wallet_session_mismatch',
          freshMaterial.message,
        ),
      };
    }
    const capabilityId = requireAuthorizationValue(
      parseCapabilityId(freshMaterial.materialActivation.capability),
    );
    const operationId = requireAuthorizationValue(
      parseCapabilityOperationId(input.request.operation_id),
    );
    const operation = buildEvmEcdsaMpcOperationRef('evm.sign_transaction');
    const envelope = buildCapabilityOperationEnvelope({
      tenantId,
      principalId,
      capabilityId,
      operationId,
      operation,
      digests: {
        laneDigest: parseDigestB64u(input.request.operation_digests.lane_digest_b64u),
        intentDigest: parseDigestB64u(input.request.operation_digests.intent_digest_b64u),
        displayDigest: parseDigestB64u(input.request.operation_digests.display_digest_b64u),
      },
    });
    const authorizedOperationId = requireAuthorizationValue(
      parseAuthorizedOperationId(
        `ecdsa-authorized-operation:${operationId}:${input.request.request_id}`,
      ),
    );
    const auditEventId = requireAuthorizationValue(
      parseAuthorizationAuditEventId(`ecdsa-operation-audit:${operationId}`),
    );
    const outcome = await input.authorizedOperations.admitEcdsaWalletSessionOperation({
      operation: {
        tenantId,
        authorizedOperationId,
        auditEventId,
        operation: envelope,
        authorization: {
          kind: 'authorization_grant',
          authorizationGrantRef: buildAuthorizationGrantRef(authorizationId),
        },
        quota: { kind: 'consume_reusable_wallet_session', quotaId },
        claimedAtMs: nowMs,
      },
      material: {
        walletId,
        keyHandle: freshMaterial.keyHandle,
        runtimePolicyScope: freshMaterial.runtimePolicyScope,
        materialActivation: freshMaterial.materialActivation,
      },
    });
    const claimFailure = routerAbReusableWalletSessionClaimFailure(outcome);
    if (claimFailure) return { ok: false, error: claimFailure };
    if (
      outcome.kind === 'claimed' ||
      outcome.kind === 'operation_in_progress' ||
      outcome.kind === 'replayed'
    ) {
      return {
        ok: true,
        admission: outcome,
      };
    }
    return {
      ok: false,
      error: routerAbStepUpError(409, outcome.kind, 'Authorized operation is unavailable'),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: routerAbStepUpError(400, 'invalid_body', routerAbErrorMessage(error)),
    };
  }
}

function routerAbReusableWalletSessionClaimFailure(
  result: Awaited<ReturnType<RouterApiAuthorizedOperationService['admitAuthorizedOperation']>>,
): RouterAbJsonRouteResult | null {
  switch (result.kind) {
    case 'claimed':
    case 'operation_in_progress':
    case 'replayed':
      return null;
    case 'wallet_session_quota_exhausted':
      return routerAbStepUpError(409, result.kind, 'Reusable Wallet Session quota is exhausted');
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
      return routerAbStepUpError(
        403,
        result.kind,
        'Reusable Wallet Session authorization is invalid',
      );
    case 'material_mismatch':
      return routerAbStepUpError(403, result.kind, 'ECDSA material activation is no longer active');
  }
}

export async function completeRouterAbEcdsaOperation(input: {
  authorizedOperations: RouterApiAuthorizedOperationService;
  operation: AuthorizedOperation;
  result: 'succeeded' | 'failed_before_side_effect' | 'failed_after_side_effect';
  response: AuthorizedOperationReplayResponse;
}): Promise<void> {
  await input.authorizedOperations.completeAuthorizedOperation({
    operation: input.operation,
    result: input.result,
    response: input.response,
    completedAtMs: Date.now(),
  });
}

type RouterAbEcdsaOperationStepUpAuthenticationRequest =
  | RouterAbEcdsaOperationStepUpRequest
  | RouterAbEcdsaOperationStepUpPreparationV1Wire;

function routerAbEcdsaOperationStepUpScope(
  request: RouterAbEcdsaOperationStepUpAuthenticationRequest,
): RouterAbEcdsaDerivationNormalSigningScopeV1 {
  return 'scope' in request ? request.scope : request.normal_signing_scope;
}

function parseRouterAbEcdsaOperationStepUpRequest(input: {
  readonly phase: 'prepare';
  readonly body: Record<string, unknown>;
}): RouterAbEcdsaDerivationEvmDigestSigningRequestV1Wire;
function parseRouterAbEcdsaOperationStepUpRequest(input: {
  readonly phase: 'finalize';
  readonly body: Record<string, unknown>;
}): RouterAbEcdsaDerivationEvmDigestSigningFinalizeCoreRequestV1Wire;
function parseRouterAbEcdsaOperationStepUpRequest(input: {
  readonly phase: 'prepare' | 'finalize';
  readonly body: Record<string, unknown>;
}): RouterAbEcdsaOperationStepUpRequest;
function parseRouterAbEcdsaOperationStepUpRequest(input: {
  readonly phase: 'prepare' | 'finalize';
  readonly body: Record<string, unknown>;
}): RouterAbEcdsaOperationStepUpRequest {
  return input.phase === 'prepare'
    ? parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(input.body)
    : parseRouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1(input.body);
}

type RouterAbEcdsaWalletSessionAuthorization =
  | {
      readonly ok: true;
      readonly request: RouterAbEcdsaOperationStepUpRequest;
      readonly admission: AcceptedEcdsaRouteAdmission;
      readonly activeMaterial: ActiveEcdsaMaterialActivation;
    }
  | { readonly ok: false; readonly result: RouterAbJsonRouteResult };

async function authorizeRouterAbEcdsaWalletSessionRequest(input: {
  readonly phase: 'prepare' | 'finalize';
  readonly body: Record<string, unknown>;
  readonly session: RouterApiWalletSessionAuthorizationV2AdmissionContext['authorization']['session'];
  readonly admittedMaterialActivation: RouterAbMpcMaterialActivationRefWire;
  readonly admissionAdapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
  readonly resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
}): Promise<RouterAbEcdsaWalletSessionAuthorization> {
  const validated = validateRouterAbEcdsaV2NormalSigningRequestForSession(input);
  if (!validated.ok) return { ok: false, result: validated.error };

  const activeMaterial = await input.resolveEcdsaMaterialActivation({
    walletId: String(input.session.walletId),
    materialActivation: validated.admission.materialActivation,
  });
  if (!activeMaterial.ok) {
    return {
      ok: false,
      result: routerAbEcdsaOwnerOperationFailureResult({
        status: activeMaterial.code === 'internal' ? 500 : 403,
        code: activeMaterial.code === 'internal' ? 'internal' : 'material_mismatch',
        message:
          activeMaterial.code === 'internal'
            ? activeMaterial.message
            : 'Wallet Session V2 material is no longer active',
        phase: input.phase,
      }),
    };
  }
  if (
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      validated.admission.materialActivation,
    ) ||
    !sameRouterAbEcdsaDerivationNormalSigningScopeV1(
      validated.request.scope,
      activeMaterial.routerAbEcdsaDerivationNormalSigning.scope,
    )
  ) {
    return {
      ok: false,
      result: routerAbStepUpError(
        403,
        'wallet_session_scope_mismatch',
        'Wallet Session V2 scope does not match the active material',
      ),
    };
  }
  const admissionDecision = await evaluateRouterAbNormalSigningAdmission({
    adapter: input.admissionAdapter,
    curve: 'ecdsa',
    authorizationKind: 'wallet_session_operation_credential_v1',
    phase: input.phase,
    walletId: String(input.session.walletId),
    walletSessionId: String(input.session.walletSessionId),
    materialActivation: activeMaterial.materialActivation,
    requestId: validated.admission.requestId,
    expiresAtMs: validated.admission.expiresAtMs,
    signingWorkerId: activeMaterial.materialActivation.signing_worker,
    keyHandle: activeMaterial.keyHandle,
    runtimePolicyScope: activeMaterial.runtimePolicyScope,
    admission: validated.admission,
  });
  if (!admissionDecision.ok) {
    return {
      ok: false,
      result: routerAbEcdsaOwnerOperationFailureResult({
        status: admissionDecision.status,
        code: admissionDecision.code,
        message: admissionDecision.message,
        phase: input.phase,
      }),
    };
  }
  return {
    ok: true,
    request: validated.request,
    admission: {
      ...validated.admission,
      materialActivation: activeMaterial.materialActivation,
    },
    activeMaterial,
  };
}

type RouterAbEcdsaExhaustedCandidateAuthorization =
  | {
      readonly ok: true;
      readonly kind: 'wallet_session_operation_credential_exhausted_candidate_v1';
      readonly candidate: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext;
      readonly admission: AcceptedEcdsaRouteAdmission;
      readonly activeMaterial: ActiveEcdsaMaterialActivation;
    }
  | { readonly ok: false; readonly result: RouterAbJsonRouteResult };

async function resolveRouterAbEcdsaExhaustedCandidateAuthorization(input: {
  readonly phase: 'prepare' | 'finalize';
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly authorizationSessions: RouterApiAuthorizationSessionService;
  readonly admissionAdapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
  readonly resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
}): Promise<RouterAbEcdsaExhaustedCandidateAuthorization | null> {
  const token = extractBearerCredential(input.headers);
  if (!token) return null;
  const exhausted = await readExhaustedWalletSessionCandidate({
    authorizationSessions: input.authorizationSessions,
    token,
    operation: { keyFamily: 'ecdsa_secp256k1', operationKind: 'evm.sign_transaction' },
  });
  if (!exhausted) return null;
  if (!exhausted.ok) return { ok: false, result: exhausted.error };
  const { candidate, session, admission } = exhausted;
  if (!admission.ok || admission.keyFamily !== 'ecdsa_secp256k1') {
    return {
      ok: false,
      result: routerAbWalletSessionError(WALLET_SESSION_FAILURE_CODES.scopeMismatch),
    };
  }
  const authorized = await authorizeRouterAbEcdsaWalletSessionRequest({
    phase: input.phase,
    body: input.body,
    session,
    admittedMaterialActivation: routerAbMpcMaterialActivationRefToWire(
      admission.materialActivation,
    ),
    admissionAdapter: input.admissionAdapter,
    resolveEcdsaMaterialActivation: input.resolveEcdsaMaterialActivation,
  });
  if (!authorized.ok) return authorized;
  return {
    ok: true,
    kind: 'wallet_session_operation_credential_exhausted_candidate_v1',
    candidate,
    admission: authorized.admission,
    activeMaterial: authorized.activeMaterial,
  };
}

type RouterAbEcdsaOperationStepUpAuthenticationResult =
  | {
      readonly ok: true;
      readonly authorizedOperations: RouterApiAuthorizedOperationService;
      readonly activeMaterial: ActiveEcdsaMaterialActivation;
      readonly session: RouterAbExactOperationStepUpWalletSession;
      readonly requestOrigin: SessionOrigin;
      readonly expiresAtMs: number;
    }
  | RouterAbOperationStepUpAuthenticationFailure;

export async function authenticateRouterAbEcdsaOperationStepUp(input: {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly request: RouterAbEcdsaOperationStepUpAuthenticationRequest;
  readonly authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  readonly authorizationSessions: RouterApiAuthorizationSessionService | null | undefined;
  readonly resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
}): Promise<RouterAbEcdsaOperationStepUpAuthenticationResult> {
  if (!input.authorizedOperations || !input.authorizationSessions) {
    return {
      ok: false,
      error: routerAbStepUpError(
        501,
        'not_configured',
        'ECDSA operation step-up authorization is not configured',
      ),
    };
  }
  const token = extractBearerCredential(input.headers);
  if (!token) {
    return {
      ok: false,
      error: routerAbStepUpError(401, 'unauthorized', 'Wallet Session is required'),
    };
  }
  const origin = parseStepUpRequestOrigin(input.headers);
  if (!origin.ok) return origin;

  let candidate: RouterApiWalletSessionExactOperationContext | null;
  try {
    candidate =
      await input.authorizationSessions.readWalletSessionExactOperationContextByCredential({
        tenantId: input.authorizationSessions.tenantId,
        token,
        nowMs: Date.now(),
      });
  } catch {
    return walletSessionUnavailableFailure();
  }
  if (!candidate) {
    return {
      ok: false,
      error: routerAbStepUpError(401, 'unauthorized', 'Wallet Session is invalid'),
    };
  }

  const session = candidate.session;
  const scope = routerAbEcdsaOperationStepUpScope(input.request);
  const admission = walletSessionCandidateAdmission(session, candidate, {
    keyFamily: 'ecdsa_secp256k1',
    operationKind: 'evm.sign_transaction',
  });
  if (!admission.ok || admission.keyFamily !== 'ecdsa_secp256k1') {
    return walletSessionScopeInvalidFailure();
  }

  const admittedMaterialActivation = routerAbMpcMaterialActivationRefToWire(
    admission.materialActivation,
  );
  if (
    admission.operationKind !== 'evm.sign_transaction' ||
    session.walletId.toString() !== scope.wallet_id ||
    input.request.material_activation.material_owner !== scope.wallet_id ||
    !Number.isSafeInteger(input.request.expires_at_ms) ||
    input.request.expires_at_ms > session.expiresAtMs ||
    !sameRouterAbMpcMaterialActivationRef(
      admittedMaterialActivation,
      input.request.material_activation,
    )
  ) {
    return walletSessionScopeInvalidFailure();
  }

  let resolvedMaterial: Awaited<
    ReturnType<RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation']>
  >;
  try {
    resolvedMaterial = await input.resolveEcdsaMaterialActivation({
      walletId: scope.wallet_id,
      materialActivation: admittedMaterialActivation,
    });
  } catch {
    return walletSessionUnavailableFailure();
  }
  const active = ecdsaStepUpActiveMaterial({
    activeMaterial: resolvedMaterial,
    admittedMaterialActivation,
    walletId: scope.wallet_id,
    signer: admission.signer,
  });
  if (!active.ok) return active;
  const exact = exactOperationStepUpSession({
    session,
    authorizedOperations: input.authorizedOperations,
    runtimePolicyScope: active.activeMaterial.runtimePolicyScope,
  });
  if (!exact.ok) return exact;
  return {
    ok: true,
    authorizedOperations: input.authorizedOperations,
    activeMaterial: active.activeMaterial,
    session: exact.session,
    requestOrigin: origin.requestOrigin,
    expiresAtMs: session.expiresAtMs,
  };
}

function validateRouterAbEcdsaOperationStepUpIdentity(input: {
  readonly request: RouterAbEcdsaOperationStepUpRequest;
  readonly session: RouterAbOperationStepUpWalletSession;
}): RouterAbJsonRouteResult | null {
  const request = input.request;
  if (
    request.authorization.kind !== 'operation_step_up' ||
    request.scope.wallet_id !== input.session.walletId ||
    request.material_activation.material_owner !== input.session.walletId ||
    request.material_activation.signing_worker !== request.scope.signing_worker.server_id ||
    !sameRouterAbMpcMaterialActivationRef(
      request.material_activation,
      request.scope.material_activation,
    )
  ) {
    return routerAbStepUpError(
      403,
      'scope_mismatch',
      'ECDSA operation step-up identity does not match',
    );
  }
  if (request.expires_at_ms <= Date.now()) {
    return routerAbStepUpError(
      408,
      'expired_request',
      'Router A/B ECDSA operation step-up request is expired',
    );
  }
  return null;
}

export async function claimRouterAbEcdsaOperationStepUp(input: {
  readonly operationKind: 'evm.sign_transaction' | 'evm.export_key';
  readonly operation: Pick<
    RouterAbEcdsaOperationStepUpPreparationV1Wire,
    'operation_id' | 'operation_digests' | 'material_activation'
  >;
  readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  readonly keyHandle: string;
  readonly authenticated: Extract<
    Awaited<ReturnType<typeof authenticateRouterAbEcdsaOperationStepUp>>,
    { readonly ok: true }
  >;
}): Promise<RouterAbJsonRouteResult | RouterAbEcdsaOperationAdmission | null> {
  if (!routerAbEcdsaAtomicAuthorizationConfigured(input.authenticated.authorizedOperations)) {
    return routerAbStepUpError(
      501,
      'not_configured',
      'ECDSA atomic authorization is not configured',
    );
  }
  let authorizedOperationId: AuthorizedOperationId;
  let operationEnvelope: ReturnType<typeof buildCapabilityOperationEnvelope>;
  try {
    const operationId = requireAuthorizationValue(
      parseCapabilityOperationId(input.operation.operation_id),
    );
    authorizedOperationId = requireAuthorizationValue(
      parseAuthorizedOperationId(
        `ecdsa-step-up-authorized-operation:${input.operation.operation_id}`,
      ),
    );
    operationEnvelope = buildCapabilityOperationEnvelope({
      tenantId: input.authenticated.session.tenantId,
      principalId: input.authenticated.session.principalId,
      capabilityId: requireAuthorizationValue(
        parseCapabilityId(input.materialActivation.capability),
      ),
      operationId,
      operation: buildEvmEcdsaMpcOperationRef(input.operationKind),
      digests: {
        laneDigest: parseDigestB64u(input.operation.operation_digests.lane_digest_b64u),
        intentDigest: parseDigestB64u(input.operation.operation_digests.intent_digest_b64u),
        displayDigest: parseDigestB64u(input.operation.operation_digests.display_digest_b64u),
      },
    });
  } catch (error: unknown) {
    return routerAbStepUpError(400, 'invalid_body', routerAbErrorMessage(error));
  }
  const existing = await input.authenticated.authorizedOperations.readAuthorizedOperation({
    tenantId: input.authenticated.session.tenantId,
    operationFingerprintDigest:
      await computeCapabilityOperationFingerprintDigest(operationEnvelope),
  });
  if (!existing || existing.authorizedOperationId !== authorizedOperationId) {
    return routerAbStepUpError(
      409,
      'authorized_operation_missing',
      'Operation authorization is unavailable',
    );
  }
  const claim = recordedStepUpOperationClaim(existing);
  if (!claim.ok) return claim.error;
  const result = await input.authenticated.authorizedOperations.admitAuthorizedOperation({
    operation: claim.operation,
    material: {
      walletId: requireAuthorizationValue(parseWalletId(input.authenticated.session.walletId)),
      keyHandle: input.keyHandle,
      runtimePolicyScope: input.authenticated.session.runtimePolicyScope,
      materialActivation: input.materialActivation,
    },
  });
  if (result.kind === 'material_mismatch') {
    return routerAbStepUpError(
      403,
      'scope_mismatch',
      'ECDSA material activation changed before authorized-operation admission',
    );
  }
  const claimFailure = routerAbOperationStepUpClaimFailure(result);
  if (claimFailure) return claimFailure;
  if (
    result.kind === 'claimed' ||
    result.kind === 'operation_in_progress' ||
    result.kind === 'replayed'
  ) {
    return {
      kind: result.kind,
      operation: result.operation,
    };
  }
  return routerAbStepUpError(
    409,
    'authorized_operation_missing',
    'Authorized operation is unavailable',
  );
}

async function handleRouterAbEcdsaOperationStepUpRoute(input: {
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  readonly authorizationSessions: RouterApiAuthorizationSessionService | null | undefined;
  readonly admissionAdapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
  readonly resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
  readonly phase: 'prepare' | 'finalize';
}): Promise<
  | RouterAbJsonRouteResult
  | {
      readonly operation: AuthorizedOperation;
      readonly session: RouterAbOperationStepUpWalletSession;
      readonly admissionKind: RouterAbEcdsaOperationAdmissionKind;
    }
> {
  let request: RouterAbEcdsaOperationStepUpRequest;
  try {
    request = parseRouterAbEcdsaOperationStepUpRequest(input);
  } catch (error: unknown) {
    return routerAbStepUpError(400, 'invalid_body', routerAbErrorMessage(error));
  }
  if (request.authorization.kind !== 'operation_step_up') {
    return routerAbStepUpError(400, 'invalid_body', 'Operation step-up authority is required');
  }
  const authenticated = await authenticateRouterAbEcdsaOperationStepUp({
    headers: input.headers,
    request,
    authorizedOperations: input.authorizedOperations,
    authorizationSessions: input.authorizationSessions,
    resolveEcdsaMaterialActivation: input.resolveEcdsaMaterialActivation,
  });
  if (!authenticated.ok) return authenticated.error;
  const identityFailure = validateRouterAbEcdsaOperationStepUpIdentity({
    request,
    session: authenticated.session,
  });
  if (identityFailure) return identityFailure;
  const activeMaterial = authenticated.activeMaterial;
  if (
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      request.scope.material_activation,
    )
  ) {
    return routerAbStepUpError(
      403,
      'scope_mismatch',
      'ECDSA operation step-up scope does not name the active material',
    );
  }
  const materialActivationId = requireMpcMaterialActivationId(
    activeMaterial.materialActivation.activation_id,
  );
  if (!input.admissionAdapter) {
    return routerAbStepUpError(
      501,
      'not_configured',
      'Router A/B ECDSA operation step-up admission is not configured',
    );
  }
  const admission = await input.admissionAdapter.evaluatePolicy({
    curve: 'ecdsa',
    phase: input.phase,
    walletId: authenticated.session.walletId,
    materialActivationId,
    authorizationIdentity: {
      kind: 'operation_step_up',
      materialActivationId,
    },
    requestId: request.request_id,
    expiresAtMs: request.expires_at_ms,
    signingWorkerId: activeMaterial.materialActivation.signing_worker,
    keyHandle: activeMaterial.keyHandle,
    runtimePolicyScope: authenticated.session.runtimePolicyScope,
  });
  if (!admission.ok) {
    return {
      status: admission.status,
      body: { ok: false, code: admission.code, message: admission.message },
    };
  }
  const freshMaterial = await resolveFreshRouterAbEcdsaMaterialActivation({
    resolveEcdsaMaterialActivation: input.resolveEcdsaMaterialActivation,
    walletId: authenticated.session.walletId,
    expected: request.material_activation,
  });
  if (!freshMaterial.ok) {
    return routerAbStepUpError(
      freshMaterial.code === 'internal' ? 500 : 403,
      freshMaterial.code === 'internal' ? 'internal' : 'scope_mismatch',
      freshMaterial.message,
    );
  }
  if (
    freshMaterial.keyHandle !== activeMaterial.keyHandle ||
    freshMaterial.relayerKeyId !== activeMaterial.relayerKeyId ||
    freshMaterial.participantIds[0] !== activeMaterial.participantIds[0] ||
    freshMaterial.participantIds[1] !== activeMaterial.participantIds[1]
  ) {
    return routerAbStepUpError(
      403,
      'scope_mismatch',
      'ECDSA operation step-up signer facts changed before authorized-operation admission',
    );
  }
  const claimResult = await claimRouterAbEcdsaOperationStepUp({
    operationKind: 'evm.sign_transaction',
    operation: {
      operation_id: request.operation_id,
      operation_digests: request.operation_digests,
      material_activation: request.material_activation,
    },
    materialActivation: freshMaterial.materialActivation,
    keyHandle: freshMaterial.keyHandle,
    authenticated,
  });
  if (!claimResult) {
    return routerAbStepUpError(
      409,
      'authorized_operation_missing',
      'Authorized operation is unavailable',
    );
  }
  if ('status' in claimResult) return claimResult;
  return {
    operation: claimResult.operation,
    session: authenticated.session,
    admissionKind: claimResult.kind,
  };
}

export async function authorizeRouterAbEcdsaDerivationNormalSigningRoute(input: {
  body: Record<string, unknown>;
  rawBody: unknown;
  headers: Record<string, string | string[] | undefined>;
  session: SessionAdapter | null | undefined;
  authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  authorizationSessions: RouterApiAuthorizationSessionService | null | undefined;
  admissionAdapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
  resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
  phase: 'prepare' | 'finalize';
}): Promise<RouterAbEcdsaNormalSigningAuthorizationResult> {
  let requestedAuthorizationKind: RouterAbNormalSigningAuthorizationWire['kind'];
  try {
    requestedAuthorizationKind = parseRouterAbEcdsaOperationStepUpRequest({
      phase: input.phase,
      body: input.body,
    }).authorization.kind;
  } catch (error: unknown) {
    return {
      ok: false,
      result: routerAbStepUpError(400, 'invalid_body', routerAbErrorMessage(error)),
    };
  }
  if (requestedAuthorizationKind === 'operation_step_up') {
    const stepUp = await handleRouterAbEcdsaOperationStepUpRoute({
      body: input.body,
      headers: input.headers,
      authorizedOperations: input.authorizedOperations,
      authorizationSessions: input.authorizationSessions,
      admissionAdapter: input.admissionAdapter,
      resolveEcdsaMaterialActivation: input.resolveEcdsaMaterialActivation,
      phase: input.phase,
    });
    if ('status' in stepUp) return { ok: false, result: stepUp };
    return {
      ok: true,
      kind: 'operation_step_up',
      phase: input.phase,
      operation: stepUp.operation,
      session: stepUp.session,
      admissionKind: stepUp.admissionKind,
    };
  }

  const validated = await validateRouterAbEcdsaDerivationWalletSessionInputs({
    headers: input.headers,
    authorizationSessions: input.authorizationSessions,
    operationKind: 'evm.sign_transaction',
  });
  if (!validated.ok) {
    if (validated.code === 'wallet_session_unavailable' && input.authorizationSessions) {
      const exhaustedCandidate = await resolveRouterAbEcdsaExhaustedCandidateAuthorization({
        phase: input.phase,
        body: input.body,
        headers: input.headers,
        authorizationSessions: input.authorizationSessions,
        admissionAdapter: input.admissionAdapter,
        resolveEcdsaMaterialActivation: input.resolveEcdsaMaterialActivation,
      });
      if (exhaustedCandidate) return exhaustedCandidate;
    }
    const stepUp = await resolveRouterAbEcdsaOwnerOperationStepUpPreparation({
      body: input.body,
      phase: input.phase,
      resolveEcdsaMaterialActivation: input.resolveEcdsaMaterialActivation,
    });
    return {
      ok: false,
      result: routerAbEcdsaOwnerOperationFailureResult({
        status: routerAbWalletSessionValidationStatus(validated.code),
        code: validated.code,
        message: validated.message,
        phase: input.phase,
        stepUp,
      }),
    };
  }

  const session = validated.admission.context.authorization.session;
  const authorized = await authorizeRouterAbEcdsaWalletSessionRequest({
    phase: input.phase,
    body: input.body,
    session,
    admittedMaterialActivation: routerAbMpcMaterialActivationRefToWire(
      validated.admission.admission.materialActivation,
    ),
    admissionAdapter: input.admissionAdapter,
    resolveEcdsaMaterialActivation: input.resolveEcdsaMaterialActivation,
  });
  if (!authorized.ok) return authorized;
  return {
    ok: true,
    kind: 'wallet_session_operation_credential_v1',
    validated,
    admission: authorized.admission,
    activeMaterial: authorized.activeMaterial,
  };
}

export async function handleRouterAbEcdsaDerivationNormalSigningRouteCore(input: {
  body: Record<string, unknown>;
  rawBody: unknown;
  headers: Record<string, string | string[] | undefined>;
  session: SessionAdapter | null | undefined;
  runtime: RouterAbNormalSigningRouteRuntime | null | undefined;
  authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  authorizationSessions: RouterApiAuthorizationSessionService | null | undefined;
  admissionAdapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
  resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
  privatePath: RouterAbEcdsaDerivationPrivateSigningPath;
  phase: 'prepare' | 'finalize';
}): Promise<RouterAbJsonRouteResult> {
  const authorization = await authorizeRouterAbEcdsaDerivationNormalSigningRoute(input);
  if (!authorization.ok) return authorization.result;
  if (authorization.kind === 'operation_step_up') {
    return routerAbStepUpError(
      500,
      'internal',
      'Operation step-up must execute through the MPC router',
    );
  }
  const walletSession =
    authorization.kind === 'wallet_session_operation_credential_v1'
      ? authorization.validated.admission.context.authorization.session
      : authorization.candidate.status.session;
  const privateBody = await buildRouterAbEcdsaDerivationPrivateSigningWorkerBody({
    phase: input.phase,
    body: input.body,
    authorization: {
      kind: 'wallet_session_operation_credential_v1',
      walletSessionId: String(walletSession.walletSessionId),
      principalId: String(walletSession.principalId),
      runtimePolicyScope: authorization.activeMaterial.runtimePolicyScope,
    },
    headers: input.headers,
  });
  if (!input.authorizedOperations) {
    return routerAbStepUpError(
      501,
      'not_configured',
      'Reusable Wallet Session authorization is not configured',
    );
  }
  const request = parseRouterAbEcdsaOperationStepUpRequest(input);
  const claimed = await admitRouterAbEcdsaReusableWalletSessionOperation({
    request,
    materialActivation: authorization.admission.materialActivation,
    binding:
      authorization.kind === 'wallet_session_operation_credential_v1'
        ? {
            kind: 'wallet_session_operation_credential_v1' as const,
            context: authorization.validated.admission.context,
          }
        : {
            kind: 'wallet_session_operation_credential_exhausted_candidate_v1' as const,
            candidate: authorization.candidate,
          },
    authorizedOperations: input.authorizedOperations,
    resolveEcdsaMaterialActivation: input.resolveEcdsaMaterialActivation,
  });
  if (!claimed.ok) return claimed.error;
  if (claimed.admission.kind === 'replayed') {
    return routerAbEcdsaReplayResult(claimed.admission.operation);
  }
  const runtime = input.runtime;
  if (!runtime) return routerAbEcdsaPrivateSigningWorkerUnavailableResult();
  const signingWorker = runtime.getSigningWorkerPrivateTransport();
  if (signingWorker.kind === 'unconfigured') {
    return routerAbEcdsaPrivateSigningWorkerUnavailableResult();
  }
  if (input.phase === 'prepare') {
    if (claimed.admission.kind === 'operation_in_progress') {
      return routerAbEcdsaOperationInProgressResult();
    }
    const operation = claimed.admission.operation;
    const replay = await runtime.reservePrepareReplay({
      curve: 'ecdsa',
      authorizationIdentity: {
        kind: 'reusable_wallet_session',
        walletSessionId: String(walletSession.walletSessionId),
      },
      requestId: authorization.admission.requestId,
      expiresAtMs: authorization.admission.expiresAtMs,
    });
    if (!replay.ok) {
      await completeRouterAbEcdsaOperation({
        authorizedOperations: input.authorizedOperations,
        operation,
        result: 'failed_before_side_effect',
        response: {
          status: replay.status,
          contentType: 'application/json',
          bodyText: JSON.stringify({ ok: false, code: replay.code, message: replay.message }),
        },
      });
      return {
        status: replay.status,
        body: { ok: false, code: replay.code, message: replay.message },
      };
    }
    const forwarded = await postRouterAbSigningWorkerJson({
      config: signingWorker,
      path: input.privatePath,
      body: privateBody,
    });
    if (!forwarded.ok && !isRouterAbEcdsaSigningWorkerOperationInProgress(forwarded)) {
      await completeRouterAbEcdsaOperation({
        authorizedOperations: input.authorizedOperations,
        operation,
        result: forwarded.status < 500 ? 'failed_before_side_effect' : 'failed_after_side_effect',
        response: replayResponseFromSigningWorkerResult(forwarded),
      });
    }
    return forwarded.ok
      ? { status: 200, body: forwarded.body }
      : { status: forwarded.status, body: forwarded.body };
  }
  if (claimed.admission.kind === 'claimed') {
    return routerAbStepUpError(
      409,
      'authorized_operation_missing',
      'ECDSA finalize requires a claimed prepare operation',
    );
  }
  const forwarded = await postRouterAbSigningWorkerJson({
    config: signingWorker,
    path: input.privatePath,
    body: privateBody,
  });
  await completeRouterAbEcdsaOperation({
    authorizedOperations: input.authorizedOperations,
    operation: claimed.admission.operation,
    result: forwarded.ok
      ? 'succeeded'
      : forwarded.status < 500
        ? 'failed_before_side_effect'
        : 'failed_after_side_effect',
    response: replayResponseFromSigningWorkerResult(forwarded),
  });
  return forwarded.ok
    ? { status: 200, body: forwarded.body }
    : { status: forwarded.status, body: forwarded.body };
}
