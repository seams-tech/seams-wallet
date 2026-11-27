import type { FetchRouterApiContext } from '../createFetchRouter';
import { parseEcdsaServerTiming } from '@shared/utils/ecdsaServerTiming';
import { json } from '../../../framework/http';
import { thresholdEcdsaStatusCode } from '../../../../threshold/statusCodes';
import { validateEcdsaPreprocessingSession } from '../../../auth/commonRouterUtils';
import {
  sameRouterAbEcdsaDerivationNormalSigningScopeV1,
  ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_STATE_KIND_V1,
  type RouterAbEcdsaOperationStepUpPreparationV1Wire,
} from '@shared/utils/routerAbEcdsaDerivation';
import {
  authenticateRouterAbEcdsaOperationStepUp,
  claimRouterAbEcdsaOperationStepUp,
} from '../../../domains/signingOperations/routerAbEcdsaDerivationNormalSigningRoute';
import {
  parseRouterAbEcdsaDerivationPoolFillInitRouteRequest,
  parseRouterAbEcdsaDerivationPoolFillStepRouteRequest,
  type RouterAbEcdsaPoolFillInitRouteRequest,
  type RouterAbEcdsaPoolFillStepRouteRequest,
} from '../../../domains/ecdsa/thresholdEcdsaRequestValidation';
import type {
  RouterAbEcdsaDerivationPoolFillInitRequest,
  RouterAbEcdsaDerivationPoolFillStepRequest,
} from '../../../../core/types';
import type { RouterAbEcdsaDerivationPoolFillBinding } from '../../../../core/ThresholdService/routerAb/ecdsaDerivationPoolFillHandlers';
import { WALLET_SESSION_FAILURE_CODES } from '@shared/utils/walletSessionFailure';
import { base64UrlEncode } from '@shared/utils/encoders';
import { parseWalletId } from '@shared/utils/domainIds';
import {
  sameRouterAbMpcMaterialActivationRef,
  routerAbMpcMaterialActivationRefToWire,
  type RouterAbMpcMaterialActivationRefWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import {
  ecdsaMaterialNamesOperationKey,
  failureResult,
  readPinnedEcdsaStepUpWalletScope,
  withServerTiming,
} from './thresholdSigningRouteShared';

type RouterAbEcdsaPoolFillAuthorizationResult =
  | {
      readonly ok: true;
      readonly binding: RouterAbEcdsaDerivationPoolFillBinding;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly status: number;
        readonly body: unknown;
      };
    };

type EcdsaPresignGatewayTiming = {
  authenticate: number | null;
  material: number | null;
  admit: number | null;
  proxy: number | null;
  total: number | null;
};

export async function handleEcdsaPoolFillRoute(input: {
  readonly ctx: FetchRouterApiContext;
  readonly body: Record<string, unknown>;
  readonly phase: 'init' | 'step';
}): Promise<Response> {
  const timing: EcdsaPresignGatewayTiming = {
    authenticate: null,
    material: null,
    admit: null,
    proxy: null,
    total: null,
  };
  const workerTimings = new Map<string, number>();
  return await withServerTiming(
    'ecdsa_presign_',
    timing,
    () => executeEcdsaPoolFillRoute(input, timing, workerTimings),
    workerTimings,
  );
}

function collectEcdsaPresignWorkerTiming(
  durations: Map<string, number>,
  header: string | null,
): void {
  for (const [name, duration] of parseEcdsaServerTiming(header)) {
    if (name.startsWith('ecdsa_presign_sw_')) durations.set(name, duration);
  }
}

async function executeEcdsaPoolFillRoute(
  input: {
    readonly ctx: FetchRouterApiContext;
    readonly body: Record<string, unknown>;
    readonly phase: 'init' | 'step';
  },
  timing: EcdsaPresignGatewayTiming,
  workerTimings: Map<string, number>,
): Promise<Response> {
  const runtime = input.ctx.service.thresholdRuntime.getRouterAbEcdsaPresignRuntime();
  if (!runtime) {
    const failure = {
      ok: false,
      code: 'not_configured',
      message: 'Router A/B ECDSA presign runtime is not configured on this server',
    };
    return json(failure, { status: thresholdEcdsaStatusCode(failure) });
  }
  const parsed =
    input.phase === 'init'
      ? parseRouterAbEcdsaDerivationPoolFillInitRouteRequest(input.body)
      : parseRouterAbEcdsaDerivationPoolFillStepRouteRequest(input.body);
  if (!parsed.ok) {
    return json(parsed.body, { status: thresholdEcdsaStatusCode(parsed.body) });
  }
  const request = parsed.request;
  const authorized = await authorizeEcdsaPoolFill({ ctx: input.ctx, request, timing });
  if (!authorized.ok) {
    return json(authorized.error.body, { status: authorized.error.status });
  }
  const proxyStartedAt = performance.now();
  const result =
    'poolFill' in request
      ? await runtime.initializePoolFill({
          binding: authorized.binding,
          request: ecdsaPoolFillInitRuntimeRequest(request),
          onServerTiming: collectEcdsaPresignWorkerTiming.bind(undefined, workerTimings),
        })
      : await runtime.advancePoolFill({
          binding: authorized.binding,
          request: ecdsaPoolFillStepRuntimeRequest(request),
          onServerTiming: collectEcdsaPresignWorkerTiming.bind(undefined, workerTimings),
        });
  timing.proxy = performance.now() - proxyStartedAt;
  return json(result, { status: thresholdEcdsaStatusCode(result) });
}

function poolFillMaterialActivation(
  request: RouterAbEcdsaPoolFillInitRouteRequest | RouterAbEcdsaPoolFillStepRouteRequest,
): RouterAbMpcMaterialActivationRefWire | null {
  return 'poolFill' in request ? request.poolFill.scope.material_activation : null;
}

function evmAddress20B64u(value: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  const bytes = new Uint8Array(20);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return base64UrlEncode(bytes);
}

function validateEcdsaPoolFillOperationIdentity(
  operation: RouterAbEcdsaOperationStepUpPreparationV1Wire,
): boolean {
  return (
    operation.wallet_id === operation.normal_signing_scope.wallet_id &&
    operation.signing_worker_id === operation.normal_signing_scope.signing_worker.server_id &&
    operation.material_activation.material_owner === operation.wallet_id &&
    operation.material_activation.signing_worker === operation.signing_worker_id &&
    sameRouterAbMpcMaterialActivationRef(
      operation.material_activation,
      operation.normal_signing_scope.material_activation,
    ) &&
    operation.expires_at_ms > Date.now()
  );
}

async function authorizeEcdsaPoolFillOperationStepUp(input: {
  readonly ctx: FetchRouterApiContext;
  readonly authorization: Extract<
    RouterAbEcdsaPoolFillInitRouteRequest['authorization'],
    { readonly kind: 'operation_step_up' }
  >;
  readonly operation: RouterAbEcdsaOperationStepUpPreparationV1Wire;
  readonly poolFillMaterialActivation: RouterAbMpcMaterialActivationRefWire | null;
  readonly timing: EcdsaPresignGatewayTiming;
}): Promise<RouterAbEcdsaPoolFillAuthorizationResult> {
  if (!validateEcdsaPoolFillOperationIdentity(input.operation)) {
    return failureResult(403, 'scope_mismatch', 'ECDSA pool-fill operation scope is invalid');
  }
  const authenticationStartedAt = performance.now();
  const authenticated = await authenticateRouterAbEcdsaOperationStepUp({
    headers: Object.fromEntries(input.ctx.request.headers.entries()),
    request: input.operation,
    authorizedOperations: input.ctx.service.authorizedOperations,
    authorizationSessions: input.ctx.service.authorizationSessions,
    resolveEcdsaMaterialActivation:
      input.ctx.service.walletRegistration.resolveEcdsaMaterialActivation.bind(
        input.ctx.service.walletRegistration,
      ),
  });
  input.timing.authenticate = performance.now() - authenticationStartedAt;
  if (!authenticated.ok) return authenticated;
  const materialStartedAt = performance.now();
  const freshMaterial = authenticated.activeMaterial;
  input.timing.material = performance.now() - materialStartedAt;
  if (
    !ecdsaMaterialNamesOperationKey(freshMaterial, input.operation) ||
    !sameRouterAbMpcMaterialActivationRef(
      freshMaterial.materialActivation,
      input.operation.normal_signing_scope.material_activation,
    ) ||
    (input.poolFillMaterialActivation !== null &&
      !sameRouterAbMpcMaterialActivationRef(
        freshMaterial.materialActivation,
        input.poolFillMaterialActivation,
      ))
  ) {
    return failureResult(
      403,
      'scope_mismatch',
      'ECDSA pool-fill material changed before operation admission',
    );
  }
  const admissionStartedAt = performance.now();
  const claim = await claimRouterAbEcdsaOperationStepUp({
    operationKind: 'evm.sign_transaction',
    operation: input.operation,
    materialActivation: freshMaterial.materialActivation,
    keyHandle: freshMaterial.keyHandle,
    readSnapshot: freshMaterial.readSnapshot,
    authenticated,
  });
  input.timing.admit = performance.now() - admissionStartedAt;
  if (claim && 'status' in claim) {
    return {
      ok: false,
      error: claim,
    };
  }
  if (!claim) {
    return failureResult(
      409,
      'authorized_operation_missing',
      'ECDSA pool-fill step-up operation is unavailable',
    );
  }
  const ownerWalletScope = await readPinnedEcdsaStepUpWalletScope(
    input.ctx,
    authenticated.session,
    claim.operation,
  );
  const walletId = parseWalletId(input.operation.wallet_id);
  if (!walletId.ok) {
    return failureResult(403, 'scope_mismatch', 'ECDSA wallet identity is invalid');
  }
  return {
    ok: true,
    binding: {
      walletId: walletId.value,
      relayerKeyId: input.operation.relayer_key_id,
      keyHandle: input.operation.key_handle,
      runtimePolicyScope: authenticated.session.runtimePolicyScope,
      participantIds: [...input.operation.participant_ids],
      thresholdExpiresAtMs: input.operation.expires_at_ms,
      authorization: {
        kind: 'operation_step_up',
        materialExpiresAtMs: input.operation.expires_at_ms,
      },
      ownerWalletScope,
      ownershipGeneration: ownerWalletScope.ownershipGeneration,
      routerAbEcdsaDerivationNormalSigning: {
        kind: ROUTER_AB_ECDSA_DERIVATION_NORMAL_SIGNING_STATE_KIND_V1,
        scope: input.operation.normal_signing_scope,
      },
    },
  };
}

export async function authorizeEcdsaPoolFill(input: {
  readonly ctx: FetchRouterApiContext;
  readonly request: RouterAbEcdsaPoolFillInitRouteRequest | RouterAbEcdsaPoolFillStepRouteRequest;
  readonly timing: EcdsaPresignGatewayTiming;
}): Promise<RouterAbEcdsaPoolFillAuthorizationResult> {
  switch (input.request.authorization.kind) {
    case 'reusable_wallet_session': {
      const authenticationStartedAt = performance.now();
      const validated = await validateEcdsaPreprocessingSession({
        headers: Object.fromEntries(input.ctx.request.headers.entries()),
        authorizationSessions: input.ctx.service.authorizationSessions,
      });
      input.timing.authenticate = performance.now() - authenticationStartedAt;
      if (!validated.ok) {
        return {
          ok: false,
          error: {
            status: thresholdEcdsaStatusCode(validated),
            body: validated,
          },
        };
      }
      const session = validated.session;
      if (input.request.authorization.wallet_session_id !== session.walletSessionId) {
        return failureResult(
          403,
          WALLET_SESSION_FAILURE_CODES.scopeMismatch,
          'Pool-fill authorization does not match the Wallet Session',
        );
      }
      const admitted = validated;
      const materialStartedAt = performance.now();
      const activeMaterial =
        await input.ctx.service.walletRegistration.resolveEcdsaMaterialActivation({
          source: { kind: 'database' },
          walletId: String(session.walletId),
          materialActivation: routerAbMpcMaterialActivationRefToWire(admitted.materialActivation),
        });
      input.timing.material = performance.now() - materialStartedAt;
      if (!activeMaterial.ok) {
        return failureResult(
          activeMaterial.code === 'internal' ? 500 : 403,
          activeMaterial.code === 'internal'
            ? 'internal'
            : WALLET_SESSION_FAILURE_CODES.scopeMismatch,
          activeMaterial.code === 'internal'
            ? activeMaterial.message
            : 'Pool-fill Wallet Session material is no longer active',
        );
      }
      const normalSigning = activeMaterial.routerAbEcdsaDerivationNormalSigning;
      const requestedPoolFillMaterial = poolFillMaterialActivation(input.request);
      const requestedKeyHandle = 'keyHandle' in input.request ? input.request.keyHandle : undefined;
      if (
        !sameRouterAbMpcMaterialActivationRef(
          activeMaterial.materialActivation,
          routerAbMpcMaterialActivationRefToWire(admitted.materialActivation),
        ) ||
        normalSigning.scope.wallet_id !== String(session.walletId) ||
        normalSigning.scope.public_identity.threshold_public_key33_b64u !==
          admitted.signer.thresholdPublicKey33B64u ||
        normalSigning.scope.public_identity.ethereum_address20_b64u !==
          evmAddress20B64u(admitted.signer.evmAddress) ||
        (requestedKeyHandle !== undefined && requestedKeyHandle !== activeMaterial.keyHandle) ||
        (requestedPoolFillMaterial !== null &&
          (!sameRouterAbMpcMaterialActivationRef(
            activeMaterial.materialActivation,
            requestedPoolFillMaterial,
          ) ||
            !('poolFill' in input.request) ||
            !sameRouterAbEcdsaDerivationNormalSigningScopeV1(
              input.request.poolFill.scope,
              normalSigning.scope,
            )))
      ) {
        return failureResult(
          403,
          WALLET_SESSION_FAILURE_CODES.scopeMismatch,
          'Pool-fill scopes do not match the active Wallet Authority material',
        );
      }
      return {
        ok: true,
        binding: {
          walletId: session.walletId,
          relayerKeyId: activeMaterial.relayerKeyId,
          keyHandle: activeMaterial.keyHandle,
          runtimePolicyScope: activeMaterial.runtimePolicyScope,
          participantIds: activeMaterial.participantIds,
          thresholdExpiresAtMs: session.expiresAtMs,
          authorization: { kind: 'wallet_session' },
          ownerWalletScope: validated.ownerWalletScope,
          ownershipGeneration: validated.ownerWalletScope.ownershipGeneration,
          routerAbEcdsaDerivationNormalSigning: normalSigning,
        },
      };
    }
    case 'operation_step_up': {
      const operation = input.request.operation;
      if (!operation) {
        return failureResult(
          400,
          'invalid_body',
          'Operation step-up pool fill requires operation preparation',
        );
      }
      return authorizeEcdsaPoolFillOperationStepUp({
        ctx: input.ctx,
        authorization: input.request.authorization,
        operation,
        poolFillMaterialActivation: poolFillMaterialActivation(input.request),
        timing: input.timing,
      });
    }
  }
}

function ecdsaPoolFillInitRuntimeRequest(
  request: RouterAbEcdsaPoolFillInitRouteRequest,
): RouterAbEcdsaDerivationPoolFillInitRequest {
  return {
    ...(request.keyHandle === undefined ? {} : { keyHandle: request.keyHandle }),
    ...(request.ecdsaThresholdKeyId === undefined
      ? {}
      : { ecdsaThresholdKeyId: request.ecdsaThresholdKeyId }),
    ...(request.count === undefined ? {} : { count: request.count }),
    ...(request.requestTag === undefined ? {} : { requestTag: request.requestTag }),
    presignSessionId: request.presignSessionId,
    firstMessageB64u: request.firstMessageB64u,
    poolFill: request.poolFill,
  };
}

function ecdsaPoolFillStepRuntimeRequest(
  request: RouterAbEcdsaPoolFillStepRouteRequest,
): RouterAbEcdsaDerivationPoolFillStepRequest {
  return {
    presignSessionId: request.presignSessionId,
    ceremonyExpiresAtMs: request.ceremonyExpiresAtMs,
    materialExpiresAtMs: request.materialExpiresAtMs,
    stage: request.stage,
    ...(request.outgoingMessagesB64u === undefined
      ? {}
      : { outgoingMessagesB64u: request.outgoingMessagesB64u }),
    ...(request.requestTag === undefined ? {} : { requestTag: request.requestTag }),
  };
}
