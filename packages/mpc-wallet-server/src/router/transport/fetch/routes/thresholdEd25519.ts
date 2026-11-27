import {
  resolveEd25519WalletSessionOperation,
  revalidateEd25519StepUpOperation,
} from './ed25519AuthorizedOperationRevalidation';
import { signingPrepareSessionResponse } from '../../../domains/signingOperations/signingPrepareSession';
import type { PinnedOwnerWalletScope } from '../../../../authorization/ecdsaWalletSessionAdmission';
import {
  buildAuthorizedOperationWire,
  type AuthorizedOperationBindingWire,
  type AuthorizedOperationWireInput,
  type OperationStepUpBinding,
} from '../../../domains/signingOperations/authorizedOperationWire';
import { requireAuthorizationValue } from '../../../domains/signingOperations/routerAbNormalSigningAdmission';
import type { FetchRouterApiContext } from '../createFetchRouter';
import { json, jsonFailure } from '../../../framework/http';
import {
  emptySigningGatewayTiming,
  gatewayOwnerWalletSessionBinding,
  jsonObjectOrEmpty,
  normalSigningAuthorizationRequest,
  operationStepUpAdmissionRefusal,
  operationStepUpBinding,
  ownerOperationNotAuthorizedResponse,
  readPinnedStepUpWalletScope,
  readThresholdRouteBody,
  reusableWalletSession,
  withServerTiming,
  type SigningGatewayTiming,
} from './thresholdSigningRouteShared';
import { webAuthnCredentialIdB64uFromCredential } from '../../../auth/webAuthnCredentialCodecs';
import { thresholdEd25519StatusCode } from '../../../../threshold/statusCodes';
import {
  ROUTER_AB_ED25519_HEALTH_PATH,
  ROUTER_AB_ED25519_NORMAL_SIGNING_PATH,
  ROUTER_AB_ED25519_NORMAL_SIGNING_PREPARE_PATH,
  ROUTER_AB_ED25519_WALLET_SESSION_PATH,
} from '@shared/utils/signingSessionSeal';
import {
  resolveThresholdRuntimePolicyScope,
} from '../../../auth/commonRouterUtils';
import { normalizeCorsOrigin } from '../../../../core/SessionService';
import { buildRouterAbEd25519PrivateSigningWorkerBody } from '../../../domains/signingOperations/routerAbPrivateSigningWorker';
import {
  authenticateRouterAbWalletOperationStepUpIdentity,
  operationStepUpFactorExpiredResponse,
} from '../../../domains/signingOperations/routerAbOperationStepUp';
import {
  checkSigningRequestVoiceVerdict,
  splitVoiceVerdict,
} from '../../../domains/speakToSign/voiceVerdictAdmission';
import {
  authorizeRouterAbEd25519NormalSigningRoute,
  buildRouterAbEd25519OwnerOperationStepUpPreparation,
  decideRouterAbEd25519OwnerOperationAuthorization,
  routerAbEd25519OwnerOperationFailureResult,
  parseRouterAbEd25519OperationStepUpScope,
  parseRouterAbOperationStepUpOperation,
  type RouterAbEd25519NormalSigningRoutePhase,
} from '../../../domains/signingOperations/routerAbEd25519NormalSigningRoute';
import {
  parseThresholdEd25519OperationStepUpGrantRequest,
  parseThresholdEd25519SessionRouteRequest,
} from '../../../domains/ed25519Yao/session/thresholdEd25519RequestValidation';
import {
  isPasskeyWalletAuthAuthority,
  walletAuthAuthorityRef,
  type PasskeyWalletAuthAuthority,
} from '@shared/utils/walletAuthAuthority';
import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { base64UrlEncode } from '@shared/utils/encoders';
import { isPlainObject } from '@shared/utils/validation';
import {
  sameRouterAbMpcMaterialActivationRef,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseAuthorizationAuditEventId,
  buildAuthorizationGrantRef,
  parseAuthFactorId,
  parseAuthorizedOperationId,
  parseCapabilityId,
  parseCapabilityOperationId,
  parseAuthorizationEvidenceId,
  parseAuthorizationEvidenceSetId,
  parsePrincipalId,
} from '@shared/authorization/capabilityKinds';
import {
  buildCapabilityOperationEnvelope,
  computeCapabilityOperationFingerprintDigest,
  parseCapabilityOperationFingerprintDigest,
  parseSigningOperationFingerprintDigest,
} from '@shared/authorization/operationFingerprint';
import {
  authorizedOperationReplayBodyInit,
  type AuthorizedOperation,
} from '../../../../authorization/domain';
import {
  buildVerifiedWalletOperationEmailOtpFactorResult,
  buildVerifiedWalletOperationPasskeyFactorResult,
  buildVerifiedWalletSessionPasskeyFactorResult,
  type VerifiedWalletOperationFactorResult,
} from '../../../../authorization/factorEvidence';
import { parseSessionOrigin, parseVerifiedOwnerProofId } from '../../../../authorization/domain';
import type {
  RouterAbEd25519YaoBudgetRefreshRequestV1,
  RouterAbEd25519YaoBudgetRefreshAuthorizationV1,
  RouterAbEd25519YaoOperationStepUpGrantCommandV1,
  RouterAbEd25519YaoSessionRouteCommandV1,
} from '../../../domains/ed25519Yao/session/routerAbEd25519YaoWalletSession';
import {
  proxyNormalSigningRequestToMpcRouter,
  proxyOwnerLaneAdmittedNormalSigningRequest,
} from './normalSigningRouterProxy';
import {
  parseEmailOtpChallengeId,
  parseOrgId,
  parseProviderSubject,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
} from '@shared/utils/domainIds';
import {
  EMAIL_OTP_CHANNEL,
  WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
} from '@shared/utils/emailOtpDomain';
import { walletIdFromString } from '@shared/utils/registrationIds';
import {
  sameRuntimePolicyScope,
  type RuntimePolicyScope,
} from '@shared/threshold/signingRootScope';
import {
  emailOtpStatusCode,
  hashEmailOtpOperationBinding,
} from '../../../domains/emailOtp/emailOtpSessionRouteHelpers';
import {
  evaluateEmailOtpFactorForDevice,
  selectEmailOtpDeviceFactor,
} from '../../../domains/emailOtp/emailOtpRouteHandlers';
import type { RouterAbEd25519YaoOperationStepUpMaterialRecoveryResponse } from '../../../domains/ed25519Yao/session/routerAbEd25519YaoWalletSession';
import type { RouterApiWalletAuthMethodService } from '../../../framework/authServicePort';
import {
  parseEd25519ReusableAuthorizedOperationReceipt,
  parseEd25519VerifiedStepUpAuthorizedOperationReceipt,
  requireEd25519OperationKind,
  type Ed25519VerifiedStepUpAuthorizedOperationReceipt,
  type Ed25519ReusableAuthorizedOperationReceipt,
} from '../../../domains/signingOperations/ed25519AuthorizedOperationReceipt';

type Ed25519AuthorizedOperationAdmission =
  | {
      readonly kind: 'claimed';
      readonly operation: AuthorizedOperation;
      readonly ownerScope: PinnedOwnerWalletScope;
      readonly receipt: Ed25519ReusableAuthorizedOperationReceipt;
    }
  | {
      readonly kind: 'operation_in_progress';
      readonly operation: AuthorizedOperation;
    }
  | {
      readonly kind: 'replayed';
      readonly operation: AuthorizedOperation;
    };

async function resolveActiveEd25519OperationStepUpAuthority(
  walletAuthMethods: RouterApiWalletAuthMethodService,
  proof: RouterAbEd25519YaoOperationStepUpGrantCommandV1['proof'],
) {
  switch (proof.kind) {
    case 'passkey': {
      const verified = await walletAuthMethods.verifyActivePasskeyAuthority(proof.authority);
      return verified.ok ? { ok: true as const, authority: proof.authority } : verified;
    }
    case 'email_otp':
      return await walletAuthMethods.resolveActiveEmailOtpAuthorityForVerifiedMethod({
        walletId: proof.authorityRef.walletId,
        walletAuthMethodId: proof.authorityRef.walletAuthMethodId,
        providerUserId: proof.providerSubjectId,
      });
    default:
      proof satisfies never;
      throw new Error('Unsupported Ed25519 operation step-up proof');
  }
}

type AcceptedEd25519WalletSessionAuthorization =
  | Extract<
      Awaited<ReturnType<typeof authorizeRouterAbEd25519NormalSigningRoute>>,
      {
        readonly ok: true;
        readonly kind: 'wallet_session_operation_credential_v1';
      }
    >
  | Extract<
      Awaited<ReturnType<typeof authorizeRouterAbEd25519NormalSigningRoute>>,
      {
        readonly ok: true;
        readonly kind: 'wallet_session_operation_credential_exhausted_candidate_v1';
      }
    >;

function ed25519ReusableWalletSessionIdentity(
  authorization: AcceptedEd25519WalletSessionAuthorization,
) {
  const session = reusableWalletSession(authorization);
  return {
    tenantId: session.tenantId,
    principalId: session.principalId,
    walletSessionId: session.walletSessionId,
    authorizationId: session.authorizationId,
    quotaId: session.quotaId,
  };
}

/** The Router binding for a reusable Wallet Session operation, in the scope its admission pinned. */
function ed25519GatewayOwnerWalletSessionBinding(
  authorization: AcceptedEd25519WalletSessionAuthorization,
  pinned: PinnedOwnerWalletScope,
) {
  const runtimePolicyScope = authorization.activeMaterial.runtimePolicyScope;
  if (
    pinned.orgId !== runtimePolicyScope.orgId ||
    pinned.projectId !== runtimePolicyScope.projectId
  ) {
    throw new Error('Pinned owner Wallet Session scope differs from active material');
  }
  return gatewayOwnerWalletSessionBinding({
    session: reusableWalletSession(authorization),
    pinned,
    runtimePolicyScope,
    thresholdSessionId: authorization.activeMaterial.exportIdentity.scope.threshold_session_id,
    signingWorkerId: authorization.activeMaterial.signingWorkerId,
  });
}

async function ed25519OperationStepUpBinding(
  ctx: FetchRouterApiContext,
  session: {
    readonly sessionId: string;
    readonly principalId: string;
    readonly walletId: string;
    readonly runtimePolicyScope: RuntimePolicyScope;
  },
  operation: AuthorizedOperation,
): Promise<OperationStepUpBinding> {
  const pinned = await readPinnedStepUpWalletScope(
    ctx,
    requireAuthorizationValue(parseWalletId(session.walletId)),
    session.runtimePolicyScope,
    operation,
  );
  return operationStepUpBinding(session, pinned);
}

type RouterAbEd25519AuthorizedOperationWire = {
  readonly binding: AuthorizedOperationBindingWire;
  readonly authorized_operation:
    | Ed25519ReusableAuthorizedOperationReceipt
    | (Ed25519VerifiedStepUpAuthorizedOperationReceipt & {
        readonly evidence_set_digest: string;
      });
};


function buildRouterAbEd25519AuthorizedOperationWire(
  input: AuthorizedOperationWireInput,
): RouterAbEd25519AuthorizedOperationWire {
  const operation = input.operation;
  const operationRef = operation.operation.operation;
  if (operationRef.capabilityKind !== 'near_ed25519_mpc_signing') {
    throw new Error('Ed25519 authorized operation capability is invalid');
  }
  return buildAuthorizedOperationWire(input, {
    capability_kind: 'near_ed25519_mpc_signing',
    operation_kind: requireEd25519OperationKind(operationRef.operationKind),
  });
}

type EmailOtpFactorEvaluationRequest = {
  readonly enrollment: {
    readonly enrollmentId: string;
    readonly enrollmentSealKeyVersion: string;
  };
  readonly factor: {
    readonly factorNonceB64u: string;
    readonly wrappedFactorB64u: string;
  };
  readonly blindedElementB64u: string;
};

type PasskeyEd25519AuthorizationResult =
  | {
      ok: true;
      authorization: Extract<
        RouterAbEd25519YaoBudgetRefreshAuthorizationV1,
        { kind: 'verified_passkey_assertion_router_ab_ed25519_yao_budget_refresh_v1' }
      >;
    }
  | { ok: false; response: Response };

async function validatePasskeyEd25519SessionAuthorization(input: {
  ctx: FetchRouterApiContext;
  request: RouterAbEd25519YaoSessionRouteCommandV1;
  authority: PasskeyWalletAuthAuthority;
}): Promise<PasskeyEd25519AuthorizationResult> {
  const credential = input.request.routeAuth;
  if (credential.kind !== 'passkey') {
    throw new Error('validatePasskeyEd25519SessionAuthorization requires passkey route auth');
  }
  const credentialId = webAuthnCredentialIdB64uFromCredential(credential.webauthnAuthentication);
  if (
    !credentialId.ok ||
    credentialId.credentialIdB64u !== input.authority.factor.credentialIdB64u
  ) {
    return {
      ok: false,
      response: jsonFailure(
        401,
        'unauthorized',
        'WebAuthn proof does not match the active Ed25519 Wallet Session authority',
      ),
    };
  }
  const expectedOrigin = normalizeCorsOrigin(input.ctx.request.headers.get('origin') || undefined);
  if (!expectedOrigin) {
    return {
      ok: false,
      response: jsonFailure(
        400,
        'invalid_body',
        'expected_origin is required for WebAuthn authentication verification',
      ),
    };
  }
  const expectedChallenge = base64UrlEncode(
    await sha256BytesUtf8(alphabetizeStringify(input.request.sessionPolicy)),
  );
  const verified = await input.ctx.service.webAuthn.verifyWebAuthnAuthenticationLite({
    userId: input.authority.walletId,
    rpId: input.authority.verifier.rpId,
    expectedChallenge,
    expected_origin: expectedOrigin,
    webauthn_authentication: credential.webauthnAuthentication,
  });
  if (verified.success && verified.verified) {
    const authorityRef = await walletAuthAuthorityRef({ authority: input.authority });
    const verifiedAtMs = Date.now();
    const proof = await input.ctx.service.authorizedOperations.buildVerifiedOwnerProof({
      purpose: 'wallet_session',
      proofId: parseVerifiedOwnerProofId(`ed25519-refresh:${expectedChallenge}`),
      factor: buildVerifiedWalletSessionPasskeyFactorResult({
        tenantId: input.ctx.service.authorizationSessions.tenantId,
        principalId: requireAuthorizationValue(parsePrincipalId(input.authority.walletId)),
        walletId: requireAuthorizationValue(parseWalletId(input.authority.walletId)),
        authorityRef,
        requestOrigin: parseSessionOrigin(expectedOrigin),
        audience: parseSessionOrigin(expectedOrigin),
        factorId: requireAuthorizationValue(
          parseAuthFactorId(`passkey:${credentialId.credentialIdB64u}`),
        ),
        credentialIdB64u: requireAuthorizationValue(
          parseWebAuthnCredentialIdB64u(credentialId.credentialIdB64u),
        ),
        assertionDigest: parseDigestB64u(
          base64UrlEncode(
            await sha256BytesUtf8(alphabetizeStringify(credential.webauthnAuthentication)),
          ),
        ),
        verifiedAtMs,
        expiresAtMs: verifiedAtMs + 60_000,
      }),
    });
    if (proof.purpose !== 'wallet_session') throw new Error('Owner proof purpose is invalid');
    return {
      ok: true,
      authorization: {
        kind: 'verified_passkey_assertion_router_ab_ed25519_yao_budget_refresh_v1',
        authority: input.authority,
        proof,
        verifiedChallengeId: expectedChallenge,
      },
    };
  }
  return {
    ok: false,
    response: jsonFailure(
      401,
      verified.code || 'not_verified',
      verified.message || 'WebAuthn authentication verification failed',
    ),
  };
}

function digestWireB64u(value: unknown, label: string): string {
  const record = isPlainObject(value) ? value : null;
  const bytes = Array.isArray(record?.bytes) ? record.bytes.map(Number) : [];
  if (
    bytes.length !== 32 ||
    !bytes.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
  ) {
    throw new Error(`${label} must contain exactly 32 bytes`);
  }
  return base64UrlEncode(Uint8Array.from(bytes));
}

async function authorizeEd25519ReusableWalletSessionOperation(input: {
  ctx: FetchRouterApiContext;
  body: Record<string, unknown>;
  authorization: AcceptedEd25519WalletSessionAuthorization;
}): Promise<
  | {
      readonly ok: true;
      readonly admission: Ed25519AuthorizedOperationAdmission;
    }
  | { readonly ok: false; readonly response: Response }
> {
  try {
    const scope = parseRouterAbEd25519OperationStepUpScope(input.body.scope);
    if (scope.authorization.kind !== 'reusable_wallet_session') {
      throw new Error('Reusable Wallet Session authority is required');
    }
    const operation = parseRouterAbOperationStepUpOperation(input.body.intent);
    if (!operation.ok) throw new Error(operation.message);
    const intent = isPlainObject(input.body.intent) ? input.body.intent : null;
    if (!intent) throw new Error('Ed25519 normal-signing intent is required');
    const session = reusableWalletSession(input.authorization);
    const privateBody = await buildRouterAbEd25519PrivateSigningWorkerBody({
      phase: 'prepare',
      body: input.body,
      authorization: {
        kind: 'wallet_session_operation_credential_v1',
        walletSessionId: String(session.walletSessionId),
        principalId: String(session.principalId),
        runtimePolicyScope: input.authorization.activeMaterial.runtimePolicyScope,
      },
      headers: Object.fromEntries(input.ctx.request.headers.entries()),
    });
    if (!('admission_candidate' in privateBody)) {
      throw new Error('Ed25519 normal-signing prepare admission is required');
    }
    const identity = ed25519ReusableWalletSessionIdentity(input.authorization);
    const nowMs = Date.now();
    if (
      identity.tenantId !== input.ctx.service.authorizedOperations.tenantId ||
      identity.tenantId !== input.ctx.service.authorizationSessions.tenantId ||
      scope.authorization.wallet_session_id !== identity.walletSessionId
    ) {
      return {
        ok: false,
        response: jsonFailure(403, 'wallet_session_mismatch', 'Wallet Session changed'),
      };
    }
    const capabilityId = requireAuthorizationValue(
      parseCapabilityId(scope.material_activation.capability),
    );
    const laneDigest = parseSigningOperationFingerprintDigest(intent.operation_fingerprint);
    const intentDigest = parseDigestB64u(
      base64UrlEncode(Uint8Array.from(privateBody.admission_candidate.intent_digest.bytes)),
    );
    const displayDigest = parseDigestB64u(
      digestWireB64u(input.body.display_digest, 'display_digest'),
    );
    const envelope = buildCapabilityOperationEnvelope({
      tenantId: identity.tenantId,
      principalId: identity.principalId,
      capabilityId,
      operationId: operation.operationId,
      operation: operation.operation,
      digests: { laneDigest, intentDigest, displayDigest },
    });
    const authorizedOperationId = requireAuthorizationValue(
      parseAuthorizedOperationId(`ed25519-operation:${operation.operationId}:${scope.request_id}`),
    );
    const outcome =
      await input.ctx.service.authorizedOperations.admitEd25519WalletSessionOperation({
        operation: {
          tenantId: identity.tenantId,
          authorizedOperationId,
          auditEventId: requireAuthorizationValue(
            parseAuthorizationAuditEventId(`ed25519-operation-audit:${operation.operationId}`),
          ),
          operation: envelope,
          authorization: {
            kind: 'authorization_grant',
            authorizationGrantRef: buildAuthorizationGrantRef(identity.authorizationId),
          },
          quota: { kind: 'consume_reusable_wallet_session', quotaId: identity.quotaId },
          claimedAtMs: nowMs,
        },
        walletId: session.walletId,
      });
    if (
      outcome.kind !== 'claimed' &&
      outcome.kind !== 'operation_in_progress' &&
      outcome.kind !== 'replayed'
    ) {
      const stepUpMaterial =
        await input.ctx.service.walletRegistration.resolveEd25519MaterialActivation({
          walletId: scope.account_id,
          materialActivation: scope.material_activation,
        });
      const stepUp = stepUpMaterial.ok
        ? (buildRouterAbEd25519OwnerOperationStepUpPreparation({
            scope,
            body: input.body,
            material: stepUpMaterial,
          }) ?? undefined)
        : undefined;
      const failure = routerAbEd25519OwnerOperationFailureResult({
        status: outcome.kind === 'authorization_grant_rejected' ? 403 : 409,
        code: outcome.kind,
        message: 'Ed25519 authorized operation rejected',
        phase: 'prepare',
        stepUp,
      });
      return {
        ok: false,
        response: json(failure.body, { status: failure.status }),
      };
    }
    if (outcome.kind === 'operation_in_progress' || outcome.kind === 'replayed') {
      return {
        ok: true,
        admission: {
          kind: outcome.kind,
          operation: outcome.operation,
        },
      };
    }
    return {
      ok: true,
      admission: {
        kind: 'claimed',
        operation: outcome.operation,
        ownerScope: outcome.ownerScope,
        receipt: {
          kind: 'reusable_wallet_session_authorized_operation_v1',
          authorized_operation_id: outcome.operation.authorizedOperationId,
          operation_id: outcome.operation.operation.operationId,
          capability_kind: 'near_ed25519_mpc_signing',
          operation_kind: requireEd25519OperationKind(
            outcome.operation.operation.operation.operationKind,
          ),
          lane_digest_b64u: laneDigest,
          intent_digest_b64u: intentDigest,
          display_digest_b64u: displayDigest,
          operation_fingerprint_digest: outcome.operation.operationFingerprintDigest,
        },
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      response: jsonFailure(
        400,
        'invalid_body',
        error instanceof Error ? error.message : 'Ed25519 authorized operation is invalid',
      ),
    };
  }
}

async function validateEd25519ReusableAuthorizedOperation(input: {
  ctx: FetchRouterApiContext;
  body: Record<string, unknown>;
  authorization: AcceptedEd25519WalletSessionAuthorization;
}): Promise<
  | {
      readonly ok: true;
      readonly receipt: Ed25519ReusableAuthorizedOperationReceipt;
      readonly operation: AuthorizedOperation;
      /** Absent for a completed operation, which replays its stored response. */
      readonly ownerScope: PinnedOwnerWalletScope | null;
    }
  | { readonly ok: false; readonly response: Response }
> {
  try {
    const receipt = parseEd25519ReusableAuthorizedOperationReceipt(input.body.authorized_operation);
    const scope = parseRouterAbEd25519OperationStepUpScope(input.body.scope);
    if (scope.authorization.kind !== 'reusable_wallet_session') {
      throw new Error('Reusable Wallet Session authority is required');
    }
    const identity = ed25519ReusableWalletSessionIdentity(input.authorization);
    const capabilityId = requireAuthorizationValue(
      parseCapabilityId(scope.material_activation.capability),
    );
    const operationId = requireAuthorizationValue(parseCapabilityOperationId(receipt.operation_id));
    const envelope = buildCapabilityOperationEnvelope({
      tenantId: identity.tenantId,
      principalId: identity.principalId,
      capabilityId,
      operationId,
      operation: {
        capabilityKind: 'near_ed25519_mpc_signing',
        operationKind: receipt.operation_kind,
      },
      digests: {
        laneDigest: parseDigestB64u(receipt.lane_digest_b64u),
        intentDigest: parseDigestB64u(receipt.intent_digest_b64u),
        displayDigest: parseDigestB64u(receipt.display_digest_b64u),
      },
    });
    const fingerprint = await computeCapabilityOperationFingerprintDigest(envelope);
    if (
      fingerprint !==
      parseCapabilityOperationFingerprintDigest(receipt.operation_fingerprint_digest)
    ) {
      throw new Error('Ed25519 authorized operation fingerprint changed');
    }
    const prepareBinding = isPlainObject(input.body.prepare_binding)
      ? input.body.prepare_binding
      : null;
    if (
      digestWireB64u(prepareBinding?.intent_digest, 'prepare_binding.intent_digest') !==
      receipt.intent_digest_b64u
    ) {
      throw new Error('Ed25519 authorized operation intent changed after prepare');
    }
    const authorizedOperationId = requireAuthorizationValue(
      parseAuthorizedOperationId(receipt.authorized_operation_id),
    );
    // One read finds the prepared operation, checks its grant and pins its scope.
    let resolved: Awaited<ReturnType<typeof resolveEd25519WalletSessionOperation>>;
    try {
      resolved = await resolveEd25519WalletSessionOperation({
        ctx: input.ctx,
        tenantId: identity.tenantId,
        authorizedOperationId,
        operationFingerprintDigest: fingerprint,
        walletId: reusableWalletSession(input.authorization).walletId,
      });
    } catch {
      return {
        ok: false,
        response: jsonFailure(500, 'internal', 'Authorized operation lookup failed'),
      };
    }
    if (!resolved.ok) return resolved;
    const operationResult = resolved.operation;
    if (
      operationResult.tenantId !== identity.tenantId ||
      operationResult.tenantId !== input.ctx.service.authorizedOperations.tenantId ||
      operationResult.operationFingerprintDigest !== fingerprint ||
      operationResult.operation.operationId !== operationId ||
      operationResult.operation.digests.laneDigest !== envelope.digests.laneDigest ||
      operationResult.operation.digests.intentDigest !== envelope.digests.intentDigest ||
      operationResult.operation.digests.displayDigest !== envelope.digests.displayDigest ||
      operationResult.operation.operation.capabilityKind !== 'near_ed25519_mpc_signing' ||
      operationResult.operation.operation.operationKind !== receipt.operation_kind
    ) {
      throw new Error('Ed25519 authorized operation identity changed after prepare');
    }
    return { ok: true, receipt, operation: operationResult, ownerScope: resolved.ownerScope };
  } catch (error: unknown) {
    return {
      ok: false,
      response: jsonFailure(
        400,
        'invalid_authorized_operation',
        error instanceof Error ? error.message : 'Authorized operation is invalid',
      ),
    };
  }
}

function buildEd25519VerifiedStepUpAuthorizedOperationReceipt(input: {
  authorization: Extract<
    Awaited<ReturnType<typeof authorizeRouterAbEd25519NormalSigningRoute>>,
    {
      readonly ok: true;
      readonly kind: 'operation_step_up';
      readonly phase: 'prepare';
    }
  >;
}): Ed25519VerifiedStepUpAuthorizedOperationReceipt {
  const { operation, operationDigests } = input.authorization;
  if (operation.authorization.kind !== 'verified_step_up') {
    throw new Error('Verified step-up authorization is required');
  }
  return {
    kind: 'verified_step_up_authorized_operation_v1',
    authorization_session_id: input.authorization.session.sessionId,
    evidence_set_digest: operation.authorization.evidenceSetDigest,
    authorized_operation_id: operation.authorizedOperationId,
    operation_id: operation.operation.operationId,
    capability_kind: 'near_ed25519_mpc_signing',
    operation_kind: requireEd25519OperationKind(operation.operation.operation.operationKind),
    lane_digest_b64u: operationDigests.laneDigest,
    intent_digest_b64u: operationDigests.intentDigest,
    display_digest_b64u: operationDigests.displayDigest,
    operation_fingerprint_digest: operation.operationFingerprintDigest,
  };
}

async function validateEd25519VerifiedStepUpAuthorizedOperation(input: {
  ctx: FetchRouterApiContext;
  body: Record<string, unknown>;
  authorization: Extract<
    Awaited<ReturnType<typeof authorizeRouterAbEd25519NormalSigningRoute>>,
    {
      readonly ok: true;
      readonly kind: 'operation_step_up';
      readonly phase: 'finalize';
    }
  >;
}): Promise<
  | {
      readonly ok: true;
      readonly receipt: Ed25519VerifiedStepUpAuthorizedOperationReceipt;
      readonly operation: AuthorizedOperation;
    }
  | { readonly ok: false; readonly response: Response }
> {
  try {
    const receipt = parseEd25519VerifiedStepUpAuthorizedOperationReceipt(
      input.body.authorized_operation,
    );
    const scope = parseRouterAbEd25519OperationStepUpScope(input.body.scope);
    if (scope.authorization.kind !== 'operation_step_up') {
      throw new Error('Operation step-up authority is required');
    }
    if (receipt.authorization_session_id !== input.authorization.session.sessionId) {
      throw new Error('Operation step-up authorization changed after prepare');
    }
    const envelope = buildCapabilityOperationEnvelope({
      tenantId: input.authorization.session.tenantId,
      principalId: input.authorization.session.principalId,
      capabilityId: requireAuthorizationValue(
        parseCapabilityId(scope.material_activation.capability),
      ),
      operationId: requireAuthorizationValue(parseCapabilityOperationId(receipt.operation_id)),
      operation: {
        capabilityKind: 'near_ed25519_mpc_signing',
        operationKind: receipt.operation_kind,
      },
      digests: {
        laneDigest: parseDigestB64u(receipt.lane_digest_b64u),
        intentDigest: parseDigestB64u(receipt.intent_digest_b64u),
        displayDigest: parseDigestB64u(receipt.display_digest_b64u),
      },
    });
    const fingerprint = await computeCapabilityOperationFingerprintDigest(envelope);
    if (
      fingerprint !==
      parseCapabilityOperationFingerprintDigest(receipt.operation_fingerprint_digest)
    ) {
      throw new Error('Operation step-up authorized operation fingerprint changed');
    }
    const prepareBinding = isPlainObject(input.body.prepare_binding)
      ? input.body.prepare_binding
      : null;
    if (
      digestWireB64u(prepareBinding?.intent_digest, 'prepare_binding.intent_digest') !==
      receipt.intent_digest_b64u
    ) {
      throw new Error('Operation step-up intent changed after prepare');
    }
    const operationResult = await input.ctx.service.authorizedOperations.readAuthorizedOperation({
      tenantId: input.authorization.session.tenantId,
      operationFingerprintDigest: fingerprint,
    });
    if (!operationResult) {
      return {
        ok: false,
        response: jsonFailure(
          409,
          'authorized_operation_missing',
          'Authorized operation is unavailable',
        ),
      };
    }
    if (
      operationResult.authorizedOperationId !==
        requireAuthorizationValue(parseAuthorizedOperationId(receipt.authorized_operation_id)) ||
      operationResult.operationFingerprintDigest !== fingerprint
    ) {
      throw new Error('Operation step-up authorized operation identity changed after prepare');
    }
    if (
      operationResult.authorization.kind !== 'verified_step_up' ||
      operationResult.authorization.evidenceSetDigest !==
        parseDigestB64u(receipt.evidence_set_digest)
    ) {
      throw new Error('Operation step-up evidence changed after prepare');
    }
    const revalidated = await revalidateEd25519StepUpOperation({
      ctx: input.ctx,
      operation: operationResult,
    });
    return revalidated.ok ? { ok: true, receipt, operation: revalidated.operation } : revalidated;
  } catch (error: unknown) {
    return {
      ok: false,
      response: jsonFailure(
        400,
        'invalid_authorized_operation',
        error instanceof Error ? error.message : 'Authorized operation is invalid',
      ),
    };
  }
}

/**
 * Records the SigningWorker's response as the operation's result and answers
 * with the stored readback. Completion readback is the authority for a
 * terminal response: a claimed operation must never fall back to the live
 * upstream response after the completion write, since that would make
 * retries non-idempotent.
 */
async function completeEd25519Operation(input: {
  readonly ctx: FetchRouterApiContext;
  readonly timing: SigningGatewayTiming;
  readonly operation: AuthorizedOperation;
  readonly result: 'succeeded' | 'failed_before_side_effect' | 'failed_after_side_effect';
  readonly upstream: Response;
  readonly bodyText: string;
}): Promise<Response> {
  const completed = await timeEd25519SigningStage(
    input.timing,
    'complete',
    input.ctx.service.authorizedOperations.completeAuthorizedOperation({
      operation: input.operation,
      result: input.result,
      response: {
        status: input.upstream.status,
        contentType: input.upstream.headers.get('content-type') || 'application/json',
        bodyText: input.bodyText,
      },
      completedAtMs: Date.now(),
    }),
  );
  const replay = replayCompletedEd25519Operation(completed);
  if (!replay) throw new Error('Ed25519 operation completion readback is not completed');
  return replay;
}

function replayCompletedEd25519Operation(operation: AuthorizedOperation): Response | null {
  if (operation.lifecycle !== 'completed') return null;
  return new Response(authorizedOperationReplayBodyInit(operation.response), {
    status: operation.response.status,
    headers: { 'content-type': operation.response.contentType },
  });
}

type Ed25519NormalSigningExecutionDecision =
  | { readonly kind: 'execute'; readonly operation: AuthorizedOperation }
  | { readonly kind: 'operation_in_progress'; readonly response: Response }
  | { readonly kind: 'replayed'; readonly response: Response };

function decideEd25519NormalSigningExecution(input: {
  readonly phase: RouterAbEd25519NormalSigningRoutePhase;
  readonly admissionKind: 'claimed' | 'operation_in_progress' | 'replayed';
  readonly operation: AuthorizedOperation;
}): Ed25519NormalSigningExecutionDecision {
  if (input.phase === 'finalize') {
    const replay = replayCompletedEd25519Operation(input.operation);
    return replay
      ? { kind: 'replayed', response: replay }
      : { kind: 'execute', operation: input.operation };
  }
  switch (input.admissionKind) {
    case 'claimed':
      return { kind: 'execute', operation: input.operation };
    case 'operation_in_progress':
      return {
        kind: 'operation_in_progress',
        response: jsonFailure(
          409,
          'operation_in_progress',
          'Ed25519 operation is already in progress',
        ),
      };
    case 'replayed': {
      const replay = replayCompletedEd25519Operation(input.operation);
      if (!replay) throw new Error('Ed25519 replayed operation is not completed');
      return { kind: 'replayed', response: replay };
    }
  }
}

type Ed25519OperationStepUpExecutionDecision =
  | { readonly kind: 'execute'; readonly operation: AuthorizedOperation }
  | { readonly kind: 'replay'; readonly response: Response };

function decideEd25519OperationStepUpExecution(input: {
  readonly admissionKind: 'claimed' | 'operation_in_progress' | 'replayed';
  readonly operation: AuthorizedOperation;
}): Ed25519OperationStepUpExecutionDecision {
  if (input.admissionKind === 'replayed') {
    const replay = replayCompletedEd25519Operation(input.operation);
    if (!replay) throw new Error('Ed25519 replayed operation is not completed');
    return { kind: 'replay', response: replay };
  }
  return { kind: 'execute', operation: input.operation };
}

function isRouterAbEd25519OperationInProgressResponse(input: {
  readonly status: number;
  readonly bodyText: string;
}): boolean {
  return (
    input.status === 409 &&
    input.bodyText.includes('ReplayedLocalRequest:') &&
    input.bodyText.includes('SigningWorker normal-signing effect is already in progress')
  );
}

async function issueEd25519OperationStepUpGrant(input: {
  ctx: FetchRouterApiContext;
  request: RouterAbEd25519YaoOperationStepUpGrantCommandV1;
}): Promise<Response> {
  const scope = parseRouterAbEd25519OperationStepUpScope(input.request.normalSigningRequest.scope);
  if (scope.authorization.kind !== 'operation_step_up') {
    return jsonFailure(400, 'invalid_body', 'Operation step-up scope is required');
  }
  const expiresAtMs = Number(input.request.normalSigningRequest.expires_at_ms);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
    return jsonFailure(400, 'invalid_body', 'Operation step-up expiry is invalid');
  }
  if (expiresAtMs <= Date.now()) {
    return jsonFailure(408, 'expired_request', 'Operation step-up request is expired');
  }
  const proof = input.request.proof;
  const activeAuthority = await resolveActiveEd25519OperationStepUpAuthority(
    input.ctx.service.walletAuthMethods,
    proof,
  );
  if (!activeAuthority.ok) {
    return jsonFailure(403, 'scope_mismatch', 'Operation step-up authority is not active');
  }
  const authority = proof.kind === 'passkey' ? proof.authority : activeAuthority.authority;
  const operation = parseRouterAbOperationStepUpOperation(
    input.request.normalSigningRequest.intent,
  );
  if (!operation.ok) {
    return jsonFailure(400, 'invalid_body', operation.message);
  }
  const activeMaterial =
    await input.ctx.service.walletRegistration.resolveEd25519MaterialActivation({
      walletId: scope.account_id,
      materialActivation: scope.material_activation,
    });
  if (!activeMaterial.ok) {
    return jsonFailure(
      activeMaterial.code === 'internal' ? 500 : 403,
      activeMaterial.code === 'internal' ? 'internal' : 'scope_mismatch',
      activeMaterial.code === 'internal'
        ? activeMaterial.message
        : 'Operation step-up scope does not name the active material',
    );
  }
  if (
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      scope.material_activation,
    )
  ) {
    return jsonFailure(
      403,
      'scope_mismatch',
      'Operation step-up scope does not name the active material',
    );
  }
  const authenticated = await authenticateRouterAbWalletOperationStepUpIdentity({
    kind: 'verified_owner_proof',
    headers: Object.fromEntries(input.ctx.request.headers.entries()),
    walletId: scope.account_id,
    materialOwner: scope.material_activation.material_owner,
    operationId: String(operation.operationId),
    authority,
    runtimePolicyScope: activeMaterial.runtimePolicyScope,
    expiresAtMs,
    authorizedOperations: input.ctx.service.authorizedOperations,
  });
  if (!authenticated.ok) {
    return json(authenticated.error.body, { status: authenticated.error.status });
  }
  let privateBody: Awaited<ReturnType<typeof buildRouterAbEd25519PrivateSigningWorkerBody>>;
  try {
    privateBody = await buildRouterAbEd25519PrivateSigningWorkerBody({
      phase: 'prepare',
      body: input.request.normalSigningRequest,
      authorization: { kind: 'operation_step_up', session: authenticated.session },
      headers: Object.fromEntries(input.ctx.request.headers.entries()),
    });
  } catch (error: unknown) {
    return jsonFailure(
      400,
      'invalid_body',
      error instanceof Error ? error.message : 'Operation step-up request is invalid',
    );
  }
  if (!('admission_candidate' in privateBody)) {
    return jsonFailure(400, 'invalid_body', 'Operation step-up prepare is required');
  }
  const intent = input.request.normalSigningRequest.intent;
  if (!isPlainObject(intent)) {
    return jsonFailure(400, 'invalid_body', 'Operation step-up intent is invalid');
  }
  const capabilityId = requireAuthorizationValue(
    parseCapabilityId(scope.material_activation.capability),
  );
  const operationFingerprintDigest = parseSigningOperationFingerprintDigest(
    intent.operation_fingerprint,
  );
  const envelope = buildCapabilityOperationEnvelope({
    tenantId: authenticated.session.tenantId,
    principalId: authenticated.session.principalId,
    capabilityId,
    operationId: operation.operationId,
    operation: operation.operation,
    digests: {
      laneDigest: operationFingerprintDigest,
      intentDigest: parseDigestB64u(
        base64UrlEncode(Uint8Array.from(privateBody.admission_candidate.intent_digest.bytes)),
      ),
      displayDigest: parseDigestB64u(input.request.displayDigest),
    },
  });
  const challengeB64u = await computeCapabilityOperationFingerprintDigest(envelope);
  const authorityRef =
    proof.kind === 'passkey'
      ? await walletAuthAuthorityRef({ authority: proof.authority })
      : proof.authorityRef;
  if (
    authorityRef.walletId !== authenticated.authorityRef.walletId ||
    authorityRef.authorityDigest !== authenticated.authorityRef.authorityDigest ||
    authorityRef.walletId !== authenticated.session.walletId
  ) {
    return jsonFailure(403, 'scope_mismatch', 'Operation step-up authority changed');
  }
  const requestOrigin = authenticated.requestOrigin;
  const requestId = String(scope.request_id);
  const evidenceId = requireAuthorizationValue(
    parseAuthorizationEvidenceId(`evidence:${requestId}`),
  );
  const evidenceSetId = requireAuthorizationValue(
    parseAuthorizationEvidenceSetId(`evidence-set:${requestId}`),
  );
  let factor: VerifiedWalletOperationFactorResult;
  let materialRecovery: RouterAbEd25519YaoOperationStepUpMaterialRecoveryResponse = {
    kind: 'not_requested',
  };
  let pendingFactorRelease: EmailOtpFactorEvaluationRequest | null = null;
  let factorReleaseChallengeId: string | null = null;
  switch (proof.kind) {
    case 'passkey': {
      const credential = proof.webauthnAuthentication;
      const credentialId = webAuthnCredentialIdB64uFromCredential(credential);
      if (
        !credentialId.ok ||
        credentialId.credentialIdB64u !== proof.authority.factor.credentialIdB64u
      ) {
        return jsonFailure(401, 'unauthorized', 'Passkey credential changed');
      }
      const verified = await input.ctx.service.webAuthn.verifyWebAuthnAuthenticationLite({
        userId: authenticated.session.walletId,
        rpId: proof.authority.verifier.rpId,
        expectedChallenge: challengeB64u,
        expected_origin: requestOrigin,
        webauthn_authentication: credential,
      });
      if (!verified.success || !verified.verified) {
        return jsonFailure(
          401,
          verified.code || 'not_verified',
          verified.message || 'WebAuthn authentication verification failed',
        );
      }
      const verifiedAtMs = Date.now();
      if (expiresAtMs <= verifiedAtMs) {
        return operationStepUpFactorExpiredResponse();
      }
      factor = buildVerifiedWalletOperationPasskeyFactorResult({
        tenantId: authenticated.session.tenantId,
        principalId: authenticated.session.principalId,
        walletId: walletIdFromString(authenticated.session.walletId),
        requestOrigin,
        audience: requestOrigin,
        factorId: requireAuthorizationValue(
          parseAuthFactorId(`passkey:${proof.authority.factor.credentialIdB64u}`),
        ),
        authorityRef: authenticated.authorityRef,
        operation: envelope,
        credentialIdB64u: proof.authority.factor.credentialIdB64u,
        assertionDigest: parseDigestB64u(
          base64UrlEncode(await sha256BytesUtf8(alphabetizeStringify(credential))),
        ),
        verifiedAtMs,
        expiresAtMs,
      });
      materialRecovery = { kind: 'not_requested' };
      break;
    }
    case 'email_otp': {
      const operationBinding = await hashEmailOtpOperationBinding({
        walletId: authenticated.session.walletId,
        providerUserId: proof.providerSubjectId,
        orgId: authenticated.session.tenantId,
        operation: WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
        requestOrigin,
        audience: requestOrigin,
        authorityRef: authenticated.authorityRef,
        operationFingerprintDigest,
      });
      const verified = await input.ctx.service.emailOtp.verifyEmailOtpChallenge({
        userId: proof.providerSubjectId,
        walletId: authenticated.session.walletId,
        orgId: authenticated.session.tenantId,
        challengeId: proof.challengeId,
        otpCode: proof.otpCode,
        otpChannel: EMAIL_OTP_CHANNEL,
        ownerProofBindingDigest: operationBinding,
        operation: WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
      });
      if (!verified.ok) {
        return json(verified, { status: verified.code === 'invalid_body' ? 400 : 401 });
      }
      if (input.request.materialRecovery.kind === 'email_otp_factor_evaluation_v1') {
        const enrollment = await input.ctx.service.emailOtp.readActiveEmailOtpEnrollment({
          walletId: authenticated.session.walletId,
          orgId: authenticated.session.tenantId,
          providerUserId: proof.providerSubjectId,
        });
        if (!enrollment.ok) {
          return json(enrollment, { status: emailOtpStatusCode(enrollment.code) });
        }
        const deviceFactor = selectEmailOtpDeviceFactor({
          enrollment: enrollment.enrollment,
          deviceFactors: input.request.materialRecovery.deviceFactors,
        });
        if (!deviceFactor.ok) {
          return json(deviceFactor, { status: emailOtpStatusCode(deviceFactor.code) });
        }
        pendingFactorRelease = {
          enrollment: {
            enrollmentId: enrollment.enrollment.enrollmentId,
            enrollmentSealKeyVersion: enrollment.enrollment.enrollmentSealKeyVersion,
          },
          factor: {
            factorNonceB64u: deviceFactor.factor.factorNonceB64u,
            wrappedFactorB64u: deviceFactor.factor.wrappedFactorB64u,
          },
          blindedElementB64u: deviceFactor.blindedElementB64u,
        };
      }
      const consumed = await input.ctx.service.emailOtp.consumeEmailOtpGrant({
        subject: {
          kind: 'provider_identity',
          orgId: requireAuthorizationValue(parseOrgId(authenticated.session.tenantId)),
          providerSubject: requireAuthorizationValue(parseProviderSubject(proof.providerSubjectId)),
          walletId: walletIdFromString(authenticated.session.walletId),
        },
        loginGrant: verified.loginGrant,
        otpChannel: EMAIL_OTP_CHANNEL,
        operation: WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
      });
      if (!consumed.ok) {
        return json(consumed, { status: consumed.code === 'invalid_body' ? 400 : 401 });
      }
      factorReleaseChallengeId = consumed.challengeId;
      const verifiedAtMs = Date.now();
      const factorExpiresAtMs = Math.min(expiresAtMs, verified.grantExpiresAtMs);
      if (factorExpiresAtMs <= verifiedAtMs) {
        return operationStepUpFactorExpiredResponse();
      }
      factor = buildVerifiedWalletOperationEmailOtpFactorResult({
        tenantId: authenticated.session.tenantId,
        principalId: authenticated.session.principalId,
        walletId: walletIdFromString(authenticated.session.walletId),
        requestOrigin,
        audience: requestOrigin,
        factorId: requireAuthorizationValue(
          parseAuthFactorId(`email_otp:${authority.factor.provider}:${proof.providerSubjectId}`),
        ),
        authorityRef: authenticated.authorityRef,
        operation: envelope,
        challengeId: requireAuthorizationValue(parseEmailOtpChallengeId(consumed.challengeId)),
        verificationReceiptDigest: parseDigestB64u(
          base64UrlEncode(
            await sha256BytesUtf8(
              alphabetizeStringify({
                challengeId: consumed.challengeId,
                operationFingerprint: challengeB64u,
              }),
            ),
          ),
        ),
        verifiedAtMs,
        expiresAtMs: factorExpiresAtMs,
      });
      break;
    }
  }
  const recordedEvidence =
    await input.ctx.service.authorizedOperations.recordVerifiedWalletOperationFactorEvidenceSet({
      operation: envelope,
      evidenceId,
      evidenceSetId,
      factor,
    });
  if (recordedEvidence.kind === 'evidence_conflict') {
    return jsonFailure(
      409,
      'step_up_evidence_conflict',
      'This request already holds other step-up evidence; start a new request',
    );
  }
  const evidenceSet = recordedEvidence.evidenceSet;
  const atomicOperation = await input.ctx.service.authorizedOperations.admitAuthorizedOperation({
    operation: {
      tenantId: authenticated.session.tenantId,
      authorizedOperationId: requireAuthorizationValue(
        parseAuthorizedOperationId(`normal-signing-operation:${scope.request_id}`),
      ),
      auditEventId: requireAuthorizationValue(
        parseAuthorizationAuditEventId(`normal-signing-audit:${scope.request_id}`),
      ),
      operation: envelope,
      authorization: {
        kind: 'verified_step_up',
        evidenceSetDigest: evidenceSet.evidenceSetDigest,
      },
      quota: { kind: 'quota_neutral' },
      claimedAtMs: Date.now(),
    },
  });
  const admissionRefusal = operationStepUpAdmissionRefusal(atomicOperation.kind, 'Ed25519');
  if (admissionRefusal) return admissionRefusal;
  if (pendingFactorRelease) {
    if (!factorReleaseChallengeId) {
      throw new Error('Email OTP factor release challenge is missing after grant consumption');
    }
    const currentEnrollment = await input.ctx.service.emailOtp.readActiveEmailOtpEnrollment({
      walletId: authenticated.session.walletId,
      orgId: authenticated.session.tenantId,
      providerUserId: proof.kind === 'email_otp' ? proof.providerSubjectId : undefined,
    });
    if (!currentEnrollment.ok) {
      return json(currentEnrollment, { status: emailOtpStatusCode(currentEnrollment.code) });
    }
    const pendingFactor = pendingFactorRelease.factor;
    if (
      currentEnrollment.enrollment.enrollmentId !== pendingFactorRelease.enrollment.enrollmentId ||
      currentEnrollment.enrollment.enrollmentSealKeyVersion !==
        pendingFactorRelease.enrollment.enrollmentSealKeyVersion ||
      !currentEnrollment.enrollment.factors.some(
        (factor) =>
          factor.factorNonceB64u === pendingFactor.factorNonceB64u &&
          factor.wrappedFactorB64u === pendingFactor.wrappedFactorB64u,
      )
    ) {
      return jsonFailure(
        409,
        'scope_mismatch',
        'Email OTP enrollment changed before factor release',
      );
    }
    const evaluated = await evaluateEmailOtpFactorForDevice({
      factorKey: input.ctx.service.emailOtp,
      walletId: authenticated.session.walletId,
      enrollment: pendingFactorRelease.enrollment,
      factor: pendingFactor,
      blindedElementB64u: pendingFactorRelease.blindedElementB64u,
      challengeId: factorReleaseChallengeId,
    });
    if (!evaluated.ok) {
      return json(evaluated, { status: emailOtpStatusCode(evaluated.code) });
    }
    materialRecovery = evaluated.evaluation;
  }
  return json(
    {
      ok: true,
      kind: 'verified_step_up',
      authorization: {
        kind: 'operation_step_up',
        evidence_set_digest: evidenceSet.evidenceSetDigest,
      },
      expiresAtMs,
      materialRecovery,
    },
    { status: 200 },
  );
}

type AcceptedEd25519NormalSigningAuthorization = Extract<
  Awaited<ReturnType<typeof authorizeRouterAbEd25519NormalSigningRoute>>,
  { readonly ok: true }
>;

async function proxyEd25519OwnerLaneExecution(input: {
  readonly ctx: FetchRouterApiContext;
  readonly body: Record<string, unknown>;
  readonly authorization: AcceptedEd25519NormalSigningAuthorization;
  readonly authorizedOperation: AuthorizedOperation;
}): Promise<Response> {
  if (
    input.authorization.kind === 'wallet_session_operation_credential_v1' ||
    input.authorization.kind === 'wallet_session_operation_credential_exhausted_candidate_v1'
  ) {
    return await proxyNormalSigningRequestToMpcRouter({
      request: input.ctx.request,
      proxy: input.ctx.opts.routerAbNormalSigningRouterProxy,
      body: input.body,
    });
  }
  const scope = parseRouterAbEd25519OperationStepUpScope(input.body.scope);
  const walletId = parseWalletId(scope.account_id);
  if (!walletId.ok) {
    return jsonFailure(400, 'invalid_body', 'Ed25519 signing wallet is invalid');
  }
  const laneAuthorization = input.authorization.session.laneAuthorization;
  return await proxyOwnerLaneAdmittedNormalSigningRequest({
    request: input.ctx.request,
    proxy: input.ctx.opts.routerAbNormalSigningRouterProxy,
    body: input.body,
    authorizedOperation: input.authorizedOperation,
    walletId: walletId.value,
    expectedMaterialActivation: scope.material_activation,
    authorization: laneAuthorization,
    walletRegistration: input.ctx.service.walletRegistration,
  });
}

async function handleRouterAbEd25519NormalSigningRoute(input: {
  ctx: FetchRouterApiContext;
  body: Record<string, unknown>;
  phase: RouterAbEd25519NormalSigningRoutePhase;
}): Promise<Response> {
  const timing = emptySigningGatewayTiming();
  return await withServerTiming('ed25519_sign_', timing, () =>
    executeRouterAbEd25519NormalSigningRoute(splitVoiceVerdict(input), timing),
  );
}

async function timeEd25519SigningStage<T>(
  timing: SigningGatewayTiming,
  stage: Exclude<keyof SigningGatewayTiming, 'total'>,
  pending: Promise<T>,
): Promise<T> {
  // Worker clocks move only at I/O, so the call's synchronous start adds nothing.
  const startedAt = performance.now();
  try {
    return await pending;
  } finally {
    timing[stage] = performance.now() - startedAt;
  }
}

/** Sends the request on with its authorized operation and binding, timed as the proxy stage. */
async function proxyEd25519AuthorizedOperation(input: {
  readonly ctx: FetchRouterApiContext;
  readonly timing: SigningGatewayTiming;
  readonly body: Record<string, unknown>;
  readonly authorization: AcceptedEd25519NormalSigningAuthorization;
  readonly authorizedOperation: AuthorizedOperationWireInput;
}): Promise<Response> {
  return await timeEd25519SigningStage(
    input.timing,
    'proxy',
    proxyEd25519OwnerLaneExecution({
      ctx: input.ctx,
      authorization: input.authorization,
      authorizedOperation: input.authorizedOperation.operation,
      body: {
        ...input.body,
        authorized_operation: buildRouterAbEd25519AuthorizedOperationWire(
          input.authorizedOperation,
        ),
      },
    }),
  );
}

async function readEd25519UpstreamBodyText(upstream: Response): Promise<string> {
  return await upstream
    .clone()
    .text()
    .catch(() => '');
}

/**
 * Answers a prepare with the SigningWorker's response and the operation's
 * receipt. A refusal, or a body that is not a JSON object, completes the
 * operation instead, so a retry replays that answer.
 */
async function finishEd25519Prepare(input: {
  readonly ctx: FetchRouterApiContext;
  readonly timing: SigningGatewayTiming;
  readonly upstream: Response;
  readonly operation: AuthorizedOperation;
  readonly authorization: Parameters<typeof signingPrepareSessionResponse>[1];
  readonly receipt: () =>
    | Ed25519ReusableAuthorizedOperationReceipt
    | Ed25519VerifiedStepUpAuthorizedOperationReceipt;
}): Promise<Response> {
  const upstream = input.upstream;
  const upstreamBodyText = await readEd25519UpstreamBodyText(upstream);
  let upstreamBody: unknown = null;
  try {
    upstreamBody = upstreamBodyText ? JSON.parse(upstreamBodyText) : null;
  } catch {
    upstreamBody = null;
  }
  if (
    isRouterAbEd25519OperationInProgressResponse({
      status: upstream.status,
      bodyText: upstreamBodyText,
    })
  ) {
    return upstream;
  }
  if (!upstream.ok || !isPlainObject(upstreamBody)) {
    return await completeEd25519Operation({
      ctx: input.ctx,
      timing: input.timing,
      operation: input.operation,
      result: upstream.status < 500 ? 'failed_before_side_effect' : 'failed_after_side_effect',
      upstream,
      bodyText: upstreamBodyText,
    });
  }
  const headers = new Headers(upstream.headers);
  headers.delete('content-length');
  return new Response(
    JSON.stringify(
      signingPrepareSessionResponse(
        { ...upstreamBody, authorized_operation: input.receipt() },
        input.authorization,
      ),
    ),
    {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    },
  );
}

/** Completes a finalized operation with the SigningWorker's response and answers with it. */
async function finishEd25519Finalize(input: {
  readonly ctx: FetchRouterApiContext;
  readonly timing: SigningGatewayTiming;
  readonly upstream: Response;
  readonly operation: AuthorizedOperation;
}): Promise<Response> {
  const upstream = input.upstream;
  const upstreamBodyText = await readEd25519UpstreamBodyText(upstream);
  if (
    isRouterAbEd25519OperationInProgressResponse({
      status: upstream.status,
      bodyText: upstreamBodyText,
    })
  ) {
    return upstream;
  }
  return await completeEd25519Operation({
    ctx: input.ctx,
    timing: input.timing,
    operation: input.operation,
    result: upstream.ok
      ? 'succeeded'
      : upstream.status < 500
        ? 'failed_before_side_effect'
        : 'failed_after_side_effect',
    upstream,
    bodyText: upstreamBodyText,
  });
}

async function executeRouterAbEd25519NormalSigningRoute(
  input: {
    ctx: FetchRouterApiContext;
    body: Record<string, unknown>;
    phase: RouterAbEd25519NormalSigningRoutePhase;
    voiceVerdict: unknown;
  },
  timing: SigningGatewayTiming,
): Promise<Response> {
  const authorization = await timeEd25519SigningStage(
    timing,
    'authorize',
    authorizeRouterAbEd25519NormalSigningRoute({
      ...normalSigningAuthorizationRequest(input),
      resolveEd25519MaterialActivation:
        input.ctx.service.walletRegistration.resolveEd25519MaterialActivation.bind(
          input.ctx.service.walletRegistration,
        ),
    }),
  );
  if (!authorization.ok) {
    return json(authorization.result.body, { status: authorization.result.status });
  }
  const voiceRefusal = await checkSigningRequestVoiceVerdict(input, authorization);
  if (voiceRefusal) return voiceRefusal;
  if (authorization.kind === 'operation_step_up') {
    if (input.phase === 'prepare') {
      if (authorization.phase !== 'prepare') {
        throw new Error('Operation step-up prepare authorization phase changed');
      }
      const execution = decideEd25519OperationStepUpExecution({
        admissionKind: authorization.admissionKind,
        operation: authorization.operation,
      });
      if (execution.kind !== 'execute') return execution.response;
      const upstream = await proxyEd25519AuthorizedOperation({
        ctx: input.ctx,
        timing,
        body: input.body,
        authorization,
        authorizedOperation: {
          operation: execution.operation,
          binding: await ed25519OperationStepUpBinding(
            input.ctx,
            authorization.session,
            execution.operation,
          ),
        },
      });
      return await finishEd25519Prepare({
        ctx: input.ctx,
        timing,
        upstream,
        operation: execution.operation,
        authorization,
        receipt: () => buildEd25519VerifiedStepUpAuthorizedOperationReceipt({ authorization }),
      });
    }
    if (authorization.phase !== 'finalize') {
      throw new Error('Operation step-up finalize authorization phase changed');
    }
    const validatedAuthorization = await timeEd25519SigningStage(
      timing,
      'admit',
      validateEd25519VerifiedStepUpAuthorizedOperation({
        ctx: input.ctx,
        body: input.body,
        authorization,
      }),
    );
    if (!validatedAuthorization.ok) return validatedAuthorization.response;
    const replay = replayCompletedEd25519Operation(validatedAuthorization.operation);
    if (replay) return replay;
    const upstream = await proxyEd25519AuthorizedOperation({
      ctx: input.ctx,
      timing,
      body: input.body,
      authorization,
      authorizedOperation: {
        operation: validatedAuthorization.operation,
        binding: await ed25519OperationStepUpBinding(
          input.ctx,
          authorization.session,
          validatedAuthorization.operation,
        ),
      },
    });
    return await finishEd25519Finalize({
      ctx: input.ctx,
      timing,
      upstream,
      operation: validatedAuthorization.operation,
    });
  }
  if (input.phase === 'prepare') {
    const authorized = await timeEd25519SigningStage(
      timing,
      'admit',
      authorizeEd25519ReusableWalletSessionOperation({
        ctx: input.ctx,
        body: input.body,
        authorization,
      }),
    );
    if (!authorized.ok) return authorized.response;
    const execution = decideEd25519NormalSigningExecution({
      phase: 'prepare',
      admissionKind: authorized.admission.kind,
      operation: authorized.admission.operation,
    });
    if (execution.kind !== 'execute') return execution.response;
    if (authorized.admission.kind !== 'claimed') {
      throw new Error('Ed25519 prepare execution claim changed');
    }
    const ownerDecision = decideRouterAbEd25519OwnerOperationAuthorization({
      operation: execution.operation,
    });
    if (ownerDecision.kind !== 'authorized') {
      return ownerOperationNotAuthorizedResponse(
        ownerDecision,
        'Ed25519 operation step-up was not admitted',
      );
    }
    const receipt = authorized.admission.receipt;
    const upstream = await proxyEd25519AuthorizedOperation({
      ctx: input.ctx,
      timing,
      body: input.body,
      authorization,
      authorizedOperation: {
        operation: execution.operation,
        binding: ed25519GatewayOwnerWalletSessionBinding(
          authorization,
          authorized.admission.ownerScope,
        ),
      },
    });
    return await finishEd25519Prepare({
      ctx: input.ctx,
      timing,
      upstream,
      operation: execution.operation,
      authorization,
      receipt: () => receipt,
    });
  }
  const validatedAuthorization = await timeEd25519SigningStage(
    timing,
    'admit',
    validateEd25519ReusableAuthorizedOperation({
      ctx: input.ctx,
      body: input.body,
      authorization,
    }),
  );
  if (!validatedAuthorization.ok) return validatedAuthorization.response;
  const replay = replayCompletedEd25519Operation(validatedAuthorization.operation);
  if (replay) return replay;
  if (!validatedAuthorization.ownerScope) {
    throw new Error('Pinned owner Wallet Session scope is unavailable');
  }
  const upstream = await proxyEd25519AuthorizedOperation({
    ctx: input.ctx,
    timing,
    body: input.body,
    authorization,
    authorizedOperation: {
      operation: validatedAuthorization.operation,
      binding: ed25519GatewayOwnerWalletSessionBinding(
        authorization,
        validatedAuthorization.ownerScope,
      ),
    },
  });
  return await finishEd25519Finalize({
    ctx: input.ctx,
    timing,
    upstream,
    operation: validatedAuthorization.operation,
  });
}

export async function handleThresholdEd25519(ctx: FetchRouterApiContext): Promise<Response | null> {
  if (ctx.method === 'GET' && ctx.pathname === ROUTER_AB_ED25519_HEALTH_PATH) {
    if (!ctx.opts.routerAbNormalSigningRouterProxy) {
      const body = {
        ok: false,
        code: 'not_configured',
        message: 'Router A/B Ed25519 signing runtime is not configured on this server',
        configured: false,
      };
      return json(body, { status: thresholdEd25519StatusCode(body) });
    }
    return json({ ok: true, configured: true }, { status: 200 });
  }

  const routed = await readThresholdRouteBody(ctx, [
    ROUTER_AB_ED25519_WALLET_SESSION_PATH,
    ROUTER_AB_ED25519_NORMAL_SIGNING_PREPARE_PATH,
    ROUTER_AB_ED25519_NORMAL_SIGNING_PATH,
  ]);
  if (!routed) return null;
  const pathname = routed.pathname;
  const body = jsonObjectOrEmpty(routed.body);

  switch (pathname) {
    case ROUTER_AB_ED25519_NORMAL_SIGNING_PREPARE_PATH:
      return handleRouterAbEd25519NormalSigningRoute({
        ctx,
        body,
        phase: 'prepare',
      });

    case ROUTER_AB_ED25519_NORMAL_SIGNING_PATH:
      return handleRouterAbEd25519NormalSigningRoute({
        ctx,
        body,
        phase: 'finalize',
      });
  }

  switch (pathname) {
    case ROUTER_AB_ED25519_WALLET_SESSION_PATH: {
      if (body.kind === 'router_ab_ed25519_yao_operation_step_up_grant_v1') {
        const parsedGrant = parseThresholdEd25519OperationStepUpGrantRequest(body);
        if (!parsedGrant.ok) {
          return json(parsedGrant.body, {
            status: thresholdEd25519StatusCode(parsedGrant.body),
          });
        }
        return await issueEd25519OperationStepUpGrant({
          ctx,
          request: parsedGrant.request,
        });
      }

      const parsedBody = parseThresholdEd25519SessionRouteRequest(body);
      if (!parsedBody.ok) {
        return json(parsedBody.body, { status: thresholdEd25519StatusCode(parsedBody.body) });
      }
      const b = parsedBody.request;
      ctx.logger.info('[threshold-ed25519] request', {
        route: pathname,
        method: ctx.method,
        relayerKeyId: typeof b.relayerKeyId === 'string' ? b.relayerKeyId : undefined,
        sessionPolicy: b.sessionPolicy ? { version: b.sessionPolicy.version } : undefined,
      });

      const authority = b.sessionPolicy.authority;
      if (!isPasskeyWalletAuthAuthority(authority)) {
        return jsonFailure(
          400,
          'invalid_body',
          'Ed25519 Yao WebAuthn budget refresh requires passkey authority',
        );
      }
      if (b.relayerKeyId !== b.sessionPolicy.relayerKeyId) {
        return jsonFailure(
          400,
          'invalid_body',
          'relayerKeyId must match the Ed25519 Yao session policy',
        );
      }

      const runtimePolicyScopeResolution = await resolveThresholdRuntimePolicyScope({
        explicitScopeRaw: b.sessionPolicy.runtimePolicyScope,
        projectEnvironmentIdRaw: b.projectEnvironmentId,
        headers: ctx.request.headers,
        origin: ctx.request.headers.get('origin'),
        publishableKeyAuth: ctx.opts.publishableKeyAuth || null,
        orgProjectEnv: ctx.opts.orgProjectEnv || null,
      });
      if (!runtimePolicyScopeResolution.ok) {
        return jsonFailure(
          runtimePolicyScopeResolution.status,
          runtimePolicyScopeResolution.code,
          runtimePolicyScopeResolution.message,
        );
      }
      const runtimePolicyScope = runtimePolicyScopeResolution.scope;
      if (
        !runtimePolicyScope ||
        !sameRuntimePolicyScope(runtimePolicyScope, b.sessionPolicy.runtimePolicyScope)
      ) {
        return jsonFailure(
          403,
          'scope_mismatch',
          'Ed25519 Yao runtime policy scope does not match the active environment',
        );
      }
      const authorization = await validatePasskeyEd25519SessionAuthorization({
        ctx,
        request: b,
        authority,
      });
      if (!authorization.ok) return authorization.response;

      const refreshRequest: RouterAbEd25519YaoBudgetRefreshRequestV1 = {
        kind: 'router_ab_ed25519_yao_budget_refresh_v1',
        sessionPolicy: b.sessionPolicy,
        authorization: authorization.authorization,
      };
      const result =
        await ctx.service.walletRegistration.refreshEd25519YaoWalletSession(refreshRequest);
      const status = thresholdEd25519StatusCode(result);
      ctx.logger.info('[threshold-ed25519] response', {
        route: pathname,
        status,
        ok: result.ok,
        ...('code' in result && result.code ? { code: result.code } : {}),
      });
      return json(result, { status });
    }
    default:
      return null;
  }
}
