import { parseWalletId } from '@shared/utils/domainIds';
import {
  parseRouterAbEd25519YaoReissueActivationExecuteRequestV1,
  parseRouterAbEd25519YaoReissueActivationResultV1,
  parseRouterAbEd25519YaoReissueAdmissionRequestV1,
  ROUTER_AB_ED25519_YAO_REISSUE_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REISSUE_EXECUTE_PATH_V1,
  sameRouterAbEd25519YaoActivationBindingV1,
  sameRouterAbEd25519YaoByteSequence,
  type RouterAbEd25519YaoActivationExecuteRequestV1,
  type RouterAbEd25519YaoReissueAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import { sameRouterAbMpcMaterialActivationRef } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  createRouterAbTraceContextV1,
  parseRouterAbTraceContextV1,
  ROUTER_AB_TRACE_ID_HEADER_V1,
  type RouterAbTraceContextV1,
} from '@shared/utils/routerAbTraceContext';
import { json, jsonFailure, readJson } from '../../../framework/http';
import type { WalletExecutionAuthority } from '../../walletRegistration/walletRegistrationReservation';
import type { RouterAbEd25519YaoRegistrationBackendResult } from '../registration/routerAbEd25519YaoRegistration';
import {
  activeEd25519AdmissionMatchesWalletSession,
  resolveExactEd25519OperationCredentialMaterial,
  type WalletSessionMaterialServicesV1,
} from '../session/walletSessionEd25519Material';
import { routerAbEd25519YaoActivationBindingV1 } from '../routerAbEd25519YaoGatewayEnvelope';

type ReissueExecuteRequest = RouterAbEd25519YaoActivationExecuteRequestV1<'reissue'>;

export type RouterAbEd25519YaoReissueExecuteClaimV1 = {
  readonly admissionRequest: RouterAbEd25519YaoReissueAdmissionRequestV1;
  readonly ownershipGeneration: number;
};

/** Issues a reissue binding and runs the reissue at the Router. */
export interface RouterAbEd25519YaoReissueBackend {
  admitReissue(
    request: RouterAbEd25519YaoReissueAdmissionRequestV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult>;
  executeReissue(
    request: ReissueExecuteRequest,
    claim: RouterAbEd25519YaoReissueExecuteClaimV1,
    traceContext: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult>;
}

type RouterAbEd25519YaoReissueServicesV1 = WalletSessionMaterialServicesV1 & {
  readonly admitEstablishedHome: WalletExecutionAuthority['admitEstablishedHome'];
};

type ActiveReissueIdentity = {
  readonly admissionRequest: RouterAbEd25519YaoReissueAdmissionRequestV1;
  readonly stateEpoch: number;
};

/**
 * Admits or runs one reissue of the active Client share.
 *
 * Both calls need an unexhausted Ed25519 Wallet Session of the wallet, of any
 * factor, and the wallet's active material. The Gateway stores nothing: the
 * execute call checks its binding against the active material again. A
 * reissue never suspends the capability, and the Signing Worker refuses it
 * while a recovery is staged.
 */
export async function handleRouterAbEd25519YaoReissueRequestV1(input: {
  readonly request: Request;
  readonly backend: RouterAbEd25519YaoReissueBackend;
  readonly services: RouterAbEd25519YaoReissueServicesV1;
}): Promise<Response> {
  const pathname = new URL(input.request.url).pathname;
  const body = await readJson(input.request);
  switch (pathname) {
    case ROUTER_AB_ED25519_YAO_REISSUE_ADMISSION_PATH_V1: {
      const parsed = parseRouterAbEd25519YaoReissueAdmissionRequestV1(body);
      if (!parsed.ok) return jsonFailure(400, parsed.code, parsed.message);
      const identity = await authorizeReissue(input, parsed.value);
      if (identity instanceof Response) return identity;
      return backendResponse(await input.backend.admitReissue(identity.admissionRequest));
    }
    case ROUTER_AB_ED25519_YAO_REISSUE_EXECUTE_PATH_V1: {
      const parsed = parseRouterAbEd25519YaoReissueActivationExecuteRequestV1(body);
      if (!parsed.ok) return jsonFailure(400, parsed.code, parsed.message);
      return await executeReissue(input, parsed.value);
    }
    default:
      return jsonFailure(404, 'not_found', 'Not found');
  }
}

async function executeReissue(
  input: Parameters<typeof handleRouterAbEd25519YaoReissueRequestV1>[0],
  request: ReissueExecuteRequest,
): Promise<Response> {
  const trace = parseRouterAbTraceContextV1(
    input.request.headers.get(ROUTER_AB_TRACE_ID_HEADER_V1),
  );
  if (!trace.ok && trace.reason !== 'missing')
    return jsonFailure(400, 'invalid_trace', trace.message);
  const identity = await authorizeReissue(input, null);
  if (identity instanceof Response) return identity;
  const expected = await routerAbEd25519YaoActivationBindingV1(
    identity.admissionRequest,
    'reissue',
    request.binding.session_id,
  );
  if (
    request.binding.session_id.every((byte) => byte === 0) ||
    !sameRouterAbEd25519YaoActivationBindingV1(request.binding, expected)
  ) {
    return scopeMismatch('reissue binding differs from the active material');
  }
  const walletId = parseWalletId(identity.admissionRequest.application_binding.wallet_id);
  if (!walletId.ok) return scopeMismatch('reissue wallet is invalid');
  let home: Awaited<ReturnType<WalletExecutionAuthority['admitEstablishedHome']>>;
  try {
    home = await input.services.admitEstablishedHome({ walletId: walletId.value });
  } catch {
    return jsonFailure(503, 'wallet_home_unavailable', 'Reissue wallet home is unavailable');
  }
  if (!home.ok) return jsonFailure(409, home.code, home.message);
  const executed = await input.backend.executeReissue(
    request,
    { admissionRequest: identity.admissionRequest, ownershipGeneration: home.ownershipGeneration },
    trace.ok ? trace.value : createRouterAbTraceContextV1(),
  );
  if (!executed.ok) return backendResponse(executed);
  const result = parseRouterAbEd25519YaoReissueActivationResultV1(executed.body);
  if (
    !result.ok ||
    !sameRouterAbEd25519YaoActivationBindingV1(result.value.binding, request.binding) ||
    result.value.public_receipt.state_epoch !== identity.stateEpoch ||
    !sameRouterAbMpcMaterialActivationRef(
      result.value.public_receipt.material_activation,
      identity.admissionRequest.scope.material_activation,
    ) ||
    !sameRouterAbEd25519YaoByteSequence(
      result.value.public_receipt.registered_public_key,
      identity.admissionRequest.registered_public_key,
    )
  ) {
    return jsonFailure(
      502,
      'invalid_router_result',
      'Router reissue result differs from the active material',
    );
  }
  return json(result.value, { status: 200 });
}

/**
 * The bearer's active material as a reissue admission request. An admission
 * call must name exactly that material; an execute call names it by binding.
 */
async function authorizeReissue(
  input: Parameters<typeof handleRouterAbEd25519YaoReissueRequestV1>[0],
  stated: RouterAbEd25519YaoReissueAdmissionRequestV1 | null,
): Promise<ActiveReissueIdentity | Response> {
  const resolved = await resolveExactEd25519OperationCredentialMaterial({
    request: input.request,
    services: input.services,
  });
  if (resolved.kind === 'rejected') {
    return jsonFailure(resolved.result.status, resolved.result.code, resolved.result.message);
  }
  const identity = resolved.activeMaterial.exportIdentity;
  const admissionRequest: RouterAbEd25519YaoReissueAdmissionRequestV1 = {
    scope: identity.scope,
    application_binding: identity.application_binding,
    participant_ids: identity.participant_ids,
    registered_public_key: identity.registered_public_key,
  };
  const request = stated ?? admissionRequest;
  if (
    request.scope.lifecycle_id !== identity.scope.lifecycle_id ||
    !sameRouterAbMpcMaterialActivationRef(
      request.scope.material_activation,
      resolved.materialActivation,
    ) ||
    !activeEd25519AdmissionMatchesWalletSession({
      request: { ...request, active_material_activation: request.scope.material_activation },
      ...resolved,
    })
  ) {
    return scopeMismatch('reissue scope differs from the Wallet Session material');
  }
  return { admissionRequest, stateEpoch: identity.state_epoch };
}

function scopeMismatch(message: string): Response {
  return jsonFailure(403, 'wallet_session_scope_mismatch', message);
}

function backendResponse(result: RouterAbEd25519YaoRegistrationBackendResult): Response {
  return result.ok
    ? json(result.body, { status: 200 })
    : jsonFailure(result.status, result.code, result.message);
}
