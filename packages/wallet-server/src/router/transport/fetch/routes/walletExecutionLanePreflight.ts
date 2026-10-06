import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { validateRouterAbEcdsaDerivationWalletSessionInputs } from '../../../auth/commonRouterUtils';
import type { ActiveOwnerWalletExecutionLaneProjection } from '../../../../core/signingLanes/WalletExecutionLaneProjection';
import type { RouterApiWalletRegistrationService } from '../../../framework/authServicePort';
import { extractBearerCredential } from '../../../auth/routerApiKeyAuth';
import { resolveWalletSessionAuthorizationV2Admission } from '../../../domains/signingOperations/walletExecutionAdmission';
import {
  walletSessionFailure,
  walletSessionFailureStatus,
  type WalletSessionFailureCode,
} from '../../../auth/walletSessionFailure';
import type { FetchRouterApiContext } from '../createFetchRouter';
import { json, readJson } from '../../../framework/http';
import {
  mpcMaterialActivationRefsEqual,
  parseMpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import type { MpcMaterialActivationRef, WalletId } from '@shared/utils/domainIds';
import type {
  OwnerLaneParticipantContinuityV1,
  SigningLaneLifecycle,
  WalletKeyLifecycle,
  WalletKeyRecord,
} from '@shared/signing-lanes';
import { isPlainObject } from '@shared/utils/validation';
import {
  EVM_ECDSA_MPC_OPERATION_KINDS,
  NEAR_ED25519_MPC_OPERATION_KINDS,
} from '@shared/authorization/capabilityKinds';

export const OWNER_WALLET_EXECUTION_LANE_PREFLIGHT_PATH = '/wallet/execution-lane/owner';

type OwnerWalletExecutionLanePreflightCurve = 'ed25519' | 'ecdsa_secp256k1';

type OwnerWalletExecutionLanePreflightRequest = {
  readonly curve: OwnerWalletExecutionLanePreflightCurve;
  readonly expectedMaterialActivation: MpcMaterialActivationRef;
};

function parsePreflightRequest(raw: unknown): OwnerWalletExecutionLanePreflightRequest {
  if (!isPlainObject(raw)) throw new Error('owner execution-lane preflight body is required');
  const fields = Object.keys(raw).sort();
  if (fields.length !== 2 || fields[0] !== 'curve' || fields[1] !== 'expectedMaterialActivation') {
    throw new Error('owner execution-lane preflight body fields are invalid');
  }
  if (raw.curve !== 'ed25519' && raw.curve !== 'ecdsa_secp256k1') {
    throw new Error('owner execution-lane preflight curve is invalid');
  }
  const materialActivation = parseMpcMaterialActivationRef(raw.expectedMaterialActivation);
  if (!materialActivation.ok) throw new Error(materialActivation.error.message);
  return {
    curve: raw.curve,
    expectedMaterialActivation: materialActivation.value,
  };
}

function serializeMaterialActivation(value: MpcMaterialActivationRef) {
  return {
    kind: value.kind,
    activationId: value.activationId,
    capability: value.capability,
    materialOwner: value.materialOwner,
    keyBinding: value.keyBinding,
    lifecycleBinding: value.lifecycleBinding,
    signingWorker: value.signingWorker,
  };
}

function serializeWalletKeyLifecycle(value: WalletKeyLifecycle) {
  switch (value.state) {
    case 'active':
      return { state: value.state, activatedAtMs: value.activatedAtMs };
    case 'retired':
      return { state: value.state, retiredAtMs: value.retiredAtMs };
    case 'compromised':
      return { state: value.state, compromisedAtMs: value.compromisedAtMs };
    default:
      value satisfies never;
      return value;
  }
}

function serializeWalletKey(value: WalletKeyRecord) {
  switch (value.keyFamily) {
    case 'ed25519':
      return {
        kind: value.kind,
        keyFamily: value.keyFamily,
        walletId: value.walletId,
        walletKeyId: value.walletKeyId,
        walletKeyVersion: value.walletKeyVersion,
        nearEd25519SigningKeyId: value.nearEd25519SigningKeyId,
        keyCreationSignerSlot: value.keyCreationSignerSlot,
        registeredPublicKeyB64u: value.registeredPublicKeyB64u,
        lifecycle: serializeWalletKeyLifecycle(value.lifecycle),
      };
    case 'ecdsa_secp256k1':
      return {
        kind: value.kind,
        keyFamily: value.keyFamily,
        walletId: value.walletId,
        walletKeyId: value.walletKeyId,
        walletKeyVersion: value.walletKeyVersion,
        evmFamilySigningKeySlotId: value.evmFamilySigningKeySlotId,
        thresholdPublicKey33B64u: value.thresholdPublicKey33B64u,
        evmAddress: value.evmAddress,
        lifecycle: serializeWalletKeyLifecycle(value.lifecycle),
      };
    default:
      value satisfies never;
      return value;
  }
}

function serializeSigningLaneLifecycle(value: SigningLaneLifecycle) {
  switch (value.state) {
    case 'provisioning':
      return {
        state: value.state,
        revocationEpoch: value.revocationEpoch,
        startedAtMs: value.startedAtMs,
      };
    case 'pending_receipt':
      return {
        state: value.state,
        revocationEpoch: value.revocationEpoch,
        startedAtMs: value.startedAtMs,
        deliveryDigestB64u: value.deliveryDigestB64u,
      };
    case 'active':
      return {
        state: value.state,
        revocationEpoch: value.revocationEpoch,
        activatedAtMs: value.activatedAtMs,
        activationReceiptDigestB64u: value.activationReceiptDigestB64u,
      };
    case 'revoked':
      return {
        state: value.state,
        revocationEpoch: value.revocationEpoch,
        revokedAtMs: value.revokedAtMs,
        revokeReason: value.revokeReason,
      };
    default:
      value satisfies never;
      return value;
  }
}

function serializeOwnerContinuity(value: OwnerLaneParticipantContinuityV1) {
  return {
    kind: value.kind,
    signerId: value.signerId,
    participantIds: value.participantIds,
    signingWorkerId: value.signingWorkerId,
    custodyKeyManifestDigestB64u: value.custodyKeyManifestDigestB64u,
    sourceIdentityDigestB64u: value.sourceIdentityDigestB64u,
  };
}

function serializeProjection(value: ActiveOwnerWalletExecutionLaneProjection) {
  const lane = value.lane;
  switch (lane.laneKind) {
    case 'owner_passkey':
    case 'owner_email_otp':
      return {
        kind: value.kind,
        walletKey: serializeWalletKey(value.walletKey),
        lane: {
          kind: lane.kind,
          walletId: lane.walletId,
          walletKeyId: lane.walletKeyId,
          laneId: lane.laneId,
          laneKind: lane.laneKind,
          laneShareEpoch: lane.laneShareEpoch,
          participantBindingDigestB64u: lane.participantBindingDigestB64u,
          walletAuthMethodId: lane.walletAuthMethodId,
          ownerParticipantContinuity: serializeOwnerContinuity(lane.ownerParticipantContinuity),
          lifecycle: serializeSigningLaneLifecycle(lane.lifecycle),
        },
        materialActivation: serializeMaterialActivation(value.materialActivation),
        verifiedActivationReceiptDigestB64u: value.verifiedActivationReceiptDigestB64u,
      };
    default:
      return assertNever(lane);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected owner execution-lane value: ${String(value)}`);
}

function validationFailure(input: {
  readonly code: WalletSessionFailureCode | 'sessions_disabled';
  readonly message: string;
}): Response {
  const status = input.code === 'sessions_disabled' ? 501 : walletSessionFailureStatus(input.code);
  return json({ ok: false, code: input.code, message: input.message }, { status });
}

export async function handleOwnerWalletExecutionLanePreflight(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  if (ctx.method !== 'POST' || ctx.pathname !== OWNER_WALLET_EXECUTION_LANE_PREFLIGHT_PATH) {
    return null;
  }

  let request: OwnerWalletExecutionLanePreflightRequest;
  try {
    request = parsePreflightRequest(await readJson(ctx.request));
  } catch (error: unknown) {
    return json(
      {
        ok: false,
        code: 'invalid_body',
        message:
          error instanceof Error ? error.message : 'owner execution-lane preflight body is invalid',
      },
      { status: 400 },
    );
  }

  const headers = Object.fromEntries(ctx.request.headers.entries());
  type OwnerLaneAuthorization = Parameters<
    RouterApiWalletRegistrationService['resolveActiveOwnerWalletExecutionLane']
  >[0]['authorization'];
  let walletId: WalletId;
  let authorization: OwnerLaneAuthorization;
  if (request.curve === 'ed25519') {
    const service = ctx.service.authorizationSessions;
    if (!service) {
      return validationFailure({ code: 'sessions_disabled', message: 'Sessions are not configured' });
    }
    const token = extractBearerCredential(headers);
    if (!token) return validationFailure(walletSessionFailure('wallet_session_missing'));
    const nowMs = Date.now();
    let context;
    try {
      // Lane metadata remains readable after exhaustion. Signing still requires admission.
      context = await service.readWalletSessionExactOperationContextByCredential({
        tenantId: service.tenantId,
        token,
        nowMs,
      });
    } catch {
      return validationFailure(walletSessionFailure('wallet_session_unavailable'));
    }
    if (!context) return validationFailure(walletSessionFailure('wallet_session_invalid'));
    const session = context.session;
    const admission = resolveWalletSessionAuthorizationV2Admission({
      authorization: session,
      authority: context.authority,
      authMethod: context.authMethod,
      retiredAtMs: context.retiredAtMs,
      nowMs,
      operation: {
        tenantId: service.tenantId,
        principalId: session.principalId,
        walletId: session.walletId,
        keyFamily: 'ed25519',
        operationKind: NEAR_ED25519_MPC_OPERATION_KINDS.signTransaction,
      },
    });
    if (
      !admission.ok ||
      admission.keyFamily !== 'ed25519' ||
      !mpcMaterialActivationRefsEqual(admission.materialActivation, request.expectedMaterialActivation)
    ) {
      return validationFailure(walletSessionFailure('wallet_session_scope_mismatch'));
    }
    walletId = session.walletId;
    authorization = {
      kind: 'wallet_auth_method',
      walletAuthMethodId: session.walletAuthMethodId,
    };
  } else {
    const validated = await validateRouterAbEcdsaDerivationWalletSessionInputs({
      materialActivation: routerAbMpcMaterialActivationRefToWire(request.expectedMaterialActivation),
      headers,
      authorizationSessions: ctx.service.authorizationSessions,
      operationKind: EVM_ECDSA_MPC_OPERATION_KINDS.signTransaction,
    });
    if (!validated.ok) return validationFailure(validated);
    if (validated.kind === 'wallet_session_operation_credential_exhausted_candidate_v1') {
      return validationFailure(walletSessionFailure('wallet_session_unavailable'));
    }
    walletId = validated.admission.context.authorization.session.walletId;
    authorization = {
      kind: 'wallet_auth_method',
      walletAuthMethodId: validated.admission.context.authorization.session.walletAuthMethodId,
    };
  }

  let resolved;
  try {
    resolved = await ctx.service.walletRegistration.resolveActiveOwnerWalletExecutionLane({
      walletId,
      expectedMaterialActivation: request.expectedMaterialActivation,
      authorization,
    });
  } catch {
    return json(
      { ok: false, code: 'internal', message: 'Owner wallet execution-lane preflight failed' },
      { status: 500 },
    );
  }
  if (resolved.kind === 'refused') {
    return json(
      {
        ok: false,
        code: 'wallet_execution_lane_refused',
        reason: resolved.reason,
      },
      { status: 403 },
    );
  }
  if (resolved.projection.walletKey.keyFamily !== request.curve) {
    return json(
      {
        ok: false,
        code: 'wallet_execution_lane_refused',
        reason: 'key_family_mismatch',
      },
      { status: 403 },
    );
  }
  return json({ ok: true, projection: serializeProjection(resolved.projection) }, { status: 200 });
}
