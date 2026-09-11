import { json } from '../../../framework/http';
import type { RouterAbNormalSigningRouterProxy } from '../../../framework/routerApi';
import type { RouterApiWalletRegistrationService } from '../../../framework/authServicePort';
import type { AuthorizedOperation } from '../../../../authorization/domain';
import { prepareOwnerWalletExecution } from '../../../domains/signingOperations/walletExecutionAdmission';
import type { RouterAbNormalSigningMaterialSourceV1 } from '../../../domains/signingOperations/routerAbPrivateSigningWorker';
import { routerAbMpcMaterialActivationRefFromWire } from '@shared/utils/routerAbNormalSigningIdentity';
import type { RouterAbMpcMaterialActivationRefWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  normalizeRouterAbInternalServiceAuthSecret,
  ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
} from '../../../../core/ThresholdService/routerAb/internalServiceHttp';

export const ROUTER_AB_ECDSA_DERIVATION_LINKED_DEVICE_SIGN_PATH =
  '/router-ab/ecdsa-derivation/linked-device/sign' as const;

export async function proxyNormalSigningRequestToMpcRouter(input: {
  readonly request: Request;
  readonly proxy: RouterAbNormalSigningRouterProxy | null | undefined;
  readonly body?: Record<string, unknown>;
  readonly targetPath?: string;
}): Promise<Response> {
  const proxy = input.proxy;
  if (!proxy) {
    return json(
      {
        ok: false,
        code: 'not_configured',
        message: 'MPC Router normal-signing transport is not configured',
      },
      { status: 501 },
    );
  }

  try {
    const headers = new Headers(input.request.headers);
    // Wallet Session bearer tokens are gateway-only credentials. The Router
    // receives the validated owner or linked-device admission in the body.
    if (input.body && parseNormalSigningSessionAdmission(input.body)) {
      headers.delete('authorization');
    }
    headers.set(
      ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
      normalizeRouterAbInternalServiceAuthSecret(proxy.internalServiceAuthSecret),
    );
    const request = input.targetPath
      ? new Request(new URL(input.targetPath, input.request.url), input.request)
      : input.request;
    const upstreamRequest = input.body
      ? new Request(request, {
          body: JSON.stringify(input.body),
          headers,
        })
      : new Request(request, { headers });
    if (input.body) upstreamRequest.headers.set('content-type', 'application/json');
    const upstream = await proxy.fetch(upstreamRequest);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: new Headers(upstream.headers),
    });
  } catch (error: unknown) {
    return json(
      {
        ok: false,
        code: 'router_unreachable',
        message: error instanceof Error ? error.message : 'MPC Router request failed',
      },
      { status: 502 },
    );
  }
}

type NormalSigningSessionAdmissionKind = 'gateway_owner_wallet_session' | 'reusable_wallet_session';

type NormalSigningAuthorizedOperationEnvelopeRecord = {
  readonly binding: unknown;
  readonly authorized_operation: unknown;
};

type NormalSigningReusableBindingRecord = {
  readonly kind: unknown;
  readonly authorization_id: unknown;
  readonly wallet_session_id: unknown;
  readonly quota_id: unknown;
};

type NormalSigningGatewayOwnerBindingRecord = {
  readonly kind: unknown;
  readonly subject_id: unknown;
  readonly account_id: unknown;
  readonly authorization_id: unknown;
  readonly wallet_session_id: unknown;
  readonly quota_id: unknown;
  readonly threshold_session_id: unknown;
  readonly org_id: unknown;
  readonly project_id: unknown;
  readonly environment: unknown;
  readonly signing_worker_id: unknown;
  readonly expires_at_ms: unknown;
};

type NormalSigningReusableReceiptRecord = {
  readonly kind: unknown;
};

function parseNormalSigningSessionAdmission(
  body: Record<string, unknown>,
): NormalSigningSessionAdmissionKind | null {
  const envelope = body.authorized_operation;
  if (!isNormalSigningAuthorizedOperationEnvelopeRecord(envelope)) return null;
  if (!isNormalSigningReusableReceiptRecord(envelope.authorized_operation)) return null;
  if (envelope.authorized_operation.kind !== 'reusable_wallet_session_authorized_operation_v1') {
    return null;
  }
  if (isNormalSigningReusableBindingRecord(envelope.binding)) {
    return isNormalSigningReusableBindingValues(envelope.binding)
      ? 'reusable_wallet_session'
      : null;
  }
  if (!isNormalSigningGatewayOwnerBindingRecord(envelope.binding)) return null;
  return isNormalSigningGatewayOwnerBindingValues(envelope.binding)
    ? 'gateway_owner_wallet_session'
    : null;
}

function isNormalSigningAuthorizedOperationEnvelopeRecord(
  value: unknown,
): value is NormalSigningAuthorizedOperationEnvelopeRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).sort().join('|') === 'authorized_operation|binding';
}

function isNormalSigningReusableBindingRecord(
  value: unknown,
): value is NormalSigningReusableBindingRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).sort().join('|') === 'authorization_id|kind|quota_id|wallet_session_id';
}

function isNormalSigningGatewayOwnerBindingRecord(
  value: unknown,
): value is NormalSigningGatewayOwnerBindingRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    Object.keys(value).sort().join('|') ===
    'account_id|authorization_id|environment|expires_at_ms|kind|org_id|project_id|quota_id|signing_worker_id|subject_id|threshold_session_id|wallet_session_id'
  );
}

function isNormalSigningReusableReceiptRecord(
  value: unknown,
): value is NormalSigningReusableReceiptRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNormalSigningReusableBindingValues(record: NormalSigningReusableBindingRecord): boolean {
  return (
    typeof record.authorization_id === 'string' &&
    record.authorization_id.trim().length > 0 &&
    typeof record.wallet_session_id === 'string' &&
    record.wallet_session_id.trim().length > 0 &&
    typeof record.quota_id === 'string' &&
    record.quota_id.trim().length > 0
  );
}

function isNormalSigningGatewayOwnerBindingValues(
  record: NormalSigningGatewayOwnerBindingRecord,
): boolean {
  return (
    typeof record.subject_id === 'string' &&
    record.subject_id.trim().length > 0 &&
    typeof record.account_id === 'string' &&
    record.account_id.trim().length > 0 &&
    typeof record.authorization_id === 'string' &&
    record.authorization_id.trim().length > 0 &&
    typeof record.wallet_session_id === 'string' &&
    record.wallet_session_id.trim().length > 0 &&
    typeof record.quota_id === 'string' &&
    record.quota_id.trim().length > 0 &&
    typeof record.threshold_session_id === 'string' &&
    record.threshold_session_id.trim().length > 0 &&
    typeof record.org_id === 'string' &&
    record.org_id.trim().length > 0 &&
    typeof record.project_id === 'string' &&
    record.project_id.trim().length > 0 &&
    typeof record.environment === 'string' &&
    record.environment.trim().length > 0 &&
    typeof record.signing_worker_id === 'string' &&
    record.signing_worker_id.trim().length > 0 &&
    typeof record.expires_at_ms === 'number' &&
    Number.isSafeInteger(record.expires_at_ms) &&
    record.expires_at_ms > 0
  );
}

export async function proxyOwnerLaneAdmittedNormalSigningRequest(input: {
  readonly request: Request;
  readonly proxy: RouterAbNormalSigningRouterProxy | null | undefined;
  readonly body: Record<string, unknown>;
  readonly authorizedOperation: AuthorizedOperation;
  readonly walletId: Parameters<
    RouterApiWalletRegistrationService['resolveActiveOwnerWalletExecutionLane']
  >[0]['walletId'];
  readonly expectedMaterialActivation: RouterAbMpcMaterialActivationRefWire;
  readonly authorization: Parameters<
    RouterApiWalletRegistrationService['resolveActiveOwnerWalletExecutionLane']
  >[0]['authorization'];
  readonly walletRegistration: Pick<
    RouterApiWalletRegistrationService,
    'resolveActiveOwnerWalletExecutionLane'
  >;
}): Promise<Response> {
  const expectedMaterialActivation = routerAbMpcMaterialActivationRefFromWire(
    input.expectedMaterialActivation,
  );
  const resolved = await input.walletRegistration.resolveActiveOwnerWalletExecutionLane({
    walletId: input.walletId,
    expectedMaterialActivation,
    authorization: input.authorization,
  });
  if (resolved.kind === 'refused') {
    return json(
      {
        ok: false,
        code: 'wallet_execution_lane_refused',
        message: `Wallet execution lane is unavailable: ${resolved.reason}`,
      },
      { status: 403 },
    );
  }
  const admission = await prepareOwnerWalletExecution({
    authorizedOperation: input.authorizedOperation,
    evidence: {
      walletId: input.walletId,
      walletKey: resolved.projection.walletKey,
      lane: resolved.projection.lane,
      materialActivation: resolved.projection.materialActivation,
      expectedMaterialActivation,
      verifiedLaneParticipantBindingDigestB64u:
        resolved.projection.lane.participantBindingDigestB64u,
      verifiedActivationReceiptDigestB64u: resolved.projection.verifiedActivationReceiptDigestB64u,
    },
  });
  if (admission.kind === 'refused') {
    return json(
      {
        ok: false,
        code: 'wallet_execution_lane_refused',
        message: `Wallet execution lane admission failed: ${admission.reason}`,
      },
      { status: 403 },
    );
  }
  return await proxyNormalSigningRequestToMpcRouter({
    request: input.request,
    proxy: input.proxy,
    body: input.body,
  });
}

/** Forwards a Gateway-admitted rotatable lane source to the private Router. */
export async function proxyRotatableLaneAdmittedNormalSigningRequest(input: {
  readonly request: Request;
  readonly proxy: RouterAbNormalSigningRouterProxy | null | undefined;
  readonly body: Record<string, unknown>;
  readonly materialSource: Extract<
    RouterAbNormalSigningMaterialSourceV1,
    { readonly kind: 'rotatable_lane' }
  >;
  readonly targetPath?: string;
}): Promise<Response> {
  return await proxyNormalSigningRequestToMpcRouter({
    request: input.request,
    proxy: input.proxy,
    body: {
      ...input.body,
      material_source: input.materialSource,
    },
    targetPath: input.targetPath,
  });
}
