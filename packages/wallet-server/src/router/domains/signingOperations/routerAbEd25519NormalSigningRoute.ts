// Authorization of an Ed25519 normal-signing request by a reusable or exhausted Wallet Session or
// an operation step-up, and the owner decision a refusal carries.
import {
  validateRouterAbEd25519WalletSessionInputs,
  type ThresholdEd25519SessionInputs,
} from '../../auth/commonRouterUtils';
import type { SessionAdapter } from '../../framework/routerApi';
import { extractBearerCredential } from '../../auth/routerApiKeyAuth';
import { base64UrlEncode } from '@shared/utils/encoders';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import type {
  RouterApiAuthorizedOperationService,
  RouterApiAuthorizationSessionService,
  RouterApiWalletRegistrationService,
  RouterApiWalletSessionAuthorizationV2AdmissionContext,
  RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext,
} from '../../framework/authServicePort';
import type { resolveWalletSessionAuthorizationV2Admission } from './walletExecutionAdmission';
import {
  buildNearEd25519MpcOperationRef,
  parseAuthorizedOperationId,
  parseCapabilityId,
  parseCapabilityOperationId,
  type AuthorizedOperationId,
  type CapabilityId,
  type CapabilityOperationId,
  type CapabilityOperationRef,
} from '@shared/authorization/capabilityKinds';
import {
  buildCapabilityOperationEnvelope,
  computeCapabilityOperationFingerprintDigest,
  parseSigningOperationFingerprintDigest,
} from '@shared/authorization/operationFingerprint';
import type {
  AuthorizedOperation,
  OwnerOperationAuthorizationDecision,
  SessionOrigin,
} from '../../../authorization/domain';
import {
  routerAbMpcMaterialActivationRefFromWire,
  routerAbMpcMaterialActivationRefToWire,
  sameRouterAbMpcMaterialActivationRef,
  type RouterAbEd25519OperationStepUpPreparationV1Wire,
  type RouterAbEd25519OwnerOperationAuthorizationDecisionV1Wire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import {
  parseEd25519ReusableAuthorizedOperationReceipt,
  parseEd25519VerifiedStepUpAuthorizedOperationReceipt,
  type Ed25519OperationKind,
  type Ed25519ReusableAuthorizedOperationReceipt,
  type Ed25519VerifiedStepUpAuthorizedOperationReceipt,
} from './ed25519AuthorizedOperationReceipt';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import { isPlainObject } from '@shared/utils/validation';
import {
  errorMessage,
  evaluateRouterAbNormalSigningAdmission,
  requireAuthorizationValue,
  type RouterAbEcdsaOperationAdmissionKind,
  type RouterAbJsonRouteResult,
  type RouterAbNormalSigningAdmissionAdapter,
  type RouterAbNormalSigningRouteAdmission,
  routerAbOwnerOperationFailureResult,
  routerAbOwnerOperationStepUpDecision,
  routerAbStepUpError,
  routerAbWalletSessionValidationStatus,
} from './routerAbNormalSigningAdmission';
import {
  type ActiveEd25519MaterialActivation,
  authenticateRouterAbWalletOperationStepUpIdentity,
  parseStepUpRequestOrigin,
  readExhaustedWalletSessionCandidate,
  recordedStepUpOperationClaim,
  resolveRouterAbEd25519OperationStepUpSession,
  type RouterAbExactOperationStepUpAuthenticationResult,
  type RouterAbExactOperationStepUpWalletSession,
  type RouterAbOperationStepUpAuthenticationFailure,
  routerAbOperationStepUpClaimFailure,
  type RouterAbOperationStepUpWalletSession,
  walletSessionScopeInvalidFailure,
} from './routerAbOperationStepUp';
import {
  buildRouterAbEd25519PrivateSigningWorkerBody,
  parseRouterAbEd25519NormalSigningScopeV2,
  requirePrivateSigningDigest,
  type RouterAbEd25519NormalSigningAuthorizationV2,
  type RouterAbEd25519NormalSigningScopeV2,
  type RouterAbEd25519PrivateSigningWorkerBody,
} from './routerAbPrivateSigningWorker';

export type RouterAbEd25519NormalSigningRoutePhase = 'prepare' | 'finalize';

export function buildRouterAbEd25519OwnerOperationStepUpPreparation(input: {
  readonly scope: RouterAbEd25519NormalSigningScopeV2;
  readonly body: Record<string, unknown>;
  readonly material: {
    readonly nearAccountId: string;
    readonly signerSlot: number;
    readonly signingWorkerId: string;
    readonly participantIds: readonly [number, number];
  };
}): RouterAbEd25519OperationStepUpPreparationV1Wire | null {
  const operation = parseRouterAbOperationStepUpOperation(input.body.intent);
  const expiresAtMs = Number(input.body.expires_at_ms);
  if (
    !operation.ok ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= 0 ||
    input.scope.account_id !== input.scope.material_activation.material_owner ||
    input.material.signingWorkerId !== input.scope.signing_worker_id ||
    input.material.participantIds.length !== 2
  ) {
    return null;
  }
  return {
    wallet_id: input.scope.account_id,
    operation_kind: operation.operation.operationKind,
    operation_id: operation.operationId,
    request_id: input.scope.request_id,
    account_id: input.scope.account_id,
    material_activation: input.scope.material_activation,
    signing_worker_id: input.scope.signing_worker_id,
    near_account_id: input.material.nearAccountId,
    signer_slot: input.material.signerSlot,
    participant_ids: input.material.participantIds,
    expires_at_ms: expiresAtMs,
  };
}

async function resolveRouterAbEd25519OwnerOperationStepUpPreparation(input: {
  readonly scope: RouterAbEd25519NormalSigningScopeV2;
  readonly body: Record<string, unknown>;
  readonly phase: RouterAbEd25519NormalSigningRoutePhase;
  readonly resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
}): Promise<RouterAbEd25519OperationStepUpPreparationV1Wire | undefined> {
  if (input.phase !== 'prepare') return undefined;
  try {
    const activeMaterial = await input.resolveEd25519MaterialActivation({
      walletId: input.scope.account_id,
      materialActivation: input.scope.material_activation,
    });
    if (!activeMaterial.ok) return undefined;
    return (
      buildRouterAbEd25519OwnerOperationStepUpPreparation({
        scope: input.scope,
        body: input.body,
        material: activeMaterial,
      }) ?? undefined
    );
  } catch {
    return undefined;
  }
}

export function decideRouterAbEd25519OwnerOperationAuthorization(input: {
  readonly operation: AuthorizedOperation;
}): OwnerOperationAuthorizationDecision<RouterAbEd25519OperationStepUpPreparationV1Wire> {
  if (
    input.operation.lifecycle !== 'claimed' ||
    input.operation.authorization.kind !== 'authorization_grant' ||
    input.operation.authorization.authorizationGrantRef.kind !== 'wallet_session_authorization' ||
    input.operation.quota.kind !== 'consume_reusable_wallet_session'
  ) {
    return {
      kind: 'denied',
      denial: {
        code: 'invalid_authority',
        message: 'Ed25519 reusable Wallet Session authorization is invalid',
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

function routerAbEd25519OwnerOperationDecisionForFailure(input: {
  readonly code: string;
  readonly phase: RouterAbEd25519NormalSigningRoutePhase;
  readonly stepUp?: RouterAbEd25519OperationStepUpPreparationV1Wire;
}): RouterAbEd25519OwnerOperationAuthorizationDecisionV1Wire | null {
  const stepUpDecision = routerAbOwnerOperationStepUpDecision(input);
  if (stepUpDecision) return stepUpDecision;
  switch (input.code) {
    case 'invalid_body':
      return {
        kind: 'denied',
        denial: { code: 'invalid_operation', message: 'Ed25519 operation request is invalid' },
      };
    case 'wallet_session_mismatch':
    case 'wallet_session_scope_mismatch':
    case 'scope_mismatch':
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
      return {
        kind: 'denied',
        denial: { code: 'invalid_authority', message: 'Ed25519 operation authority is invalid' },
      };
    case 'material_mismatch':
      return {
        kind: 'denied',
        denial: { code: 'inactive_material', message: 'Ed25519 signing material is inactive' },
      };
    case 'internal':
    case 'not_configured':
      return {
        kind: 'denied',
        denial: {
          code: 'authorization_unavailable',
          message: 'Ed25519 operation authorization is unavailable',
        },
      };
    default:
      return null;
  }
}

export function routerAbEd25519OwnerOperationFailureResult(input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly phase: RouterAbEd25519NormalSigningRoutePhase;
  readonly stepUp?: RouterAbEd25519OperationStepUpPreparationV1Wire;
}): RouterAbJsonRouteResult {
  return routerAbOwnerOperationFailureResult(
    input,
    routerAbEd25519OwnerOperationDecisionForFailure(input),
  );
}

type RouterAbEd25519WalletSessionValidationSuccess = Extract<
  ThresholdEd25519SessionInputs,
  { readonly ok: true }
>;

type RouterAbEd25519V2WalletSessionValidationSuccess = Extract<
  RouterAbEd25519WalletSessionValidationSuccess,
  { readonly kind: 'wallet_session_operation_credential_v1' }
>;

type RouterAbEd25519WalletSessionAdmission = Extract<
  ReturnType<typeof resolveWalletSessionAuthorizationV2Admission>,
  { readonly ok: true; readonly keyFamily: 'ed25519' }
>;

export type RouterAbEd25519NormalSigningAuthorizationResult =
  | {
      readonly ok: true;
      readonly kind: 'wallet_session_operation_credential_v1';
      readonly validated: RouterAbEd25519V2WalletSessionValidationSuccess;
      readonly admission: Extract<RouterAbNormalSigningRouteAdmission, { readonly ok: true }>;
      readonly activeMaterial: ActiveEd25519MaterialActivation;
    }
  | {
      readonly ok: true;
      readonly kind: 'wallet_session_operation_credential_exhausted_candidate_v1';
      readonly candidate: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext;
      readonly admission: Extract<RouterAbNormalSigningRouteAdmission, { readonly ok: true }>;
      readonly activeMaterial: ActiveEd25519MaterialActivation;
    }
  | {
      readonly ok: true;
      readonly kind: 'operation_step_up';
      readonly phase: 'prepare';
      readonly session: RouterAbOperationStepUpWalletSession;
      readonly operation: AuthorizedOperation;
      readonly operationDigests: {
        readonly laneDigest: ReturnType<typeof parseDigestB64u>;
        readonly intentDigest: ReturnType<typeof parseDigestB64u>;
        readonly displayDigest: ReturnType<typeof parseDigestB64u>;
      };
      readonly admissionKind: RouterAbEcdsaOperationAdmissionKind;
    }
  | {
      readonly ok: true;
      readonly kind: 'operation_step_up';
      readonly phase: 'finalize';
      readonly session: RouterAbOperationStepUpWalletSession;
    }
  | { readonly ok: false; readonly result: RouterAbJsonRouteResult };

async function handleRouterAbEd25519OperationStepUpRoute(input: {
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  readonly authorizationSessions: RouterApiAuthorizationSessionService | null | undefined;
  readonly resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
  readonly phase: RouterAbEd25519NormalSigningRoutePhase;
  readonly scope: RouterAbEd25519NormalSigningScopeV2;
  readonly operationKind: Ed25519OperationKind;
}): Promise<
  | RouterAbJsonRouteResult
  | {
      readonly phase: 'prepare';
      readonly session: RouterAbOperationStepUpWalletSession;
      readonly operation: AuthorizedOperation;
      readonly operationDigests: {
        readonly laneDigest: ReturnType<typeof parseDigestB64u>;
        readonly intentDigest: ReturnType<typeof parseDigestB64u>;
        readonly displayDigest: ReturnType<typeof parseDigestB64u>;
      };
      readonly admissionKind: RouterAbEcdsaOperationAdmissionKind;
    }
  | {
      readonly phase: 'finalize';
      readonly session: RouterAbOperationStepUpWalletSession;
    }
> {
  if (input.scope.authorization.kind !== 'operation_step_up') {
    return routerAbStepUpError(400, 'invalid_body', 'Operation step-up authority is required');
  }
  const expiresAtMs = Number(input.body.expires_at_ms);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) {
    return routerAbStepUpError(
      408,
      'expired_request',
      'Router A/B Ed25519 step-up request is expired',
    );
  }
  let authenticated:
    | RouterAbExactOperationStepUpAuthenticationResult
    | RouterAbEd25519ExhaustedCandidateOperationStepUpAuthentication =
    await authenticateRouterAbWalletOperationStepUp({
      headers: input.headers,
      scope: input.scope,
      operationKind: input.operationKind,
      requestExpiresAtMs: expiresAtMs,
      authorizedOperations: input.authorizedOperations,
      authorizationSessions: input.authorizationSessions,
      resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
    });
  if (
    !authenticated.ok &&
    input.authorizedOperations &&
    input.authorizationSessions &&
    isWalletSessionUnavailableStepUpError(authenticated.error)
  ) {
    const exhaustedCandidate =
      await resolveRouterAbEd25519ExhaustedCandidateOperationStepUpAuthentication({
        headers: input.headers,
        scope: input.scope,
        operationKind: input.operationKind,
        requestExpiresAtMs: expiresAtMs,
        authorizedOperations: input.authorizedOperations,
        authorizationSessions: input.authorizationSessions,
        resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
      });
    if (exhaustedCandidate) {
      if (!exhaustedCandidate.ok) return exhaustedCandidate.error;
      authenticated = exhaustedCandidate;
    }
  }
  if (!authenticated.ok) return authenticated.error;

  const activeMaterial =
    'activeMaterial' in authenticated
      ? authenticated.activeMaterial
      : await input.resolveEd25519MaterialActivation({
          walletId: authenticated.session.walletId,
          materialActivation: input.scope.material_activation,
        });
  if (!activeMaterial.ok) {
    return routerAbStepUpError(
      activeMaterial.code === 'internal' ? 500 : 403,
      activeMaterial.code === 'internal' ? 'internal' : 'scope_mismatch',
      activeMaterial.code === 'internal'
        ? activeMaterial.message
        : 'Operation step-up material is no longer active',
    );
  }
  if (
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      input.scope.material_activation,
    )
  ) {
    return routerAbStepUpError(
      403,
      'scope_mismatch',
      'Operation step-up scope does not name the active material',
    );
  }

  if (input.phase === 'prepare') {
    let privateBody: RouterAbEd25519PrivateSigningWorkerBody;
    try {
      privateBody = await buildRouterAbEd25519PrivateSigningWorkerBody({
        phase: 'prepare',
        body: input.body,
        authorization: {
          kind: 'operation_step_up',
          session: authenticated.session,
        },
        headers: input.headers,
      });
    } catch (error: unknown) {
      return routerAbStepUpError(400, 'invalid_body', errorMessage(error));
    }
    const operation = parseRouterAbOperationStepUpOperation(input.body.intent);
    if (!operation.ok) {
      return routerAbStepUpError(400, 'invalid_body', operation.message);
    }
    let authorizedOperationId: AuthorizedOperationId;
    let capabilityId: CapabilityId;
    let laneDigest: ReturnType<typeof parseDigestB64u>;
    let intentDigest: ReturnType<typeof parseDigestB64u>;
    let displayDigest: ReturnType<typeof parseDigestB64u>;
    try {
      authorizedOperationId = requireAuthorizationValue(
        parseAuthorizedOperationId(`normal-signing-operation:${input.scope.request_id}`),
      );
      capabilityId = requireAuthorizationValue(
        parseCapabilityId(input.scope.material_activation.capability),
      );
      if (!('admission_candidate' in privateBody)) {
        throw new Error('Router A/B step-up prepare admission is missing');
      }
      laneDigest = parseSigningOperationFingerprintDigest(
        (input.body.intent as { operation_fingerprint?: unknown }).operation_fingerprint,
      );
      intentDigest = parseDigestB64u(
        base64UrlEncode(Uint8Array.from(privateBody.admission_candidate.intent_digest.bytes)),
      );
      displayDigest = parseDigestB64u(
        base64UrlEncode(
          Uint8Array.from(
            requirePrivateSigningDigest(input.body.display_digest, 'display_digest').bytes,
          ),
        ),
      );
    } catch (error: unknown) {
      return routerAbStepUpError(400, 'invalid_body', errorMessage(error));
    }
    const operationEnvelope = buildCapabilityOperationEnvelope({
      tenantId: authenticated.session.tenantId,
      principalId: authenticated.session.principalId,
      capabilityId,
      operationId: operation.operationId,
      operation: operation.operation,
      digests: { laneDigest, intentDigest, displayDigest },
    });
    const operationFingerprintDigest =
      await computeCapabilityOperationFingerprintDigest(operationEnvelope);
    const existing = await authenticated.authorizedOperations.readAuthorizedOperation({
      tenantId: authenticated.session.tenantId,
      operationFingerprintDigest,
    });
    if (!existing || existing.authorizedOperationId !== authorizedOperationId) {
      return routerAbStepUpError(
        409,
        'authorized_operation_missing',
        'Authorized operation is unavailable',
      );
    }
    const claim = recordedStepUpOperationClaim(existing);
    if (!claim.ok) return claim.error;
    let claimResult: Awaited<
      ReturnType<RouterApiAuthorizedOperationService['admitAuthorizedOperation']>
    >;
    try {
      claimResult = await authenticated.authorizedOperations.admitAuthorizedOperation({
        operation: claim.operation,
      });
    } catch (error: unknown) {
      return routerAbStepUpError(400, 'invalid_body', errorMessage(error));
    }
    const claimFailure = routerAbOperationStepUpClaimFailure(claimResult);
    if (claimFailure) return claimFailure;
    if (
      claimResult.kind !== 'claimed' &&
      claimResult.kind !== 'operation_in_progress' &&
      claimResult.kind !== 'replayed'
    ) {
      return routerAbStepUpError(
        409,
        'authorized_operation_missing',
        'Authorized operation is unavailable',
      );
    }
    return {
      phase: 'prepare',
      session: authenticated.session,
      operation: claimResult.operation,
      operationDigests: { laneDigest, intentDigest, displayDigest },
      admissionKind: claimResult.kind,
    };
  }
  return { phase: 'finalize', session: authenticated.session };
}

type RouterAbEd25519ExhaustedCandidateOperationStepUpAuthentication =
  | {
      readonly ok: true;
      readonly kind: 'wallet_session_operation_credential_exhausted_candidate_v1';
      readonly authorizedOperations: RouterApiAuthorizedOperationService;
      readonly candidate: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext;
      readonly activeMaterial: ActiveEd25519MaterialActivation;
      readonly session: RouterAbExactOperationStepUpWalletSession;
      readonly requestOrigin: SessionOrigin;
      readonly expiresAtMs: number;
    }
  | RouterAbOperationStepUpAuthenticationFailure;

async function resolveRouterAbEd25519ExhaustedCandidateOperationStepUpAuthentication(input: {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly scope: RouterAbEd25519NormalSigningScopeV2;
  readonly operationKind: Ed25519OperationKind;
  readonly requestExpiresAtMs: number;
  readonly authorizedOperations: RouterApiAuthorizedOperationService;
  readonly authorizationSessions: RouterApiAuthorizationSessionService;
  readonly resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
}): Promise<RouterAbEd25519ExhaustedCandidateOperationStepUpAuthentication | null> {
  const token = extractBearerCredential(input.headers);
  if (!token) return null;
  const origin = parseStepUpRequestOrigin(input.headers);
  if (!origin.ok) return origin;
  const exhausted = await readExhaustedWalletSessionCandidate({
    authorizationSessions: input.authorizationSessions,
    token,
    operation: { keyFamily: 'ed25519', operationKind: input.operationKind },
  });
  if (!exhausted?.ok) return exhausted;
  const { candidate, session, admission } = exhausted;
  if (!admission.ok || admission.keyFamily !== 'ed25519') {
    return walletSessionScopeInvalidFailure();
  }
  const resolved = await resolveRouterAbEd25519OperationStepUpSession({
    walletId: input.scope.account_id,
    materialOwner: input.scope.material_activation.material_owner,
    materialActivation: input.scope.material_activation,
    requestExpiresAtMs: input.requestExpiresAtMs,
    operationKind: input.operationKind,
    authorizedOperations: input.authorizedOperations,
    session,
    admission,
    resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
  });
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    kind: 'wallet_session_operation_credential_exhausted_candidate_v1',
    authorizedOperations: input.authorizedOperations,
    candidate,
    activeMaterial: resolved.activeMaterial,
    session: resolved.session,
    requestOrigin: origin.requestOrigin,
    expiresAtMs: session.expiresAtMs,
  };
}

function isWalletSessionUnavailableStepUpError(result: RouterAbJsonRouteResult): boolean {
  return isPlainObject(result.body) && result.body.code === 'wallet_session_unavailable';
}

export async function authenticateRouterAbWalletOperationStepUp(input: {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly scope: RouterAbEd25519NormalSigningScopeV2;
  readonly operationKind: Ed25519OperationKind;
  readonly requestExpiresAtMs: number;
  readonly authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  readonly authorizationSessions: RouterApiAuthorizationSessionService | null | undefined;
  readonly resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
}): Promise<RouterAbExactOperationStepUpAuthenticationResult> {
  return authenticateRouterAbWalletOperationStepUpIdentity({
    kind: 'wallet_session_operation_credential_v1',
    headers: input.headers,
    keyFamily: 'ed25519',
    operationKind: input.operationKind,
    walletId: input.scope.account_id,
    materialOwner: input.scope.material_activation.material_owner,
    materialActivation: input.scope.material_activation,
    requestExpiresAtMs: input.requestExpiresAtMs,
    authorizedOperations: input.authorizedOperations,
    authorizationSessions: input.authorizationSessions,
    resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
  });
}

export function parseRouterAbEd25519OperationStepUpScope(
  value: unknown,
): RouterAbEd25519NormalSigningScopeV2 {
  return parseRouterAbEd25519NormalSigningScopeV2(value);
}

export function parseRouterAbOperationStepUpOperation(value: unknown):
  | {
      readonly ok: true;
      readonly operationId: CapabilityOperationId;
      readonly operation: Extract<
        CapabilityOperationRef,
        { readonly capabilityKind: 'near_ed25519_mpc_signing' }
      > & {
        readonly operationKind:
          | 'near.sign_transaction'
          | 'near.sign_delegate_action'
          | 'near.sign_nep413_message';
      };
    }
  | { readonly ok: false; readonly message: string } {
  const intent = isPlainObject(value) ? value : null;
  if (!intent) return { ok: false, message: 'Router A/B step-up intent is required' };
  let operationKind:
    | 'near.sign_transaction'
    | 'near.sign_delegate_action'
    | 'near.sign_nep413_message';
  switch (intent.kind) {
    case 'near_transaction_v1':
      operationKind = 'near.sign_transaction';
      break;
    case 'near_delegate_action_v1':
      operationKind = 'near.sign_delegate_action';
      break;
    case 'nep413_v1':
      operationKind = 'near.sign_nep413_message';
      break;
    default:
      return { ok: false, message: 'Router A/B step-up intent kind is invalid' };
  }
  const operationId = parseCapabilityOperationId(intent.operation_id);
  if (!operationId.ok) return { ok: false, message: operationId.error.message };
  return {
    ok: true,
    operationId: operationId.value,
    operation: buildNearEd25519MpcOperationRef(operationKind),
  };
}

type RouterAbEd25519NormalSigningOperationForAdmission =
  | {
      readonly phase: 'prepare';
      readonly operationKind: Ed25519OperationKind;
    }
  | {
      readonly phase: 'finalize';
      readonly operationKind: Ed25519OperationKind;
      readonly authorizationKind: 'reusable_wallet_session';
      readonly receipt: Ed25519ReusableAuthorizedOperationReceipt;
    }
  | {
      readonly phase: 'finalize';
      readonly operationKind: Ed25519OperationKind;
      readonly authorizationKind: 'operation_step_up';
      readonly receipt: Ed25519VerifiedStepUpAuthorizedOperationReceipt;
    };

function parseRouterAbEd25519NormalSigningOperationForAdmission(input: {
  readonly phase: RouterAbEd25519NormalSigningRoutePhase;
  readonly body: Record<string, unknown>;
  readonly authorizationKind: RouterAbEd25519NormalSigningAuthorizationV2['kind'];
}):
  | { readonly ok: true; readonly operation: RouterAbEd25519NormalSigningOperationForAdmission }
  | { readonly ok: false; readonly message: string } {
  if (input.phase === 'prepare') {
    const requestedOperation = parseRouterAbOperationStepUpOperation(input.body.intent);
    if (!requestedOperation.ok) return requestedOperation;
    return {
      ok: true,
      operation: {
        phase: 'prepare',
        operationKind: requestedOperation.operation.operationKind,
      },
    };
  }
  try {
    switch (input.authorizationKind) {
      case 'reusable_wallet_session': {
        const receipt = parseEd25519ReusableAuthorizedOperationReceipt(
          input.body.authorized_operation,
        );
        return {
          ok: true,
          operation: {
            phase: 'finalize',
            operationKind: receipt.operation_kind,
            authorizationKind: 'reusable_wallet_session',
            receipt,
          },
        };
      }
      case 'operation_step_up': {
        const receipt = parseEd25519VerifiedStepUpAuthorizedOperationReceipt(
          input.body.authorized_operation,
        );
        return {
          ok: true,
          operation: {
            phase: 'finalize',
            operationKind: receipt.operation_kind,
            authorizationKind: 'operation_step_up',
            receipt,
          },
        };
      }
    }
  } catch (error: unknown) {
    return { ok: false, message: errorMessage(error) };
  }
}

async function validateRouterAbEd25519V2FinalizeAuthorizedOperation(input: {
  readonly receipt: Ed25519ReusableAuthorizedOperationReceipt;
  readonly authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  readonly phase: RouterAbEd25519NormalSigningRoutePhase;
}): Promise<
  | { readonly ok: true; readonly operationKind: Ed25519OperationKind }
  | { readonly ok: false; readonly result: RouterAbJsonRouteResult }
> {
  if (!input.authorizedOperations) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 501,
        code: 'not_configured',
        message: 'Reusable Wallet Session authorization is not configured',
        phase: input.phase,
      }),
    };
  }

  let authorizedOperationId: AuthorizedOperationId;
  try {
    authorizedOperationId = requireAuthorizationValue(
      parseAuthorizedOperationId(input.receipt.authorized_operation_id),
    );
    requireAuthorizationValue(parseCapabilityOperationId(input.receipt.operation_id));
  } catch (error: unknown) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 400,
        code: 'invalid_authorized_operation',
        message: errorMessage(error),
        phase: input.phase,
      }),
    };
  }

  let operation: AuthorizedOperation | null;
  try {
    operation = await input.authorizedOperations.readAuthorizedOperationById({
      tenantId: input.authorizedOperations.tenantId,
      authorizedOperationId,
    });
  } catch (error: unknown) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 500,
        code: 'internal',
        message: errorMessage(error),
        phase: input.phase,
      }),
    };
  }
  if (!operation) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 409,
        code: 'authorized_operation_missing',
        message: 'Authorized operation is unavailable',
        phase: input.phase,
      }),
    };
  }

  const operationRef = operation.operation.operation;
  if (
    operation.tenantId !== input.authorizedOperations.tenantId ||
    operation.authorizedOperationId !== authorizedOperationId ||
    operation.operation.operationId !== input.receipt.operation_id ||
    operation.operationFingerprintDigest !== input.receipt.operation_fingerprint_digest ||
    operation.operation.digests.laneDigest !== input.receipt.lane_digest_b64u ||
    operation.operation.digests.intentDigest !== input.receipt.intent_digest_b64u ||
    operation.operation.digests.displayDigest !== input.receipt.display_digest_b64u ||
    operationRef.capabilityKind !== 'near_ed25519_mpc_signing' ||
    operationRef.operationKind !== input.receipt.operation_kind
  ) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 400,
        code: 'invalid_authorized_operation',
        message: 'Ed25519 authorized operation does not match its receipt',
        phase: input.phase,
      }),
    };
  }

  switch (operationRef.operationKind) {
    case 'near.sign_transaction':
    case 'near.sign_delegate_action':
    case 'near.sign_nep413_message':
      return { ok: true, operationKind: operationRef.operationKind };
  }
}

type RouterAbEd25519ReusableWalletSessionOperation =
  | Extract<RouterAbEd25519NormalSigningOperationForAdmission, { readonly phase: 'prepare' }>
  | Extract<
      RouterAbEd25519NormalSigningOperationForAdmission,
      { readonly phase: 'finalize'; readonly authorizationKind: 'reusable_wallet_session' }
    >;

type RouterAbEd25519WalletSessionAuthorization =
  | {
      readonly ok: true;
      readonly admission: Extract<RouterAbNormalSigningRouteAdmission, { readonly ok: true }>;
      readonly activeMaterial: ActiveEd25519MaterialActivation;
    }
  | { readonly ok: false; readonly result: RouterAbJsonRouteResult };

async function authorizeRouterAbEd25519WalletSessionRequest(input: {
  readonly phase: RouterAbEd25519NormalSigningRoutePhase;
  readonly body: Record<string, unknown>;
  readonly scope: RouterAbEd25519NormalSigningScopeV2;
  readonly operation: RouterAbEd25519ReusableWalletSessionOperation;
  readonly session: RouterApiWalletSessionAuthorizationV2AdmissionContext['authorization']['session'];
  readonly authorityId: string;
  readonly admission: RouterAbEd25519WalletSessionAdmission;
  readonly authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  readonly admissionAdapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
  readonly resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
}): Promise<RouterAbEd25519WalletSessionAuthorization> {
  if (input.operation.phase === 'finalize') {
    const exactOperation = await validateRouterAbEd25519V2FinalizeAuthorizedOperation({
      receipt: input.operation.receipt,
      authorizedOperations: input.authorizedOperations,
      phase: input.phase,
    });
    if (!exactOperation.ok) return exactOperation;
    if (exactOperation.operationKind !== input.admission.operationKind) {
      return {
        ok: false,
        result: routerAbEd25519OwnerOperationFailureResult({
          status: 403,
          code: 'wallet_session_scope_mismatch',
          message: 'Exact Wallet Session operation does not match the authorized operation',
          phase: input.phase,
        }),
      };
    }
  }

  const expectedMaterialActivation = routerAbMpcMaterialActivationRefFromWire(
    input.scope.material_activation,
  );
  const admittedMaterialActivation = routerAbMpcMaterialActivationRefToWire(
    input.admission.materialActivation,
  );
  const expiresAtMs = Number(input.body.expires_at_ms);
  if (
    input.scope.authorization.wallet_session_id !== input.session.walletSessionId ||
    input.scope.account_id !== String(input.session.walletId) ||
    input.scope.material_activation.material_owner !== String(input.session.walletId) ||
    input.scope.signing_worker_id !== input.scope.material_activation.signing_worker ||
    !mpcMaterialActivationRefsEqual(
      expectedMaterialActivation,
      input.admission.materialActivation,
    ) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= 0
  ) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 403,
        code: 'wallet_session_scope_mismatch',
        message: 'Exact Wallet Session does not authorize this Ed25519 request',
        phase: input.phase,
      }),
    };
  }
  if (expiresAtMs <= Date.now()) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 408,
        code: 'expired_request',
        message: 'Router A/B Ed25519 normal-signing request is expired',
        phase: input.phase,
      }),
    };
  }
  if (expiresAtMs > input.session.expiresAtMs) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 403,
        code: 'wallet_session_scope_mismatch',
        message: 'Ed25519 request exceeds the exact Wallet Session lifetime',
        phase: input.phase,
      }),
    };
  }
  const activeMaterial = await input.resolveEd25519MaterialActivation({
    walletId: String(input.session.walletId),
    materialActivation: admittedMaterialActivation,
  });
  if (
    !activeMaterial.ok ||
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      admittedMaterialActivation,
    ) ||
    activeMaterial.signingWorkerId !== input.scope.signing_worker_id ||
    base64UrlEncode(Uint8Array.from(activeMaterial.exportIdentity.registered_public_key)) !==
      input.admission.signer.registeredPublicKeyB64u
  ) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: activeMaterial.ok || activeMaterial.code !== 'internal' ? 403 : 500,
        code:
          activeMaterial.ok || activeMaterial.code !== 'internal'
            ? 'material_mismatch'
            : 'internal',
        message: activeMaterial.ok
          ? 'Exact Wallet Session material does not match the active Ed25519 material'
          : activeMaterial.message,
        phase: input.phase,
      }),
    };
  }
  const admission = {
    ok: true as const,
    thresholdSessionId: activeMaterial.exportIdentity.scope.threshold_session_id,
    requestId: input.scope.request_id,
    expiresAtMs,
    materialActivation: admittedMaterialActivation,
  };
  const admissionDecision = await evaluateRouterAbNormalSigningAdmission({
    adapter: input.admissionAdapter,
    curve: 'ed25519',
    authorizationKind: 'wallet_session_operation_credential_v1',
    phase: input.phase,
    walletId: String(input.session.walletId),
    authorityId: input.authorityId,
    thresholdSessionId: activeMaterial.exportIdentity.scope.threshold_session_id,
    walletSessionId: String(input.session.walletSessionId),
    quotaId: String(input.session.quotaId),
    requestId: input.scope.request_id,
    expiresAtMs,
    signingWorkerId: activeMaterial.signingWorkerId,
    runtimePolicyScope: activeMaterial.runtimePolicyScope,
  });
  if (!admissionDecision.ok) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: admissionDecision.status,
        code: admissionDecision.code,
        message: admissionDecision.message,
        phase: input.phase,
      }),
    };
  }
  return { ok: true, admission, activeMaterial };
}

type RouterAbEd25519ExhaustedCandidateAuthorization =
  | Extract<
      RouterAbEd25519NormalSigningAuthorizationResult,
      {
        readonly ok: true;
        readonly kind: 'wallet_session_operation_credential_exhausted_candidate_v1';
      }
    >
  | { readonly ok: false; readonly result: RouterAbJsonRouteResult };

async function resolveRouterAbEd25519ExhaustedCandidateAuthorization(input: {
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly scope: RouterAbEd25519NormalSigningScopeV2;
  readonly phase: RouterAbEd25519NormalSigningRoutePhase;
  readonly operation: RouterAbEd25519ReusableWalletSessionOperation;
  readonly authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  readonly authorizationSessions: RouterApiAuthorizationSessionService;
  readonly admissionAdapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
  readonly resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
}): Promise<RouterAbEd25519ExhaustedCandidateAuthorization | null> {
  const token = extractBearerCredential(input.headers);
  if (!token) return null;
  const exhausted = await readExhaustedWalletSessionCandidate({
    authorizationSessions: input.authorizationSessions,
    token,
    operation: { keyFamily: 'ed25519', operationKind: input.operation.operationKind },
  });
  if (!exhausted) return null;
  if (!exhausted.ok) return { ok: false, result: exhausted.error };
  const { candidate, session, admission } = exhausted;
  if (!admission.ok || admission.keyFamily !== 'ed25519') {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 403,
        code: 'wallet_session_scope_mismatch',
        message: 'Exact Wallet Session does not authorize this Ed25519 request',
        phase: input.phase,
      }),
    };
  }

  const authorized = await authorizeRouterAbEd25519WalletSessionRequest({
    phase: input.phase,
    body: input.body,
    scope: input.scope,
    operation: input.operation,
    session,
    authorityId: String(candidate.authority.authorityId),
    admission,
    authorizedOperations: input.authorizedOperations,
    admissionAdapter: input.admissionAdapter,
    resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
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

export async function authorizeRouterAbEd25519NormalSigningRoute(input: {
  body: Record<string, unknown>;
  rawBody: unknown;
  headers: Record<string, string | string[] | undefined>;
  session: SessionAdapter | null | undefined;
  authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  authorizationSessions: RouterApiAuthorizationSessionService | null | undefined;
  admissionAdapter: RouterAbNormalSigningAdmissionAdapter | null | undefined;
  resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
  phase: RouterAbEd25519NormalSigningRoutePhase;
}): Promise<RouterAbEd25519NormalSigningAuthorizationResult> {
  let scope: RouterAbEd25519NormalSigningScopeV2;
  try {
    scope = parseRouterAbEd25519NormalSigningScopeV2(input.body.scope);
  } catch (error: unknown) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 400,
        code: 'invalid_body',
        message: errorMessage(error),
        phase: input.phase,
      }),
    };
  }
  const operationForAdmission = parseRouterAbEd25519NormalSigningOperationForAdmission({
    phase: input.phase,
    body: input.body,
    authorizationKind: scope.authorization.kind,
  });
  if (!operationForAdmission.ok) {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 400,
        code: 'invalid_body',
        message: operationForAdmission.message,
        phase: input.phase,
      }),
    };
  }
  if (scope.authorization.kind === 'operation_step_up') {
    const result = await handleRouterAbEd25519OperationStepUpRoute({
      body: input.body,
      headers: input.headers,
      authorizedOperations: input.authorizedOperations,
      authorizationSessions: input.authorizationSessions,
      resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
      phase: input.phase,
      scope,
      operationKind: operationForAdmission.operation.operationKind,
    });
    return 'status' in result
      ? { ok: false, result }
      : { ok: true, kind: 'operation_step_up', ...result };
  }

  const validated = await validateRouterAbEd25519WalletSessionInputs({
    headers: input.headers,
    authorizationSessions: input.authorizationSessions,
    operationKind: operationForAdmission.operation.operationKind,
  });
  if (!validated.ok) {
    const operation = operationForAdmission.operation;
    if (
      validated.code === 'wallet_session_unavailable' &&
      input.authorizationSessions &&
      (operation.phase === 'prepare' || operation.authorizationKind === 'reusable_wallet_session')
    ) {
      const exhaustedCandidate = await resolveRouterAbEd25519ExhaustedCandidateAuthorization({
        body: input.body,
        headers: input.headers,
        scope,
        phase: input.phase,
        operation,
        authorizedOperations: input.authorizedOperations,
        authorizationSessions: input.authorizationSessions,
        admissionAdapter: input.admissionAdapter,
        resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
      });
      if (exhaustedCandidate) return exhaustedCandidate;
    }
    const stepUp = await resolveRouterAbEd25519OwnerOperationStepUpPreparation({
      scope,
      body: input.body,
      phase: input.phase,
      resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
    });
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: routerAbWalletSessionValidationStatus(validated.code),
        code: validated.code,
        message: validated.message,
        phase: input.phase,
        stepUp,
      }),
    };
  }

  const operation = operationForAdmission.operation;
  if (operation.phase === 'finalize' && operation.authorizationKind !== 'reusable_wallet_session') {
    return {
      ok: false,
      result: routerAbEd25519OwnerOperationFailureResult({
        status: 400,
        code: 'invalid_authorized_operation',
        message: 'Reusable Wallet Session authorized operation is required',
        phase: input.phase,
      }),
    };
  }
  const authorized = await authorizeRouterAbEd25519WalletSessionRequest({
    phase: input.phase,
    body: input.body,
    scope,
    operation,
    session: validated.admission.context.authorization.session,
    authorityId: String(validated.admission.context.authority.authorityId),
    admission: validated.admission.admission,
    authorizedOperations: input.authorizedOperations,
    admissionAdapter: input.admissionAdapter,
    resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
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
