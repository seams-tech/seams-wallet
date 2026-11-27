import { resolveWalletSessionAuthorizationV2Admission } from '../../../domains/signingOperations/walletExecutionAdmission';
import {
  walletSessionAuthorizationV2RecordsEqual,
  type WalletSessionExactOperationContext,
} from '../../../../authorization/domain';
import { finishRouterAbEcdsaSigningResponse } from '../../../domains/signingOperations/ecdsaSigningResponse';
import { signingPrepareSessionResponse } from '../../../domains/signingOperations/signingPrepareSession';
import {
  buildAuthorizedOperationWire,
  type AuthorizedOperationBindingWire,
  type AuthorizedOperationWireInput,
  type OperationStepUpBinding,
} from '../../../domains/signingOperations/authorizedOperationWire';
import type { FetchRouterApiContext } from '../createFetchRouter';
import { json, jsonFailure } from '../../../framework/http';
import { requireAuthorizationValue } from '../../../domains/signingOperations/routerAbNormalSigningAdmission';
import { handleEcdsaPoolFillRoute } from './thresholdEcdsaPoolFill';
import {
  ecdsaMaterialNamesOperationKey,
  emptySigningGatewayTiming,
  failureResult,
  gatewayOwnerWalletSessionBinding,
  jsonObjectOrEmpty,
  normalSigningAuthorizationRequest,
  operationStepUpAdmissionRefusal,
  operationStepUpBinding,
  ownerOperationNotAuthorizedResponse,
  readPinnedEcdsaStepUpWalletScope,
  readThresholdRouteBody,
  reusableWalletSession,
  withServerTiming,
  type SigningGatewayTiming,
} from './thresholdSigningRouteShared';
import { thresholdEcdsaStatusCode } from '../../../../threshold/statusCodes';
import {
  resolveWalletSessionOperationCredentialAdmission,
  type WalletSessionOperationCredentialAdmission,
} from '../../../auth/commonRouterUtils';
import {
  parseRouterAbEcdsaDerivationActivationRefreshCommitRequestV1,
  parseRouterAbEcdsaDerivationExplicitExportRequestV1,
  parseRouterAbEcdsaOperationStepUpAuthorizationRequestV1,
  parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
  parseRouterAbEcdsaPrepareSourceV1,
  parseRouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
  computeRouterAbEcdsaOperationStepUpChallengeB64u,
  sameRouterAbEcdsaDerivationPublicCapabilityV1,
  ROUTER_AB_ECDSA_DERIVATION_EXPORT_PATH,
  ROUTER_AB_ECDSA_DERIVATION_HEALTH_PATH,
  ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_PATH,
  ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_PREPARE_PATH,
  ROUTER_AB_ECDSA_DERIVATION_OPERATION_STEP_UP_PATH,
  ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_FILL_INIT_PATH,
  ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_FILL_STEP_PATH,
  ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH,
  ROUTER_AB_ECDSA_DERIVATION_SESSION_ACTIVATION_PATH,
  type RouterAbEcdsaDerivationActivationRefreshCommitRequestV1,
  type RouterAbEcdsaDerivationActivationRefreshRequestV1,
  type RouterAbEcdsaDerivationExplicitExportRequestV1,
  type RouterAbEcdsaOperationStepUpAuthorizationRequestV1Wire,
  type RouterAbEcdsaOperationStepUpPreparationV1Wire,
  type RouterAbEcdsaOperationStepUpExportTopologyV1Wire,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { RouterAbEcdsaOperationAdmissionKind } from '../../../domains/signingOperations/routerAbNormalSigningAdmission';
import { authenticateRouterAbWalletOperationStepUpIdentity } from '../../../domains/signingOperations/routerAbOperationStepUp';
import {
  authorizeRouterAbEcdsaDerivationNormalSigningRoute,
  admitRouterAbEcdsaReusableWalletSessionOperation,
  routerAbEcdsaOperationInProgressResult,
  routerAbEcdsaReplayHttpResponse,
  routerAbEcdsaReplayUnavailableResult,
  buildRouterAbEcdsaOwnerOperationStepUpPreparation,
  decideRouterAbEcdsaOwnerOperationAuthorization,
  resolveFreshRouterAbEcdsaMaterialActivation,
  routerAbEcdsaAtomicAuthorizationConfigured,
  routerAbEcdsaOwnerOperationFailureResult,
} from '../../../domains/signingOperations/routerAbEcdsaDerivationNormalSigningRoute';
import type { EcdsaMaterialReadSnapshot } from '../../../../core/ecdsaMaterialReadSnapshot';
import type {
  RouterAbEcdsaStrictPostRegistrationPort,
  RouterAbEcdsaStrictExportResult,
  RouterAbEcdsaStrictRefreshResult,
  RouterAbEcdsaStrictExportAuthority,
  RouterAbEcdsaStrictRegistrationAuthority,
} from '../../../domains/ecdsa/routerAbEcdsaStrictRegistration';
import type {
  RouterApiAuthorizedOperationService,
  RouterApiWalletAuthMethodService,
  RouterApiWalletRegistrationService,
} from '../../../framework/authServicePort';
import { WALLET_SESSION_FAILURE_CODES } from '@shared/utils/walletSessionFailure';
import {
  walletSessionFailure,
  walletSessionFailureStatus,
  type WalletSessionBoundaryFailure,
} from '../../../auth/walletSessionFailure';
import { extractBearerCredential } from '../../../auth/routerApiKeyAuth';
import {
  walletAuthAuthorityRef,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import { walletIdFromString } from '@shared/utils/registrationIds';
import {
  parseAuthorizationAuditEventId,
  parseAuthorizedOperationId,
  parseCapabilityId,
  parseCapabilityOperationId,
  parseAuthorizationEvidenceId,
  parseAuthorizationEvidenceSetId,
} from '@shared/authorization/capabilityKinds';
import { buildCapabilityOperationEnvelope } from '@shared/authorization/operationFingerprint';
import { buildEvmEcdsaMpcOperationRef } from '@shared/authorization/capabilityKinds';
import {
  sameRuntimePolicyScope,
  type RuntimePolicyScope,
} from '@shared/threshold/signingRootScope';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { type AuthorizedOperation } from '../../../../authorization/domain';
import { verifyEcdsaOperationStepUpFactor } from './ecdsaOperationStepUpFactor';

import { parseWalletId } from '@shared/utils/domainIds';
import {
  proxyNormalSigningRequestToMpcRouter,
  proxyOwnerLaneAdmittedNormalSigningRequest,
} from './normalSigningRouterProxy';
import {
  sameRouterAbMpcMaterialActivationRef,
  routerAbMpcMaterialActivationRefToWire,
  type RouterAbMpcMaterialActivationRefWire,
} from '@shared/utils/routerAbNormalSigningIdentity';

async function verifyActiveEcdsaOperationStepUpAuthority(
  walletAuthMethods: RouterApiWalletAuthMethodService,
  proof: RouterAbEcdsaOperationStepUpAuthorizationRequestV1Wire['proof'],
) {
  switch (proof.kind) {
    case 'passkey':
      return await walletAuthMethods.verifyActivePasskeyAuthority(proof.authority);
    case 'email_otp':
      return await walletAuthMethods.verifyActiveEmailOtpAuthority(proof.authority);
    case 'voiceid':
      /* The device proof check resolves the exact active VoiceID method and its key. */
      return { ok: true } as const;
    default:
      proof satisfies never;
      throw new Error('Unsupported ECDSA operation step-up proof');
  }
}
const NOT_IMPLEMENTED = {
  ok: false,
  code: 'not_implemented',
  message: 'threshold-ecdsa is not implemented',
} as const;

type RouterAbEcdsaAuthorizedOperationWire = {
  readonly binding: AuthorizedOperationBindingWire;
  readonly authorized_operation:
    | {
        readonly kind: 'reusable_wallet_session_authorized_operation_v1';
        readonly authorized_operation_id: string;
        readonly operation_id: string;
        readonly capability_kind: 'evm_ecdsa_mpc_signing';
        readonly operation_kind: 'evm.sign_transaction';
        readonly lane_digest_b64u: string;
        readonly intent_digest_b64u: string;
        readonly display_digest_b64u: string;
        readonly operation_fingerprint_digest: string;
      }
    | {
        readonly kind: 'verified_step_up_authorized_operation_v1';
        readonly authorization_session_id: string;
        readonly evidence_set_digest: string;
        readonly authorized_operation_id: string;
        readonly operation_id: string;
        readonly capability_kind: 'evm_ecdsa_mpc_signing';
        readonly operation_kind: 'evm.sign_transaction';
        readonly lane_digest_b64u: string;
        readonly intent_digest_b64u: string;
        readonly display_digest_b64u: string;
        readonly operation_fingerprint_digest: string;
      };
};

async function ecdsaOperationStepUpBinding(
  ctx: FetchRouterApiContext,
  session: {
    readonly sessionId: string;
    readonly principalId: string;
    readonly walletId: string;
    readonly runtimePolicyScope: RuntimePolicyScope;
  },
  operation: AuthorizedOperation,
): Promise<OperationStepUpBinding> {
  return operationStepUpBinding(
    session,
    await readPinnedEcdsaStepUpWalletScope(ctx, session, operation),
  );
}

function buildRouterAbEcdsaAuthorizedOperationWire(
  input: AuthorizedOperationWireInput,
): RouterAbEcdsaAuthorizedOperationWire {
  const operation = input.operation;
  const operationRef = operation.operation.operation;
  if (
    operationRef.capabilityKind !== 'evm_ecdsa_mpc_signing' ||
    operationRef.operationKind !== 'evm.sign_transaction'
  ) {
    throw new Error('ECDSA authorized operation capability or operation kind is invalid');
  }
  return buildAuthorizedOperationWire(input, {
    capability_kind: 'evm_ecdsa_mpc_signing',
    operation_kind: 'evm.sign_transaction',
  });
}

type RouterAbEcdsaOperationStepUpExecutionDecision =
  | { readonly kind: 'execute'; readonly operation: AuthorizedOperation }
  | { readonly kind: 'replay'; readonly operation: AuthorizedOperation }
  | { readonly kind: 'missing' };

function decideRouterAbEcdsaOperationStepUpExecution(input: {
  readonly phase: 'prepare' | 'finalize';
  readonly admissionKind: RouterAbEcdsaOperationAdmissionKind;
  readonly operation: AuthorizedOperation;
}): RouterAbEcdsaOperationStepUpExecutionDecision {
  if (input.admissionKind === 'replayed') {
    return { kind: 'replay', operation: input.operation };
  }
  if (input.admissionKind === 'claimed' && input.phase === 'finalize') {
    return { kind: 'missing' };
  }
  return { kind: 'execute', operation: input.operation };
}

async function handleRouterAbEcdsaDerivationNormalSigningRoute(input: {
  ctx: FetchRouterApiContext;
  body: Record<string, unknown>;
  phase: 'prepare' | 'finalize';
}): Promise<Response> {
  const timing = emptySigningGatewayTiming();
  return await withServerTiming('ecdsa_sign_', timing, () =>
    executeRouterAbEcdsaDerivationNormalSigningRoute(input, timing),
  );
}

async function executeRouterAbEcdsaDerivationNormalSigningRoute(
  input: {
    ctx: FetchRouterApiContext;
    body: Record<string, unknown>;
    phase: 'prepare' | 'finalize';
  },
  timing: SigningGatewayTiming,
): Promise<Response> {
  const { presign_source: rawSource, ...signingBody } = input.body;
  if (input.phase === 'finalize' && rawSource !== undefined) {
    return jsonFailure(400, 'invalid_body', 'Finalize cannot carry a presign source');
  }
  if (input.phase === 'prepare') {
    try {
      parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(signingBody);
      parseRouterAbEcdsaPrepareSourceV1(rawSource);
    } catch {
      return jsonFailure(400, 'invalid_body', 'Invalid signing prepare request or source');
    }
  }
  input = { ctx: input.ctx, body: signingBody, phase: input.phase };
  const authorizationStartedAt = performance.now();
  const authorization = await authorizeRouterAbEcdsaDerivationNormalSigningRoute({
    ...normalSigningAuthorizationRequest(input),
    resolveEcdsaMaterialActivation:
      input.ctx.service.walletRegistration.resolveEcdsaMaterialActivation.bind(
        input.ctx.service.walletRegistration,
      ),
  });
  timing.authorize = performance.now() - authorizationStartedAt;
  if (!authorization.ok) {
    return json(authorization.result.body, { status: authorization.result.status });
  }
  const admissionStartedAt = performance.now();
  let authorizedOperation: AuthorizedOperation;
  let authorizedOperationWire: RouterAbEcdsaAuthorizedOperationWire;
  if (authorization.kind === 'operation_step_up') {
    const decision = decideRouterAbEcdsaOperationStepUpExecution({
      phase: input.phase,
      admissionKind: authorization.admissionKind,
      operation: authorization.operation,
    });
    if (decision.kind === 'replay') {
      return routerAbEcdsaReplayResponse(decision.operation);
    }
    if (decision.kind === 'missing') {
      return jsonFailure(
        409,
        'authorized_operation_missing',
        'ECDSA finalize requires a claimed prepare operation',
      );
    }
    authorizedOperation = decision.operation;
    authorizedOperationWire = buildRouterAbEcdsaAuthorizedOperationWire({
      operation: authorizedOperation,
      binding: await ecdsaOperationStepUpBinding(
        input.ctx,
        authorization.session,
        authorizedOperation,
      ),
    });
  } else {
    const request =
      input.phase === 'prepare'
        ? parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(input.body)
        : parseRouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1(input.body);
    const operation = await admitRouterAbEcdsaReusableWalletSessionOperation({
      phase: input.phase,
      request,
      material: authorization.activeMaterial,
      binding: authorization,
      authorizedOperations: input.ctx.service.authorizedOperations,
    });
    if (!operation.ok) {
      const failureBody = operation.error.body;
      const failureCode =
        typeof failureBody === 'object' &&
        failureBody !== null &&
        'code' in failureBody &&
        typeof failureBody.code === 'string'
          ? failureBody.code
          : 'authorization_unavailable';
      const failureMessage =
        typeof failureBody === 'object' &&
        failureBody !== null &&
        'message' in failureBody &&
        typeof failureBody.message === 'string'
          ? failureBody.message
          : 'ECDSA operation authorization is unavailable';
      const stepUp =
        input.phase === 'prepare'
          ? (buildRouterAbEcdsaOwnerOperationStepUpPreparation({
              request: parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(input.body),
              keyHandle: authorization.activeMaterial.keyHandle,
              relayerKeyId: authorization.activeMaterial.relayerKeyId,
              participantIds: [...authorization.activeMaterial.participantIds],
            }) ?? undefined)
          : undefined;
      const decision = routerAbEcdsaOwnerOperationFailureResult({
        status: operation.error.status,
        code: failureCode,
        message: failureMessage,
        phase: input.phase,
        stepUp,
      });
      return json(decision.body, { status: decision.status });
    }
    if (operation.admission.kind === 'operation_in_progress' && input.phase === 'prepare') {
      const failure = routerAbEcdsaOperationInProgressResult();
      return json(failure.body, { status: failure.status });
    }
    if (operation.admission.kind === 'replayed') {
      return routerAbEcdsaReplayResponse(operation.admission.operation);
    }
    const ownerDecision = decideRouterAbEcdsaOwnerOperationAuthorization({
      operation: operation.admission.operation,
    });
    if (ownerDecision.kind !== 'authorized') {
      return ownerOperationNotAuthorizedResponse(
        ownerDecision,
        'ECDSA operation step-up was not admitted',
      );
    }
    authorizedOperation = operation.admission.operation;
    const runtimePolicyScope = authorization.activeMaterial.runtimePolicyScope;
    const pinnedOwnerScope = operation.admission.ownerScope;
    if (
      pinnedOwnerScope.orgId !== runtimePolicyScope.orgId ||
      pinnedOwnerScope.projectId !== runtimePolicyScope.projectId
    ) {
      throw new Error('Pinned ECDSA owner Wallet Session scope differs from active material');
    }
    authorizedOperationWire = buildRouterAbEcdsaAuthorizedOperationWire({
      operation: authorizedOperation,
      binding: gatewayOwnerWalletSessionBinding({
        session: reusableWalletSession(authorization),
        pinned: pinnedOwnerScope,
        runtimePolicyScope,
        thresholdSessionId: authorization.admission.thresholdSessionId,
        signingWorkerId: authorization.activeMaterial.materialActivation.signing_worker,
      }),
    });
  }
  timing.admit = performance.now() - admissionStartedAt;
  const signingRequest =
    input.phase === 'prepare'
      ? parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(input.body)
      : parseRouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1(input.body);
  const signingWalletId = parseWalletId(signingRequest.scope.wallet_id);
  if (!signingWalletId.ok) {
    return jsonFailure(400, 'invalid_body', 'ECDSA signing wallet is invalid');
  }
  const laneAuthorization =
    authorization.kind === 'operation_step_up'
      ? authorization.session.laneAuthorization
      : {
          kind: 'wallet_auth_method' as const,
          walletAuthMethodId: reusableWalletSession(authorization).walletAuthMethodId,
        };
  const admittedBody = {
    ...input.body,
    authorized_operation: authorizedOperationWire,
  };
  const proxyStartedAt = performance.now();
  const upstream =
    authorization.kind === 'wallet_session_operation_credential_v1' ||
    authorization.kind === 'wallet_session_operation_credential_exhausted_candidate_v1'
      ? await proxyNormalSigningRequestToMpcRouter({
          request: input.ctx.request,
          proxy: input.ctx.opts.routerAbNormalSigningRouterProxy,
          body: admittedBody,
        })
      : await proxyOwnerLaneAdmittedNormalSigningRequest({
          request: input.ctx.request,
          proxy: input.ctx.opts.routerAbNormalSigningRouterProxy,
          authorizedOperation,
          walletId: signingWalletId.value,
          expectedMaterialActivation: signingRequest.material_activation,
          authorization: laneAuthorization,
          walletRegistration: input.ctx.service.walletRegistration,
          body: admittedBody,
        });
  if (input.phase === 'prepare' && upstream.ok) {
    const body = signingPrepareSessionResponse(await upstream.json(), authorization);
    timing.proxy = performance.now() - proxyStartedAt;
    const headers = new Headers(upstream.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(body), { status: upstream.status, headers });
  }
  return finishRouterAbEcdsaSigningResponse({
    upstream,
    operation: authorizedOperation,
    authorizedOperations: input.ctx.service.authorizedOperations,
    timing,
    proxyStartedAt,
  });
}

function routerAbEcdsaReplayResponse(operation: AuthorizedOperation): Response {
  const response = routerAbEcdsaReplayHttpResponse(operation);
  if (response) return response;
  const failure = routerAbEcdsaReplayUnavailableResult();
  return json(failure.body, { status: failure.status });
}

type RouterAbEcdsaResolvedMaterialActivation = Omit<
  Extract<
    Awaited<ReturnType<RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation']>>,
    { readonly ok: true }
  >,
  'routerAbEcdsaDerivationNormalSigning' | 'readSnapshot'
> & {
  /** The database read that found the material; the V2 custody resolution has none. */
  readonly readSnapshot?: EcdsaMaterialReadSnapshot;
};

type RouterAbEcdsaV2OperationStepUpResolution =
  | { readonly kind: 'not_found' }
  | {
      readonly kind: 'admitted';
      readonly operationKind: 'evm.sign_transaction';
      readonly context: WalletSessionExactOperationContext;
      readonly activeMaterial: RouterAbEcdsaResolvedMaterialActivation;
      readonly exportTopology?: never;
    }
  | {
      readonly kind: 'admitted';
      readonly operationKind: 'evm.export_key';
      readonly context: WalletSessionExactOperationContext;
      readonly activeMaterial: RouterAbEcdsaResolvedMaterialActivation;
      readonly exportTopology: RouterAbEcdsaOperationStepUpExportTopologyV1Wire;
    }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'unavailable' };

async function resolveV2EcdsaOperationStepUpAdmission(input: {
  readonly ctx: FetchRouterApiContext;
  readonly operation: RouterAbEcdsaOperationStepUpPreparationV1Wire;
}): Promise<RouterAbEcdsaV2OperationStepUpResolution> {
  const token = extractBearerCredential(input.ctx.request.headers);
  if (!token) return { kind: 'not_found' };
  let context: WalletSessionExactOperationContext | null;
  try {
    context =
      await input.ctx.service.authorizationSessions.readWalletSessionExactOperationContextByCredential({
        tenantId: input.ctx.service.authorizationSessions.tenantId,
        token,
        nowMs: Date.now(),
      });
  } catch {
    return { kind: 'unavailable' };
  }
  if (!context) {
    return { kind: 'rejected', message: 'ECDSA operation step-up Wallet Session is unavailable' };
  }
  const session = context.session;
  const admission = resolveWalletSessionAuthorizationV2Admission({
    authorization: session,
    authority: context.authority,
    authMethod: context.authMethod,
    retiredAtMs: context.retiredAtMs,
    nowMs: Date.now(),
    operation: {
      tenantId: session.tenantId,
      principalId: session.principalId,
      walletId: session.walletId,
      keyFamily: 'ecdsa_secp256k1',
      operationKind: input.operation.operation_kind,
    },
  });
  if (!admission.ok || admission.keyFamily !== 'ecdsa_secp256k1') {
    return {
      kind: 'rejected',
      message: 'ECDSA operation step-up Wallet Session authorization is invalid',
    };
  }
  const admittedSigner = admission.signer;
  if (
    input.operation.wallet_id !== String(session.walletId) ||
    input.operation.material_activation.material_owner !== String(session.walletId) ||
    input.operation.expires_at_ms > session.expiresAtMs ||
    input.operation.expires_at_ms <= Date.now()
  ) {
    return {
      kind: 'rejected',
      message: 'ECDSA operation step-up Wallet Session scope is invalid',
    };
  }
  const continuity = await input.ctx.service.walletRegistration.listWalletEcdsaCustodyContinuity({
    walletId: String(session.walletId),
  });
  const signer = resolveV2EcdsaCustodySigner({
    continuity,
    walletId: String(session.walletId),
    admittedThresholdPublicKey33B64u: admittedSigner.thresholdPublicKey33B64u,
    admittedEvmAddress: admittedSigner.evmAddress,
    operation: input.operation,
  });
  if (!signer) {
    return {
      kind: 'rejected',
      message: 'ECDSA operation step-up material is not uniquely active',
    };
  }
  if (
    input.operation.signing_worker_id !==
      input.operation.normal_signing_scope.signing_worker.server_id ||
    !sameRouterAbMpcMaterialActivationRef(
      input.operation.material_activation,
      input.operation.normal_signing_scope.material_activation,
    ) ||
    !sameRouterAbMpcMaterialActivationRef(
      input.operation.material_activation,
      routerAbMpcMaterialActivationRefToWire(admission.materialActivation),
    )
  ) {
    return {
      kind: 'rejected',
      message: 'ECDSA operation step-up material activation is invalid',
    };
  }
  const activeMaterial: RouterAbEcdsaResolvedMaterialActivation = {
    ok: true,
    materialActivation: routerAbMpcMaterialActivationRefToWire(
      admission.materialActivation,
    ),
    keyHandle: signer.walletKey.keyHandle,
    relayerKeyId: signer.walletKey.relayerKeyId,
    participantIds: signer.walletKey.participantIds,
    runtimePolicyScope: signer.runtimePolicyScope,
  };
  if (input.operation.operation_kind === 'evm.sign_transaction') {
    return {
      kind: 'admitted',
      operationKind: 'evm.sign_transaction',
      context,
      activeMaterial,
    };
  }
  return {
    kind: 'admitted',
    operationKind: 'evm.export_key',
    context,
    activeMaterial,
    exportTopology: {
      signer_set: signer.walletKey.publicCapability.signer_set,
      deriver_recipient_keys: signer.walletKey.publicCapability.deriver_recipient_keys,
      router_id: signer.walletKey.publicCapability.router_id,
    },
  };
}

async function issueEcdsaOperationStepUpAuthorization(input: {
  readonly ctx: FetchRouterApiContext;
  readonly request: RouterAbEcdsaOperationStepUpAuthorizationRequestV1Wire;
}): Promise<Response> {
  if (!routerAbEcdsaAtomicAuthorizationConfigured(input.ctx.service.authorizedOperations)) {
    return jsonFailure(501, 'not_configured', 'ECDSA atomic authorization is not configured');
  }
  const operation = input.request.operation;
  if (
    operation.normal_signing_scope.wallet_id !== operation.wallet_id ||
    operation.normal_signing_scope.signing_worker.server_id !== operation.signing_worker_id ||
    operation.material_activation.material_owner !== operation.wallet_id ||
    operation.material_activation.signing_worker !== operation.signing_worker_id ||
    operation.expires_at_ms <= Date.now()
  ) {
    return jsonFailure(403, 'scope_mismatch', 'ECDSA operation step-up scope is invalid');
  }
  const v2Resolution = await resolveV2EcdsaOperationStepUpAdmission({
    ctx: input.ctx,
    operation,
  });
  if (v2Resolution.kind === 'unavailable') {
    return jsonFailure(
      503,
      'wallet_session_unavailable',
      'Wallet Session authorization is unavailable',
    );
  }
  if (v2Resolution.kind === 'rejected') {
    return jsonFailure(403, 'scope_mismatch', v2Resolution.message);
  }
  const activeMaterial =
    v2Resolution.kind === 'admitted'
      ? v2Resolution.activeMaterial
      : await input.ctx.service.walletRegistration.resolveEcdsaMaterialActivation({
          source: { kind: 'database' },
          walletId: operation.wallet_id,
          materialActivation: operation.material_activation,
        });
  if (!activeMaterial.ok) {
    return jsonFailure(
      activeMaterial.code === 'internal' ? 500 : 403,
      activeMaterial.code,
      activeMaterial.message,
    );
  }
  if (
    !ecdsaMaterialNamesOperationKey(activeMaterial, operation) ||
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      operation.normal_signing_scope.material_activation,
    )
  ) {
    return jsonFailure(
      403,
      'scope_mismatch',
      'ECDSA normal-signing scope does not name the active material',
    );
  }
  const proof = input.request.proof;
  const authority = proof.authority;
  const activeAuthority = await verifyActiveEcdsaOperationStepUpAuthority(
    input.ctx.service.walletAuthMethods,
    proof,
  );
  if (!activeAuthority.ok) {
    return jsonFailure(403, 'scope_mismatch', 'Operation step-up authority is not active');
  }
  let v2AuthorityRef: WalletAuthAuthorityRef | undefined;
  if (v2Resolution.kind === 'admitted') {
    v2AuthorityRef = await walletAuthAuthorityRef({ authority });
    const session = v2Resolution.context.session;
    const context = v2Resolution.context;
    if (
      authority.walletId !== String(session.walletId) ||
      authority.bindingId !== context.authMethod.walletAuthMethodId ||
      context.authMethod.walletAuthorityId !== context.authority.authorityId
    ) {
      return jsonFailure(
        403,
        'scope_mismatch',
        'Operation step-up authority does not match the Wallet Session authority',
      );
    }
  }
  const proofAuthenticated = await authenticateRouterAbWalletOperationStepUpIdentity({
    kind: 'verified_owner_proof',
    headers: Object.fromEntries(input.ctx.request.headers.entries()),
    walletId: operation.wallet_id,
    materialOwner: operation.material_activation.material_owner,
    operationId: operation.operation_id,
    authority,
    runtimePolicyScope: activeMaterial.runtimePolicyScope,
    expiresAtMs: operation.expires_at_ms,
    authorizedOperations: input.ctx.service.authorizedOperations,
  });
  if (!proofAuthenticated.ok) {
    return json(proofAuthenticated.error.body, { status: proofAuthenticated.error.status });
  }
  if (authority.walletId !== proofAuthenticated.session.walletId) {
    return jsonFailure(403, 'scope_mismatch', 'Operation step-up authority changed');
  }
  const authenticated =
    v2Resolution.kind === 'admitted' && v2AuthorityRef
      ? {
          ok: true as const,
          authorizedOperations: proofAuthenticated.authorizedOperations,
          session: {
            tenantId: v2Resolution.context.session.tenantId,
            principalId: v2Resolution.context.session.principalId,
            sessionId: String(v2Resolution.context.session.authorizationId),
            walletId: String(v2Resolution.context.session.walletId),
            runtimePolicyScope: activeMaterial.runtimePolicyScope,
            laneAuthorization: {
              kind: 'authority_ref' as const,
              authorityRef: v2AuthorityRef,
              authSource: proofAuthenticated.session.laneAuthorization.authSource,
            },
          },
          authorityRef: v2AuthorityRef,
          requestOrigin: proofAuthenticated.requestOrigin,
          expiresAtMs: operation.expires_at_ms,
        }
      : proofAuthenticated;
  let envelope: ReturnType<typeof buildCapabilityOperationEnvelope>;
  try {
    envelope = buildCapabilityOperationEnvelope({
      tenantId: authenticated.session.tenantId,
      principalId: authenticated.session.principalId,
      capabilityId: requireAuthorizationValue(
        parseCapabilityId(activeMaterial.materialActivation.capability),
      ),
      operationId: requireAuthorizationValue(parseCapabilityOperationId(operation.operation_id)),
      operation: buildEvmEcdsaMpcOperationRef(operation.operation_kind),
      digests: {
        laneDigest: parseDigestB64u(operation.operation_digests.lane_digest_b64u),
        intentDigest: parseDigestB64u(operation.operation_digests.intent_digest_b64u),
        displayDigest: parseDigestB64u(operation.operation_digests.display_digest_b64u),
      },
    });
  } catch (error: unknown) {
    return jsonFailure(
      400,
      'invalid_body',
      error instanceof Error ? error.message : 'Operation fingerprint is invalid',
    );
  }
  const expectedChallenge = await computeRouterAbEcdsaOperationStepUpChallengeB64u(operation);
  const requestId = operation.operation_id;
  let freshMaterial: RouterAbEcdsaResolvedMaterialActivation;
  if (v2Resolution.kind === 'admitted') {
    const refreshedV2Resolution = await resolveV2EcdsaOperationStepUpAdmission({
      ctx: input.ctx,
      operation,
    });
    if (refreshedV2Resolution.kind === 'unavailable') {
      return jsonFailure(
        503,
        'wallet_session_unavailable',
        'Wallet Session authorization is unavailable',
      );
    }
    if (
      refreshedV2Resolution.kind !== 'admitted' ||
      !walletSessionAuthorizationV2RecordsEqual(
        v2Resolution.context.session,
        refreshedV2Resolution.context.session,
      )
    ) {
      return jsonFailure(
        403,
        'scope_mismatch',
        'ECDSA operation step-up Wallet Session authorization changed',
      );
    }
    freshMaterial = refreshedV2Resolution.activeMaterial;
  } else {
    const resolvedRegistrationMaterial = await resolveFreshRouterAbEcdsaMaterialActivation({
      resolveEcdsaMaterialActivation:
        input.ctx.service.walletRegistration.resolveEcdsaMaterialActivation.bind(
          input.ctx.service.walletRegistration,
        ),
      walletId: authenticated.session.walletId,
      expected: operation.material_activation,
    });
    if (!resolvedRegistrationMaterial.ok) {
      return jsonFailure(
        resolvedRegistrationMaterial.code === 'internal' ? 500 : 403,
        resolvedRegistrationMaterial.code === 'internal' ? 'internal' : 'scope_mismatch',
        resolvedRegistrationMaterial.message,
      );
    }
    freshMaterial = resolvedRegistrationMaterial;
  }
  if (
    !ecdsaMaterialNamesOperationKey(freshMaterial, operation) ||
    !sameRouterAbMpcMaterialActivationRef(
      freshMaterial.materialActivation,
      operation.normal_signing_scope.material_activation,
    )
  ) {
    return jsonFailure(
      403,
      'scope_mismatch',
      'ECDSA operation step-up material changed before evidence admission',
    );
  }
  const evidenceId = requireAuthorizationValue(
    parseAuthorizationEvidenceId(`ecdsa-step-up-evidence:${requestId}`),
  );
  const evidenceSetId = requireAuthorizationValue(
    parseAuthorizationEvidenceSetId(`ecdsa-step-up-evidence-set:${requestId}`),
  );
  const expiresAtMs = operation.expires_at_ms;
  const requestOrigin = authenticated.requestOrigin;
  const verifiedFactor = await verifyEcdsaOperationStepUpFactor({
    proof,
    operation: envelope,
    walletId: walletIdFromString(authenticated.session.walletId),
    authorityRef: authenticated.authorityRef,
    authSource: authenticated.session.laneAuthorization.authSource,
    requestOrigin,
    expectedChallenge,
    expiresAtMs,
    webAuthn: input.ctx.service.webAuthn,
    emailOtp: input.ctx.service.emailOtp,
    voiceId: input.ctx.service.walletUnlock,
  });
  if (!verifiedFactor.ok) return verifiedFactor.response;
  const recordedEvidence =
    await input.ctx.service.authorizedOperations.recordVerifiedWalletOperationFactorEvidenceSet({
      operation: envelope,
      evidenceId,
      evidenceSetId,
      factor: verifiedFactor.factor,
    });
  if (recordedEvidence.kind === 'evidence_conflict') {
    return jsonFailure(
      409,
      'step_up_evidence_conflict',
      'This request already holds other step-up evidence; start a new request',
    );
  }
  const evidenceSet = recordedEvidence.evidenceSet;
  const authorizedOperationId = requireAuthorizationValue(
    parseAuthorizedOperationId(`ecdsa-step-up-authorized-operation:${operation.operation_id}`),
  );
  const atomicOperation = await input.ctx.service.authorizedOperations.admitAuthorizedOperation({
    operation: {
      tenantId: authenticated.session.tenantId,
      authorizedOperationId,
      auditEventId: requireAuthorizationValue(
        parseAuthorizationAuditEventId(`ecdsa-operation-audit:${operation.operation_id}`),
      ),
      operation: envelope,
      authorization: {
        kind: 'verified_step_up',
        evidenceSetDigest: evidenceSet.evidenceSetDigest,
      },
      quota: { kind: 'quota_neutral' },
      claimedAtMs: Date.now(),
    },
    material: {
      walletId: walletIdFromString(authenticated.session.walletId),
      keyHandle: freshMaterial.keyHandle,
      runtimePolicyScope: authenticated.session.runtimePolicyScope,
      materialActivation: freshMaterial.materialActivation,
      readSnapshot: freshMaterial.readSnapshot,
    },
  });
  if (atomicOperation.kind === 'material_mismatch') {
    return jsonFailure(
      403,
      'scope_mismatch',
      'ECDSA material activation changed before authorized-operation admission',
    );
  }
  const admissionRefusal = operationStepUpAdmissionRefusal(atomicOperation.kind, 'ECDSA');
  if (admissionRefusal) return admissionRefusal;
  const responseAuthorization = {
    kind: 'operation_step_up' as const,
    evidence_set_digest: evidenceSet.evidenceSetDigest,
    unseal: verifiedFactor.unseal,
  };
  if (operation.operation_kind === 'evm.export_key') {
    const exportTopology =
      v2Resolution.kind === 'admitted' && v2Resolution.operationKind === 'evm.export_key'
        ? v2Resolution.exportTopology
        : await resolveStrictEcdsaExportTopology({
            ctx: input.ctx,
            operation,
          });
    if (!exportTopology) {
      return jsonFailure(403, 'scope_mismatch', 'ECDSA export topology is not uniquely active');
    }
    return json(
      {
        ok: true,
        kind: 'verified_step_up',
        operation_kind: 'evm.export_key',
        export_topology: exportTopology,
        authorization: responseAuthorization,
        expires_at_ms: expiresAtMs,
      },
      { status: 200 },
    );
  }
  return json(
    {
      ok: true,
      kind: 'verified_step_up',
      operation_kind: 'evm.sign_transaction',
      authorization: responseAuthorization,
      expires_at_ms: expiresAtMs,
    },
    { status: 200 },
  );
}

type StrictEcdsaPostRegistrationRequest =
  | {
      readonly kind: 'export';
      readonly request: RouterAbEcdsaDerivationExplicitExportRequestV1;
      readonly requestDigestB64u: string;
    }
  | {
      readonly kind: 'refresh';
      readonly command: RouterAbEcdsaDerivationActivationRefreshCommitRequestV1;
      readonly request: RouterAbEcdsaDerivationActivationRefreshRequestV1;
      readonly requestDigestB64u: string;
    };

type StrictEcdsaOperationCredentialAdmission = Extract<
  WalletSessionOperationCredentialAdmission,
  { readonly curve: 'ecdsa' }
>;

type StrictEcdsaPostRegistrationAuthorization =
  | {
      readonly ok: true;
      readonly kind: 'verified_operation';
      readonly operationKind: 'evm.export_key';
      readonly authority: RouterAbEcdsaStrictRegistrationAuthority;
    }
  | {
      readonly ok: true;
      readonly kind: 'wallet_session_operation_credential_v2';
      readonly operationKind: 'evm.sign_transaction';
      readonly authority: RouterAbEcdsaStrictRegistrationAuthority;
      readonly v2Admission: StrictEcdsaOperationCredentialAdmission;
    }
  | {
      readonly ok: true;
      readonly kind: 'wallet_session_operation_step_up_v2';
      readonly operationKind: 'evm.export_key';
      readonly authority: RouterAbEcdsaStrictRegistrationAuthority;
      readonly v2Admission: StrictEcdsaOperationCredentialAdmission;
    }
  | {
      readonly ok: false;
      readonly code: 'unauthorized' | 'identity_mismatch';
      readonly message: string;
    }
  | WalletSessionBoundaryFailure;

function strictEcdsaAuthorizationFailureStatus(
  failure: Extract<StrictEcdsaPostRegistrationAuthorization, { readonly ok: false }>,
): number {
  switch (failure.code) {
    case 'unauthorized':
      return 401;
    case 'identity_mismatch':
      return 403;
    default:
      return walletSessionFailureStatus(failure.code);
  }
}

async function resolveStrictEcdsaAuthorizationSession(input: {
  readonly ctx: FetchRouterApiContext;
  readonly operationKind: 'evm.sign_transaction' | 'evm.export_key';
}): Promise<StrictEcdsaOperationCredentialAdmission | WalletSessionBoundaryFailure> {
  const token = extractBearerCredential(input.ctx.request.headers);
  if (!token) return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.missing);
  try {
    const resolution = await resolveWalletSessionOperationCredentialAdmission({
      authorizationSessions: input.ctx.service.authorizationSessions,
      token,
      nowMs: Date.now(),
      operation: { keyFamily: 'ecdsa_secp256k1', operationKind: input.operationKind },
    });
    switch (resolution.kind) {
      case 'not_found':
        return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.invalid);
      case 'rejected':
        return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.scopeMismatch);
      case 'admitted':
        if (resolution.admission.curve !== 'ecdsa') {
          return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.scopeMismatch);
        }
        return resolution.admission;
    }
  } catch {
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.unavailable);
  }
}

/**
 * Every post-registration call carries `{request, requestDigestB64u}`.
 *
 * The digest is not trusted here — Router recomputes it from the forwarded
 * request — but the Gateway must sign a request policy over it, so the caller
 * has to state which request the policy covers.
 */
function parseStrictEcdsaRequestDigestEnvelope(
  body: unknown,
  label: string,
): { readonly request: unknown; readonly requestDigestB64u: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`Strict ECDSA ${label} body must be an object`);
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'request' || keys[1] !== 'requestDigestB64u') {
    throw new Error(`Strict ECDSA ${label} body fields are invalid`);
  }
  const requestDigestB64u = String(record.requestDigestB64u || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(requestDigestB64u)) {
    throw new Error(`Strict ECDSA ${label} request digest must contain 32 base64url bytes`);
  }
  return { request: record.request, requestDigestB64u };
}

function parseStrictEcdsaPostRegistrationRequest(
  pathname: string,
  body: unknown,
): StrictEcdsaPostRegistrationRequest {
  switch (pathname) {
    case ROUTER_AB_ECDSA_DERIVATION_EXPORT_PATH: {
      const envelope = parseStrictEcdsaRequestDigestEnvelope(body, 'export');
      return {
        kind: 'export',
        request: parseRouterAbEcdsaDerivationExplicitExportRequestV1(envelope.request),
        requestDigestB64u: envelope.requestDigestB64u,
      };
    }
    case ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH: {
      const envelope = parseStrictEcdsaRequestDigestEnvelope(body, 'refresh');
      const command = parseRouterAbEcdsaDerivationActivationRefreshCommitRequestV1(
        envelope.request,
      );
      return {
        kind: 'refresh',
        command,
        request: command.refresh_request,
        requestDigestB64u: envelope.requestDigestB64u,
      };
    }
    default:
      throw new Error('Strict ECDSA post-registration path is invalid');
  }
}

function strictEcdsaPostRegistrationRequestAuthority(
  input: StrictEcdsaPostRegistrationRequest,
): RouterAbEcdsaStrictRegistrationAuthority {
  return {
    subjectId: input.request.client_id,
    sessionId: input.request.lifecycle.session_id,
    accountId: input.request.lifecycle.account_id,
    expiresAtMs: input.request.expires_at_ms,
  };
}

type StrictEcdsaRequestExpiryValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'unauthorized' }
  | { readonly ok: false; readonly code: typeof WALLET_SESSION_FAILURE_CODES.scopeMismatch };

function validateStrictEcdsaPostRegistrationRequestExpiry(input: {
  readonly requestExpiresAtMs: number;
  readonly sessionExpiresAtMs: number;
}): StrictEcdsaRequestExpiryValidation {
  const nowMs = Date.now();
  if (input.requestExpiresAtMs <= nowMs || input.requestExpiresAtMs > nowMs + 10 * 60_000) {
    return { ok: false, code: 'unauthorized' };
  }
  if (input.requestExpiresAtMs > input.sessionExpiresAtMs) {
    return { ok: false, code: WALLET_SESSION_FAILURE_CODES.scopeMismatch };
  }
  return { ok: true };
}

async function authorizeStrictEcdsaPostRegistrationRequest(input: {
  readonly ctx: FetchRouterApiContext;
  readonly request: StrictEcdsaPostRegistrationRequest;
}): Promise<StrictEcdsaPostRegistrationAuthorization> {
  const authority = strictEcdsaPostRegistrationRequestAuthority(input.request);
  if (
    input.request.request.signer_set.signer_set_id !==
      input.request.request.lifecycle.signer_set_id ||
    input.request.request.signer_set.selected_server.server_id !==
      input.request.request.lifecycle.selected_server_id
  ) {
    return {
      ok: false,
      code: 'identity_mismatch',
      message: 'Strict ECDSA request identity does not match its lifecycle',
    };
  }
  const isOperationStepUpExport =
    input.request.kind === 'export' &&
    input.request.request.authorization.kind === 'operation_step_up';
  if (isOperationStepUpExport && !extractBearerCredential(input.ctx.request.headers)) {
    return {
      ok: true,
      kind: 'verified_operation',
      operationKind: 'evm.export_key',
      authority,
    };
  }
  const parsedSession = await resolveStrictEcdsaAuthorizationSession({
    ctx: input.ctx,
    operationKind: input.request.kind === 'export' ? 'evm.export_key' : 'evm.sign_transaction',
  });
  if ('ok' in parsedSession) {
    return parsedSession;
  }
  const session = parsedSession.context.authorization.session;
  if (
    authority.subjectId !== String(session.walletId) ||
    authority.accountId !== String(session.walletId) ||
    !sameRouterAbMpcMaterialActivationRef(
      input.request.request.material_activation,
      routerAbMpcMaterialActivationRefToWire(parsedSession.admission.materialActivation),
    )
  ) {
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.scopeMismatch);
  }
  let activeMaterial: Awaited<ReturnType<typeof resolveFreshRouterAbEcdsaMaterialActivation>>;
  try {
    activeMaterial = await resolveFreshRouterAbEcdsaMaterialActivation({
      resolveEcdsaMaterialActivation:
        input.ctx.service.walletRegistration.resolveEcdsaMaterialActivation.bind(
          input.ctx.service.walletRegistration,
        ),
      walletId: String(session.walletId),
      expected: input.request.request.material_activation,
    });
  } catch {
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.unavailable);
  }
  if (
    !activeMaterial.ok ||
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      routerAbMpcMaterialActivationRefToWire(parsedSession.admission.materialActivation),
    )
  ) {
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.scopeMismatch);
  }
  const expiry = validateStrictEcdsaPostRegistrationRequestExpiry({
    requestExpiresAtMs: authority.expiresAtMs,
    sessionExpiresAtMs: session.expiresAtMs,
  });
  if (!expiry.ok && expiry.code === WALLET_SESSION_FAILURE_CODES.scopeMismatch) {
    return walletSessionFailure(expiry.code);
  }
  if (!expiry.ok) {
    return {
      ok: false,
      code: 'unauthorized',
      message: 'Strict ECDSA request expiry is invalid',
    };
  }
  if (input.request.kind === 'export' && !isOperationStepUpExport) {
    // Export requires a separately authenticated operation step-up.
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.scopeMismatch);
  }
  if (input.request.kind === 'export') {
    return {
      ok: true,
      kind: 'wallet_session_operation_step_up_v2',
      operationKind: 'evm.export_key',
      authority,
      v2Admission: parsedSession,
    };
  }
  return {
    ok: true,
    kind: 'wallet_session_operation_credential_v2',
    operationKind: 'evm.sign_transaction',
    authority,
    v2Admission: parsedSession,
  };
}

async function handleStrictEcdsaPostRegistrationRoute(input: {
  readonly ctx: FetchRouterApiContext;
  readonly body: unknown;
  readonly pathname: string;
  readonly port: RouterAbEcdsaStrictPostRegistrationPort | null | undefined;
}): Promise<Response> {
  if (!input.port) {
    return jsonFailure(
      503,
      'not_configured',
      'Strict Router A/B ECDSA post-registration port is not configured',
    );
  }
  let parsed: StrictEcdsaPostRegistrationRequest;
  try {
    parsed = parseStrictEcdsaPostRegistrationRequest(input.pathname, input.body);
  } catch (error: unknown) {
    return jsonFailure(
      400,
      'invalid_body',
      error instanceof Error ? error.message : 'Strict ECDSA post-registration request is invalid',
    );
  }
  const authorized = await authorizeStrictEcdsaPostRegistrationRequest({
    ctx: input.ctx,
    request: parsed,
  });
  if (!authorized.ok) {
    return json(authorized, {
      status: strictEcdsaAuthorizationFailureStatus(authorized),
    });
  }
  switch (parsed.kind) {
    case 'export': {
      const exportAuthorization = await authorizeStrictEcdsaExport({
        ctx: input.ctx,
        request: parsed.request,
        authorization: authorized,
      });
      if (!exportAuthorization.ok) {
        return json(exportAuthorization.error.body, {
          status: exportAuthorization.error.status,
        });
      }
      const tenantRoot = await input.ctx.service.walletRegistration.resolveActiveEcdsaTenantRoot({
        walletId: parsed.request.lifecycle.account_id,
        materialActivation: parsed.request.material_activation,
      });
      if (!tenantRoot.ok) {
        return json(tenantRoot, { status: tenantRoot.code === 'internal' ? 500 : 403 });
      }
      const result = await input.port.explicitExport({
        request: parsed.request,
        requestDigestB64u: parsed.requestDigestB64u,
        authority: exportAuthorization.authority,
        tenantRoot,
      });
      if (!result.ok) return strictPostRegistrationFailureResponse(result);
      return json(result.value, { status: 200 });
    }
    case 'refresh': {
      const tenantRoot = await input.ctx.service.walletRegistration.resolveActiveEcdsaTenantRoot({
        walletId: parsed.request.lifecycle.account_id,
        materialActivation: parsed.request.material_activation,
      });
      if (!tenantRoot.ok) {
        return json(tenantRoot, { status: tenantRoot.code === 'internal' ? 500 : 403 });
      }
      const result = await input.port.refresh({
        request: parsed.command,
        requestDigestB64u: parsed.requestDigestB64u,
        authority: authorized.authority,
        tenantRoot,
      });
      if (!result.ok) return strictPostRegistrationFailureResponse(result);
      if (result.value.result === 'forwarded') {
        const recorded =
          await input.ctx.service.walletRegistration.recordEcdsaPostRegistrationProof({
            operation: 'refresh',
            request: parsed.request,
            response: result.value,
          });
        if (!recorded.ok) {
          return json(recorded, { status: recorded.code === 'internal' ? 500 : 400 });
        }
      }
      return json(result.value, { status: 200 });
    }
  }
}

type StrictEcdsaExportAuthorizationResult =
  | { readonly ok: true; readonly authority: RouterAbEcdsaStrictExportAuthority }
  | {
      readonly ok: false;
      readonly error: { readonly status: number; readonly body: unknown };
    };

type StrictEcdsaExportFailure = Extract<
  StrictEcdsaExportAuthorizationResult,
  { readonly ok: false }
>;

type StrictEcdsaExportOperationStepUpAdmissionResult =
  | { readonly ok: true; readonly evidenceSetDigest: string }
  | StrictEcdsaExportFailure;

function strictEcdsaExportScopeMatchesRequest(input: {
  readonly request: RouterAbEcdsaDerivationExplicitExportRequestV1;
  readonly scope: RouterAbEcdsaOperationStepUpPreparationV1Wire['normal_signing_scope'];
}): boolean {
  return (
    input.scope.wallet_id === input.request.lifecycle.account_id &&
    input.scope.context.application_binding_digest_b64u ===
      input.request.context.application_binding_digest_b64u &&
    input.scope.public_identity.context_binding_b64u ===
      input.request.public_identity.context_binding_b64u &&
    input.scope.public_identity.threshold_public_key33_b64u ===
      input.request.public_identity.threshold_public_key33_b64u &&
    input.scope.signing_worker.server_id === input.request.lifecycle.selected_server_id &&
    input.scope.activation_epoch === input.request.lifecycle.root_share_epoch &&
    sameRouterAbMpcMaterialActivationRef(
      input.scope.material_activation,
      input.request.material_activation,
    )
  );
}

type RouterAbEcdsaCustodySigner = Awaited<
  ReturnType<RouterApiWalletRegistrationService['listWalletEcdsaCustodyContinuity']>
>[number];

function sameV2EcdsaCustodyIdentity(
  left: RouterAbEcdsaCustodySigner,
  right: RouterAbEcdsaCustodySigner,
): boolean {
  return (
    left.walletId === right.walletId &&
    left.walletKey.keyHandle === right.walletKey.keyHandle &&
    left.walletKey.thresholdEcdsaPublicKeyB64u === right.walletKey.thresholdEcdsaPublicKeyB64u &&
    left.walletKey.thresholdOwnerAddress === right.walletKey.thresholdOwnerAddress &&
    left.walletKey.relayerKeyId === right.walletKey.relayerKeyId &&
    left.walletKey.participantIds[0] === right.walletKey.participantIds[0] &&
    left.walletKey.participantIds[1] === right.walletKey.participantIds[1] &&
    sameRouterAbEcdsaDerivationPublicCapabilityV1(
      left.walletKey.publicCapability,
      right.walletKey.publicCapability,
    ) &&
    sameRuntimePolicyScope(left.runtimePolicyScope, right.runtimePolicyScope)
  );
}

function strictEcdsaNormalSigningPublicIdentityMatchesSigner(input: {
  readonly signer: RouterAbEcdsaCustodySigner;
  readonly scope: RouterAbEcdsaOperationStepUpPreparationV1Wire['normal_signing_scope'];
}): boolean {
  const capability = input.signer.walletKey.publicCapability;
  return (
    input.scope.wallet_id === String(input.signer.walletId) &&
    input.scope.context.application_binding_digest_b64u ===
      capability.context.application_binding_digest_b64u &&
    input.scope.public_identity.context_binding_b64u ===
      capability.public_identity.context_binding_b64u &&
    input.scope.public_identity.threshold_public_key33_b64u ===
      capability.public_identity.threshold_public_key33_b64u &&
    input.scope.signing_worker.server_id === capability.signer_set.selected_server.server_id &&
    input.scope.activation_epoch === capability.activation_epoch
  );
}

function resolveV2EcdsaCustodySigner(input: {
  readonly continuity: readonly RouterAbEcdsaCustodySigner[];
  readonly walletId: string;
  readonly admittedThresholdPublicKey33B64u: string;
  readonly admittedEvmAddress: string;
  readonly operation: RouterAbEcdsaOperationStepUpPreparationV1Wire;
}): RouterAbEcdsaCustodySigner | null {
  const matching: RouterAbEcdsaCustodySigner[] = [];
  for (const candidate of input.continuity) {
    if (
      candidate.walletId === input.walletId &&
      candidate.walletKey.thresholdEcdsaPublicKeyB64u === input.admittedThresholdPublicKey33B64u &&
      candidate.walletKey.thresholdOwnerAddress === input.admittedEvmAddress &&
      ecdsaMaterialNamesOperationKey(candidate.walletKey, input.operation)
    ) {
      matching.push(candidate);
    }
  }
  const [canonical] = matching;
  if (!canonical) return null;
  for (const candidate of matching) {
    if (
      !strictEcdsaNormalSigningPublicIdentityMatchesSigner({
        signer: candidate,
        scope: input.operation.normal_signing_scope,
      }) ||
      !sameV2EcdsaCustodyIdentity(canonical, candidate)
    ) {
      return null;
    }
  }
  return canonical;
}

function strictEcdsaExportScopeMatchesSigner(input: {
  readonly signer: RouterAbEcdsaCustodySigner;
  readonly scope: RouterAbEcdsaOperationStepUpPreparationV1Wire['normal_signing_scope'];
}): boolean {
  const capability = input.signer.walletKey.publicCapability;
  return (
    strictEcdsaNormalSigningPublicIdentityMatchesSigner(input) &&
    sameRouterAbMpcMaterialActivationRef(
      input.scope.material_activation,
      capability.material_activation,
    )
  );
}

async function resolveStrictEcdsaExportTopology(input: {
  readonly ctx: FetchRouterApiContext;
  readonly operation: RouterAbEcdsaOperationStepUpPreparationV1Wire;
}): Promise<RouterAbEcdsaOperationStepUpExportTopologyV1Wire | null> {
  const continuity = await input.ctx.service.walletRegistration.listWalletEcdsaCustodyContinuity({
    walletId: input.operation.wallet_id,
  });
  const matches = continuity.filter(
    (candidate) =>
      candidate.walletId === input.operation.wallet_id &&
      ecdsaMaterialNamesOperationKey(candidate.walletKey, input.operation) &&
      sameRouterAbMpcMaterialActivationRef(
        candidate.walletKey.publicCapability.material_activation,
        input.operation.material_activation,
      ) &&
      strictEcdsaExportScopeMatchesSigner({
        signer: candidate,
        scope: input.operation.normal_signing_scope,
      }),
  );
  const [signer] = matches;
  if (!signer) return null;
  for (const candidate of matches) {
    if (!sameV2EcdsaCustodyIdentity(signer, candidate)) return null;
  }
  const topology = signer.walletKey.publicCapability;
  if (
    topology.signer_set.selected_server.server_id !==
      input.operation.normal_signing_scope.signing_worker.server_id ||
    topology.public_identity.context_binding_b64u !==
      input.operation.normal_signing_scope.public_identity.context_binding_b64u ||
    topology.context.application_binding_digest_b64u !==
      input.operation.normal_signing_scope.context.application_binding_digest_b64u
  ) {
    return null;
  }
  return {
    signer_set: topology.signer_set,
    deriver_recipient_keys: topology.deriver_recipient_keys,
    router_id: topology.router_id,
  };
}

type StrictEcdsaExportOperationStepUpInput = {
  readonly operation: RouterAbEcdsaOperationStepUpPreparationV1Wire;
  readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  readonly keyHandle: string;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly readSnapshot: EcdsaMaterialReadSnapshot | undefined;
  readonly authorizedOperations: RouterApiAuthorizedOperationService;
};

async function admitStrictEcdsaExportOperationStepUp(
  input: StrictEcdsaExportOperationStepUpInput,
): Promise<StrictEcdsaExportOperationStepUpAdmissionResult> {
  if (!routerAbEcdsaAtomicAuthorizationConfigured(input.authorizedOperations)) {
    return failureResult(501, 'not_configured', 'ECDSA atomic authorization is not configured');
  }
  let authorizedOperationId;
  try {
    authorizedOperationId = requireAuthorizationValue(
      parseAuthorizedOperationId(
        `ecdsa-step-up-authorized-operation:${input.operation.operation_id}`,
      ),
    );
  } catch (error: unknown) {
    return failureResult(
      400,
      'invalid_body',
      error instanceof Error ? error.message : 'Export operation step-up admission is invalid',
    );
  }
  const existing = await input.authorizedOperations.readAuthorizedOperationById({
    tenantId: input.authorizedOperations.tenantId,
    authorizedOperationId,
  });
  if (!existing) {
    return failureResult(
      409,
      'authorized_operation_missing',
      'Operation authorization is unavailable',
    );
  }
  if (
    existing.authorization.kind !== 'verified_step_up' ||
    existing.quota.kind !== 'quota_neutral' ||
    existing.authorizedOperationId !== authorizedOperationId ||
    existing.operation.operationId !== input.operation.operation_id ||
    existing.operation.capabilityId !== input.materialActivation.capability ||
    existing.operation.operation.capabilityKind !== 'evm_ecdsa_mpc_signing' ||
    existing.operation.operation.operationKind !== 'evm.export_key' ||
    existing.operation.digests.laneDigest !== input.operation.operation_digests.lane_digest_b64u ||
    existing.operation.digests.intentDigest !==
      input.operation.operation_digests.intent_digest_b64u ||
    existing.operation.digests.displayDigest !==
      input.operation.operation_digests.display_digest_b64u
  ) {
    return failureResult(
      409,
      'authorized_operation_missing',
      'ECDSA export operation authorization has an invalid source or quota',
    );
  }
  const result = await input.authorizedOperations.admitAuthorizedOperation({
    operation: {
      tenantId: existing.tenantId,
      authorizedOperationId: existing.authorizedOperationId,
      auditEventId: existing.auditEventId,
      operation: existing.operation,
      authorization: existing.authorization,
      quota: existing.quota,
      claimedAtMs: Date.now(),
    },
    material: {
      walletId: walletIdFromString(input.operation.wallet_id),
      keyHandle: input.keyHandle,
      runtimePolicyScope: input.runtimePolicyScope,
      materialActivation: input.materialActivation,
      readSnapshot: input.readSnapshot,
    },
  });
  switch (result.kind) {
    case 'material_mismatch':
      return failureResult(
        403,
        'scope_mismatch',
        'ECDSA material activation changed before export admission',
      );
    case 'claimed':
    case 'operation_in_progress':
    case 'replayed':
      return {
        ok: true,
        evidenceSetDigest: existing.authorization.evidenceSetDigest,
      };
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
      return failureResult(403, result.kind, 'Operation step-up authorization is invalid');
    case 'billing_credit_exhausted':
    case 'wallet_session_quota_exhausted':
      return failureResult(409, result.kind, 'Operation step-up authorization is invalid');
  }
}

async function authorizeStrictEcdsaV2ExportOperationStepUp(input: {
  readonly ctx: FetchRouterApiContext;
  readonly request: RouterAbEcdsaDerivationExplicitExportRequestV1;
  readonly authorization: Extract<
    StrictEcdsaPostRegistrationAuthorization,
    { readonly ok: true; readonly kind: 'wallet_session_operation_step_up_v2' }
  >;
}): Promise<StrictEcdsaExportAuthorizationResult> {
  const operation = input.request.operation;
  if (!operation) {
    return failureResult(
      400,
      'invalid_body',
      'Operation step-up export requires operation preparation',
    );
  }
  const resolution = await resolveV2EcdsaOperationStepUpAdmission({
    ctx: input.ctx,
    operation,
  });
  if (resolution.kind === 'unavailable') {
    return failureResult(
      503,
      'wallet_session_unavailable',
      'Wallet Session authorization is unavailable',
    );
  }
  if (resolution.kind !== 'admitted') {
    return failureResult(
      403,
      'scope_mismatch',
      'ECDSA export operation step-up Wallet Session authorization is invalid',
    );
  }
  if (
    !walletSessionAuthorizationV2RecordsEqual(
      input.authorization.v2Admission.context.authorization.session,
      resolution.context.session,
    )
  ) {
    return failureResult(
      403,
      'scope_mismatch',
      'ECDSA export operation step-up Wallet Session changed',
    );
  }
  const session = resolution.context.session;
  const activeMaterial = resolution.activeMaterial;
  if (
    input.request.authorization.kind !== 'operation_step_up' ||
    operation.operation_kind !== 'evm.export_key' ||
    operation.wallet_id !== String(session.walletId) ||
    operation.wallet_id !== input.request.lifecycle.account_id ||
    operation.material_activation.material_owner !== String(session.walletId) ||
    operation.material_activation.signing_worker !== input.request.lifecycle.selected_server_id ||
    operation.signing_worker_id !== input.request.lifecycle.selected_server_id ||
    !sameRouterAbMpcMaterialActivationRef(
      operation.material_activation,
      input.request.material_activation,
    ) ||
    operation.expires_at_ms < input.request.expires_at_ms ||
    !strictEcdsaExportScopeMatchesRequest({
      request: input.request,
      scope: operation.normal_signing_scope,
    }) ||
    !ecdsaMaterialNamesOperationKey(activeMaterial, operation) ||
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      operation.material_activation,
    )
  ) {
    return failureResult(
      403,
      'scope_mismatch',
      'ECDSA export operation step-up scope does not match the active Wallet Session material',
    );
  }
  const admission = await admitStrictEcdsaExportOperationStepUp({
    operation,
    materialActivation: activeMaterial.materialActivation,
    keyHandle: activeMaterial.keyHandle,
    runtimePolicyScope: activeMaterial.runtimePolicyScope,
    readSnapshot: activeMaterial.readSnapshot,
    authorizedOperations: input.ctx.service.authorizedOperations,
  });
  if (!admission.ok) return admission;
  return {
    ok: true,
    authority: {
      subjectId: input.authorization.authority.subjectId,
      sessionId: input.authorization.authority.sessionId,
      accountId: input.authorization.authority.accountId,
      expiresAtMs: input.authorization.authority.expiresAtMs,
      keyHandle: activeMaterial.keyHandle,
      authorization: input.request.authorization,
      normalSigningScope: operation.normal_signing_scope,
      privateAuthorization: {
        kind: 'operation_step_up',
        evidenceSetDigest: admission.evidenceSetDigest,
      },
    },
  };
}

async function authorizeStrictEcdsaExport(input: {
  readonly ctx: FetchRouterApiContext;
  readonly request: RouterAbEcdsaDerivationExplicitExportRequestV1;
  readonly authorization: Extract<StrictEcdsaPostRegistrationAuthorization, { readonly ok: true }>;
}): Promise<StrictEcdsaExportAuthorizationResult> {
  if (input.authorization.kind === 'wallet_session_operation_credential_v2') {
    return failureResult(
      403,
      'scope_mismatch',
      'ECDSA export requires an export operation step-up',
    );
  }
  if (input.request.authorization.kind === 'operation_step_up') {
    if (input.authorization.kind === 'wallet_session_operation_step_up_v2') {
      return authorizeStrictEcdsaV2ExportOperationStepUp({
        ctx: input.ctx,
        request: input.request,
        authorization: input.authorization,
      });
    }
    if (input.authorization.authority.subjectId !== input.request.lifecycle.account_id) {
      return failureResult(403, 'scope_mismatch', 'ECDSA export operation authority is invalid');
    }
    const operation = input.request.operation;
    if (!operation) {
      return failureResult(
        400,
        'invalid_body',
        'Operation step-up export requires operation preparation',
      );
    }
    if (
      operation.operation_kind !== 'evm.export_key' ||
      operation.wallet_id !== input.request.lifecycle.account_id ||
      operation.material_activation.material_owner !== input.request.lifecycle.account_id ||
      !sameRouterAbMpcMaterialActivationRef(
        operation.material_activation,
        input.request.material_activation,
      ) ||
      operation.material_activation.signing_worker !== input.request.lifecycle.selected_server_id ||
      operation.signing_worker_id !== input.request.lifecycle.selected_server_id ||
      operation.expires_at_ms < input.request.expires_at_ms ||
      !strictEcdsaExportScopeMatchesRequest({
        request: input.request,
        scope: operation.normal_signing_scope,
      })
    ) {
      return failureResult(
        403,
        'scope_mismatch',
        'ECDSA export operation scope does not match the request',
      );
    }
    const activeMaterial =
      await input.ctx.service.walletRegistration.resolveEcdsaMaterialActivation({
        source: { kind: 'database' },
        walletId: operation.wallet_id,
        materialActivation: input.request.material_activation,
      });
    if (!activeMaterial.ok) {
      return failureResult(
        activeMaterial.code === 'internal' ? 500 : 403,
        activeMaterial.code,
        activeMaterial.message,
      );
    }
    if (
      !ecdsaMaterialNamesOperationKey(activeMaterial, operation) ||
      !sameRouterAbMpcMaterialActivationRef(
        activeMaterial.materialActivation,
        operation.material_activation,
      ) ||
      !sameRouterAbMpcMaterialActivationRef(
        activeMaterial.materialActivation,
        operation.normal_signing_scope.material_activation,
      )
    ) {
      return failureResult(403, 'scope_mismatch', 'ECDSA export material is no longer active');
    }
    const freshMaterial = await resolveFreshRouterAbEcdsaMaterialActivation({
      resolveEcdsaMaterialActivation:
        input.ctx.service.walletRegistration.resolveEcdsaMaterialActivation.bind(
          input.ctx.service.walletRegistration,
        ),
      walletId: operation.wallet_id,
      expected: operation.material_activation,
    });
    if (!freshMaterial.ok) {
      return failureResult(
        freshMaterial.code === 'internal' ? 500 : 403,
        freshMaterial.code === 'internal' ? 'internal' : 'scope_mismatch',
        freshMaterial.message,
      );
    }
    if (
      !ecdsaMaterialNamesOperationKey(freshMaterial, operation) ||
      !sameRouterAbMpcMaterialActivationRef(
        freshMaterial.materialActivation,
        operation.normal_signing_scope.material_activation,
      )
    ) {
      return failureResult(
        403,
        'scope_mismatch',
        'ECDSA export material changed before operation admission',
      );
    }
    const admission = await admitStrictEcdsaExportOperationStepUp({
      operation,
      materialActivation: freshMaterial.materialActivation,
      keyHandle: freshMaterial.keyHandle,
      runtimePolicyScope: activeMaterial.runtimePolicyScope,
      readSnapshot: freshMaterial.readSnapshot,
      authorizedOperations: input.ctx.service.authorizedOperations,
    });
    if (!admission.ok) return admission;
    return {
      ok: true,
      authority: {
        subjectId: input.authorization.authority.subjectId,
        sessionId: input.authorization.authority.sessionId,
        accountId: input.authorization.authority.accountId,
        expiresAtMs: input.authorization.authority.expiresAtMs,
        keyHandle: operation.key_handle,
        authorization: input.request.authorization,
        normalSigningScope: operation.normal_signing_scope,
        privateAuthorization: {
          kind: 'operation_step_up',
          evidenceSetDigest: admission.evidenceSetDigest,
        },
      },
    };
  }
  return failureResult(403, 'scope_mismatch', 'ECDSA export requires an operation step-up');
}

function strictPostRegistrationFailureResponse(
  result: Extract<
    RouterAbEcdsaStrictExportResult | RouterAbEcdsaStrictRefreshResult,
    { readonly ok: false }
  >,
): Response {
  return jsonFailure(result.retryable ? 502 : 400, result.code, result.message);
}

export async function handleThresholdEcdsa(ctx: FetchRouterApiContext): Promise<Response | null> {
  if (ctx.method === 'GET' && ctx.pathname === ROUTER_AB_ECDSA_DERIVATION_HEALTH_PATH) {
    const runtime = ctx.service.thresholdRuntime.getRouterAbEcdsaPresignRuntime();
    if (!runtime) {
      const body = {
        ok: false,
        code: 'not_configured',
        message: 'Router A/B ECDSA presign runtime is not configured on this server',
        configured: false,
      };
      return json(body, { status: thresholdEcdsaStatusCode(body) });
    }
    const health = runtime.healthz();
    if (health.ok) return json({ ok: true, configured: true }, { status: 200 });
    const body = { ...NOT_IMPLEMENTED, configured: true };
    return json(body, { status: thresholdEcdsaStatusCode(body) });
  }

  const routed = await readThresholdRouteBody(ctx, [
    ROUTER_AB_ECDSA_DERIVATION_EXPORT_PATH,
    ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_PREPARE_PATH,
    ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_PATH,
    ROUTER_AB_ECDSA_DERIVATION_OPERATION_STEP_UP_PATH,
    ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH,
    ROUTER_AB_ECDSA_DERIVATION_SESSION_ACTIVATION_PATH,
    ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_FILL_INIT_PATH,
    ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_FILL_STEP_PATH,
  ]);
  if (!routed) return null;
  const { pathname, body: bodyUnknown } = routed;
  if (pathname === ROUTER_AB_ECDSA_DERIVATION_OPERATION_STEP_UP_PATH) {
    let request: RouterAbEcdsaOperationStepUpAuthorizationRequestV1Wire;
    try {
      request = parseRouterAbEcdsaOperationStepUpAuthorizationRequestV1(bodyUnknown);
    } catch (error: unknown) {
      return jsonFailure(
        400,
        'invalid_body',
        error instanceof Error ? error.message : 'Operation step-up request is invalid',
      );
    }
    return issueEcdsaOperationStepUpAuthorization({ ctx, request });
  }
  if (pathname === ROUTER_AB_ECDSA_DERIVATION_SESSION_ACTIVATION_PATH) {
    return jsonFailure(
      401,
      'owner_proof_required',
      'ECDSA Wallet Session activation requires verified owner authorization',
    );
  }
  if (
    pathname === ROUTER_AB_ECDSA_DERIVATION_EXPORT_PATH ||
    pathname === ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH
  ) {
    return handleStrictEcdsaPostRegistrationRoute({
      ctx,
      body: bodyUnknown,
      pathname,
      port: ctx.opts.routerAbEcdsaStrictPostRegistration,
    });
  }
  const body = jsonObjectOrEmpty(bodyUnknown);
  if (pathname === ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_PREPARE_PATH) {
    return handleRouterAbEcdsaDerivationNormalSigningRoute({
      ctx,
      body,
      phase: 'prepare',
    });
  }

  if (pathname === ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_PATH) {
    return handleRouterAbEcdsaDerivationNormalSigningRoute({
      ctx,
      body,
      phase: 'finalize',
    });
  }

  if (pathname === ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_FILL_INIT_PATH) {
    return handleEcdsaPoolFillRoute({ ctx, body, phase: 'init' });
  }
  if (pathname === ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_FILL_STEP_PATH) {
    return handleEcdsaPoolFillRoute({ ctx, body, phase: 'step' });
  }
  return null;
}
