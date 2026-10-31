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
import type { FetchRouterApiContext } from '../createFetchRouter';
import { json, readJson } from '../../../framework/http';
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
import { authenticateRouterAbWalletOperationStepUpIdentity } from '../../../domains/signingOperations/routerAbOperationStepUp';
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
  type AuthorizedOperationReplayResponse,
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
import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  emailOtpStatusCode,
  hashEmailOtpOperationBinding,
} from '../../../domains/emailOtp/emailOtpSessionRouteHelpers';
import { sealEmailOtpFactorSecretForWorker } from '../../../domains/emailOtp/emailOtpRouteHandlers';
import type { RouterAbEd25519YaoOperationStepUpMaterialRecoveryResponse } from '../../../domains/ed25519Yao/session/routerAbEd25519YaoWalletSession';
import type {
  RouterApiEmailOtpRouteService,
  RouterApiWalletAuthMethodService,
} from '../../../framework/authServicePort';
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

function ed25519ReusableWalletSession(authorization: AcceptedEd25519WalletSessionAuthorization) {
  return authorization.kind === 'wallet_session_operation_credential_v1'
    ? authorization.validated.admission.context.authorization.session
    : authorization.candidate.status.session;
}

function ed25519ReusableWalletSessionIdentity(
  authorization: AcceptedEd25519WalletSessionAuthorization,
) {
  const session = ed25519ReusableWalletSession(authorization);
  return {
    tenantId: session.tenantId,
    principalId: session.principalId,
    walletSessionId: session.walletSessionId,
    authorizationId: session.authorizationId,
    quotaId: session.quotaId,
  };
}

function buildEd25519GatewayOwnerWalletSessionBinding(
  authorization: AcceptedEd25519WalletSessionAuthorization,
  pinned: PinnedOwnerWalletScope,
) {
  const session = ed25519ReusableWalletSession(authorization);
  const runtimePolicyScope = authorization.activeMaterial.runtimePolicyScope;
  return {
    kind: 'gateway_owner_wallet_session' as const,
    ownershipGeneration: pinned.ownershipGeneration,
    subjectId: String(session.principalId),
    accountId: String(session.walletId),
    authorizationId: String(session.authorizationId),
    walletSessionId: String(session.walletSessionId),
    quotaId: String(session.quotaId),
    thresholdSessionId: authorization.activeMaterial.exportIdentity.scope.threshold_session_id,
    orgId: runtimePolicyScope.orgId,
    projectId: runtimePolicyScope.projectId,
    environment: runtimePolicyScope.envId,
    projectEnvironmentId: pinned.projectEnvironmentId,
    signingWorkerId: authorization.activeMaterial.signingWorkerId,
    expiresAtMs: session.expiresAtMs,
  };
}

/** The scope the operation's own admission pinned, checked against the active material. */
function pinnedEd25519WalletScope(
  authorization: AcceptedEd25519WalletSessionAuthorization,
  pinned: PinnedOwnerWalletScope,
): PinnedOwnerWalletScope {
  const scope = authorization.activeMaterial.runtimePolicyScope;
  if (pinned.orgId !== scope.orgId || pinned.projectId !== scope.projectId) {
    throw new Error('Pinned owner Wallet Session scope differs from active material');
  }
  return pinned;
}

/**
 * The Router binding for a verified step-up: the wallet it signs for and the
 * Console project environment of the store that claimed the operation, so
 * the SigningWorker reaches the wallet's own storage.
 */
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
  const scope = session.runtimePolicyScope;
  const pinned = await ctx.service.authorizedOperations.readPinnedOwnerWalletScope({
    operation,
    walletId: requireAuthorizationValue(parseWalletId(session.walletId)),
  });
  if (pinned.orgId !== scope.orgId || pinned.projectId !== scope.projectId) {
    throw new Error('Step-up wallet scope differs from the Wallet Session scope');
  }
  return {
    kind: 'operation_step_up',
    ownershipGeneration: pinned.ownershipGeneration,
    authorizationSessionId: session.sessionId,
    orgId: scope.orgId,
    projectId: scope.projectId,
    environment: scope.envId,
    projectEnvironmentId: pinned.projectEnvironmentId,
    subjectId: session.principalId,
    accountId: session.walletId,
  };
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
  const operationKind = requireEd25519OperationKind(operationRef.operationKind);
  const commonAuthorizedOperation = {
    authorized_operation_id: operation.authorizedOperationId,
    operation_id: operation.operation.operationId,
    capability_kind: 'near_ed25519_mpc_signing' as const,
    operation_kind: operationKind,
    lane_digest_b64u: operation.operation.digests.laneDigest,
    intent_digest_b64u: operation.operation.digests.intentDigest,
    display_digest_b64u: operation.operation.digests.displayDigest,
    operation_fingerprint_digest: operation.operationFingerprintDigest,
  };
  return buildAuthorizedOperationWire(input, commonAuthorizedOperation);
}

type EmailOtpFactorReleaseEnrollment = {
  readonly enrollmentId: string;
  readonly enrollmentSealKeyVersion: string;
  readonly serverSealedFactorCiphertextB64u: string;
};

type EmailOtpFactorReleaseRequest = {
  readonly enrollment: EmailOtpFactorReleaseEnrollment;
  readonly workerEphemeralPublicKey65B64u: string;
};

type EmailOtpFactorReleaseResponse = Extract<
  RouterAbEd25519YaoOperationStepUpMaterialRecoveryResponse,
  { readonly kind: 'email_otp_factor_release_v1' }
>;

async function releaseEmailOtpFactorForWorker(input: {
  readonly emailOtp: Pick<RouterApiEmailOtpRouteService, 'removeEmailOtpServerSeal'>;
  readonly request: EmailOtpFactorReleaseRequest;
  readonly walletId: string;
  readonly challengeId: string;
}): Promise<
  | { readonly ok: true; readonly recovery: EmailOtpFactorReleaseResponse }
  | { readonly ok: false; readonly code: string; readonly message: string }
> {
  const unsealed = await input.emailOtp.removeEmailOtpServerSeal({
    wrappedCiphertext: input.request.enrollment.serverSealedFactorCiphertextB64u,
    enrollmentSealKeyVersion: input.request.enrollment.enrollmentSealKeyVersion,
  });
  if (!unsealed.ok) return unsealed;
  if (unsealed.enrollmentSealKeyVersion !== input.request.enrollment.enrollmentSealKeyVersion) {
    return {
      ok: false,
      code: 'scope_mismatch',
      message: 'Email OTP factor release seal key version changed',
    };
  }
  const sealed = await sealEmailOtpFactorSecretForWorker({
    factorSecret32B64u: unsealed.ciphertext,
    workerEphemeralPublicKey65B64u: input.request.workerEphemeralPublicKey65B64u,
    walletId: input.walletId,
    enrollmentId: input.request.enrollment.enrollmentId,
    enrollmentSealKeyVersion: input.request.enrollment.enrollmentSealKeyVersion,
    challengeId: input.challengeId,
  });
  if (!sealed.ok) return sealed;
  return {
    ok: true,
    recovery: {
      kind: 'email_otp_factor_release_v1',
      challengeId: input.challengeId,
      enrollmentId: input.request.enrollment.enrollmentId,
      enrollmentSealKeyVersion: input.request.enrollment.enrollmentSealKeyVersion,
      serverEphemeralPublicKey65B64u: sealed.serverEphemeralPublicKey65B64u,
      nonce12B64u: sealed.nonce12B64u,
      ciphertextB64u: sealed.ciphertextB64u,
    },
  };
}

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
  const credentialIdB64u = String(
    credential.webauthnAuthentication.rawId || credential.webauthnAuthentication.id || '',
  ).trim();
  if (!credentialIdB64u || credentialIdB64u !== input.authority.factor.credentialIdB64u) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          code: 'unauthorized',
          message: 'WebAuthn proof does not match the active Ed25519 Wallet Session authority',
        },
        { status: 401 },
      ),
    };
  }
  const expectedOrigin = normalizeCorsOrigin(input.ctx.request.headers.get('origin') || undefined);
  if (!expectedOrigin) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          code: 'invalid_body',
          message: 'expected_origin is required for WebAuthn authentication verification',
        },
        { status: 400 },
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
        factorId: requireAuthorizationValue(parseAuthFactorId(`passkey:${credentialIdB64u}`)),
        credentialIdB64u: requireAuthorizationValue(
          parseWebAuthnCredentialIdB64u(credentialIdB64u),
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
    response: json(
      {
        ok: false,
        code: verified.code || 'not_verified',
        message: verified.message || 'WebAuthn authentication verification failed',
      },
      { status: 401 },
    ),
  };
}

function requireAuthorizationValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
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
    const session = ed25519ReusableWalletSession(input.authorization);
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
        response: json(
          { ok: false, code: 'wallet_session_mismatch', message: 'Wallet Session changed' },
          { status: 403 },
        ),
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
      response: json(
        {
          ok: false,
          code: 'invalid_body',
          message:
            error instanceof Error ? error.message : 'Ed25519 authorized operation is invalid',
        },
        { status: 400 },
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
        walletId: ed25519ReusableWalletSession(input.authorization).walletId,
      });
    } catch {
      return {
        ok: false,
        response: json(
          { ok: false, code: 'internal', message: 'Authorized operation lookup failed' },
          { status: 500 },
        ),
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
      response: json(
        {
          ok: false,
          code: 'invalid_authorized_operation',
          message: error instanceof Error ? error.message : 'Authorized operation is invalid',
        },
        { status: 400 },
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
        response: json(
          {
            ok: false,
            code: 'authorized_operation_missing',
            message: 'Authorized operation is unavailable',
          },
          { status: 409 },
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
      response: json(
        {
          ok: false,
          code: 'invalid_authorized_operation',
          message: error instanceof Error ? error.message : 'Authorized operation is invalid',
        },
        { status: 400 },
      ),
    };
  }
}

async function completeEd25519Operation(input: {
  ctx: FetchRouterApiContext;
  operation: AuthorizedOperation;
  result: 'succeeded' | 'failed_before_side_effect' | 'failed_after_side_effect';
  response: AuthorizedOperationReplayResponse;
}): Promise<AuthorizedOperation> {
  return await input.ctx.service.authorizedOperations.completeAuthorizedOperation({
    operation: input.operation,
    result: input.result,
    response: input.response,
    completedAtMs: Date.now(),
  });
}

function replayCompletedEd25519Operation(operation: AuthorizedOperation): Response | null {
  if (operation.lifecycle !== 'completed') return null;
  return new Response(authorizedOperationReplayBodyInit(operation.response), {
    status: operation.response.status,
    headers: { 'content-type': operation.response.contentType },
  });
}

/**
 * Completion readback is the authority for a terminal response. A claimed
 * operation must never fall back to the live upstream response after the
 * completion write, since that would make retries non-idempotent.
 */
function requireCompletedEd25519OperationResponse(operation: AuthorizedOperation): Response {
  const replay = replayCompletedEd25519Operation(operation);
  if (!replay) throw new Error('Ed25519 operation completion readback is not completed');
  return replay;
}

function buildEd25519ReplayResponse(input: {
  readonly response: Response;
  readonly bodyText: string;
}): AuthorizedOperationReplayResponse {
  return {
    status: input.response.status,
    contentType: input.response.headers.get('content-type') || 'application/json',
    bodyText: input.bodyText,
  };
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
        response: json(
          {
            ok: false,
            code: 'operation_in_progress',
            message: 'Ed25519 operation is already in progress',
          },
          { status: 409 },
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
    return json(
      { ok: false, code: 'invalid_body', message: 'Operation step-up scope is required' },
      { status: 400 },
    );
  }
  const proof = input.request.proof;
  const activeAuthority = await resolveActiveEd25519OperationStepUpAuthority(
    input.ctx.service.walletAuthMethods,
    proof,
  );
  if (!activeAuthority.ok) {
    return json(
      { ok: false, code: 'scope_mismatch', message: 'Operation step-up authority is not active' },
      { status: 403 },
    );
  }
  const authority = proof.kind === 'passkey' ? proof.authority : activeAuthority.authority;
  const operation = parseRouterAbOperationStepUpOperation(
    input.request.normalSigningRequest.intent,
  );
  if (!operation.ok) {
    return json({ ok: false, code: 'invalid_body', message: operation.message }, { status: 400 });
  }
  const activeMaterial =
    await input.ctx.service.walletRegistration.resolveEd25519MaterialActivation({
      walletId: scope.account_id,
      materialActivation: scope.material_activation,
    });
  if (!activeMaterial.ok) {
    return json(
      {
        ok: false,
        code: activeMaterial.code === 'internal' ? 'internal' : 'scope_mismatch',
        message:
          activeMaterial.code === 'internal'
            ? activeMaterial.message
            : 'Operation step-up scope does not name the active material',
      },
      { status: activeMaterial.code === 'internal' ? 500 : 403 },
    );
  }
  if (
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      scope.material_activation,
    )
  ) {
    return json(
      {
        ok: false,
        code: 'scope_mismatch',
        message: 'Operation step-up scope does not name the active material',
      },
      { status: 403 },
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
    expiresAtMs: Number(input.request.normalSigningRequest.expires_at_ms),
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
    return json(
      {
        ok: false,
        code: 'invalid_body',
        message: error instanceof Error ? error.message : 'Operation step-up request is invalid',
      },
      { status: 400 },
    );
  }
  if (!('admission_candidate' in privateBody)) {
    return json(
      { ok: false, code: 'invalid_body', message: 'Operation step-up prepare is required' },
      { status: 400 },
    );
  }
  const intent = input.request.normalSigningRequest.intent;
  if (!isPlainObject(intent)) {
    return json(
      { ok: false, code: 'invalid_body', message: 'Operation step-up intent is invalid' },
      { status: 400 },
    );
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
    return json(
      { ok: false, code: 'scope_mismatch', message: 'Operation step-up authority changed' },
      { status: 403 },
    );
  }
  const nowMs = Date.now();
  const expiresAtMs = Number(input.request.normalSigningRequest.expires_at_ms);
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
  let pendingFactorRelease: EmailOtpFactorReleaseRequest | null = null;
  let factorReleaseChallengeId: string | null = null;
  switch (proof.kind) {
    case 'passkey': {
      const credential = proof.webauthnAuthentication;
      const credentialId = String(credential.rawId || credential.id || '').trim();
      if (credentialId !== proof.authority.factor.credentialIdB64u) {
        return json(
          { ok: false, code: 'unauthorized', message: 'Passkey credential changed' },
          { status: 401 },
        );
      }
      const verified = await input.ctx.service.webAuthn.verifyWebAuthnAuthenticationLite({
        userId: authenticated.session.walletId,
        rpId: proof.authority.verifier.rpId,
        expectedChallenge: challengeB64u,
        expected_origin: requestOrigin,
        webauthn_authentication: credential,
      });
      if (!verified.success || !verified.verified) {
        return json(
          {
            ok: false,
            code: verified.code || 'not_verified',
            message: verified.message || 'WebAuthn authentication verification failed',
          },
          { status: 401 },
        );
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
        verifiedAtMs: nowMs,
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
      if (input.request.materialRecovery.kind === 'email_otp_factor_release_v1') {
        const enrollment = await input.ctx.service.emailOtp.readActiveEmailOtpEnrollment({
          walletId: authenticated.session.walletId,
          orgId: authenticated.session.tenantId,
          providerUserId: proof.providerSubjectId,
        });
        if (!enrollment.ok) {
          return json(enrollment, { status: emailOtpStatusCode(enrollment.code) });
        }
        pendingFactorRelease = {
          enrollment: {
            enrollmentId: enrollment.enrollment.enrollmentId,
            enrollmentSealKeyVersion: enrollment.enrollment.enrollmentSealKeyVersion,
            serverSealedFactorCiphertextB64u:
              enrollment.enrollment.serverSealedFactorCiphertextB64u,
          },
          workerEphemeralPublicKey65B64u:
            input.request.materialRecovery.workerEphemeralPublicKey65B64u,
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
      });
      if (!consumed.ok) {
        return json(consumed, { status: consumed.code === 'invalid_body' ? 400 : 401 });
      }
      factorReleaseChallengeId = consumed.challengeId;
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
        verifiedAtMs: nowMs,
        expiresAtMs: Math.min(expiresAtMs, verified.grantExpiresAtMs),
      });
      break;
    }
  }
  const evidenceSet =
    await input.ctx.service.authorizedOperations.recordVerifiedWalletOperationFactorEvidenceSet({
      operation: envelope,
      evidenceId,
      evidenceSetId,
      factor,
    });
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
      claimedAtMs: nowMs,
    },
  });
  switch (atomicOperation.kind) {
    case 'claimed':
    case 'operation_in_progress':
    case 'replayed':
      break;
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
      return json(
        {
          ok: false,
          code: atomicOperation.kind,
          message: 'Ed25519 operation step-up authorization is invalid',
        },
        { status: 403 },
      );
    case 'billing_credit_exhausted':
      return json(
        {
          ok: false,
          code: atomicOperation.kind,
          message: 'The application has no available signing credit',
        },
        { status: 402 },
      );
    case 'wallet_session_quota_exhausted':
    case 'material_mismatch':
      return json(
        {
          ok: false,
          code: atomicOperation.kind,
          message: 'Ed25519 operation step-up authorization is unavailable',
        },
        { status: 409 },
      );
  }
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
    if (
      currentEnrollment.enrollment.enrollmentId !== pendingFactorRelease.enrollment.enrollmentId ||
      currentEnrollment.enrollment.enrollmentSealKeyVersion !==
        pendingFactorRelease.enrollment.enrollmentSealKeyVersion ||
      currentEnrollment.enrollment.serverSealedFactorCiphertextB64u !==
        pendingFactorRelease.enrollment.serverSealedFactorCiphertextB64u
    ) {
      return json(
        {
          ok: false,
          code: 'scope_mismatch',
          message: 'Email OTP enrollment changed before factor release',
        },
        { status: 409 },
      );
    }
    const released = await releaseEmailOtpFactorForWorker({
      emailOtp: input.ctx.service.emailOtp,
      request: pendingFactorRelease,
      walletId: authenticated.session.walletId,
      challengeId: factorReleaseChallengeId,
    });
    if (!released.ok) {
      return json(released, { status: emailOtpStatusCode(released.code) });
    }
    materialRecovery = released.recovery;
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
    return json(
      { ok: false, code: 'invalid_body', message: 'Ed25519 signing wallet is invalid' },
      { status: 400 },
    );
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

type Ed25519SigningGatewayTiming = {
  authorize: number | null;
  admit: number | null;
  proxy: number | null;
  complete: number | null;
  total: number | null;
};

async function handleRouterAbEd25519NormalSigningRoute(input: {
  ctx: FetchRouterApiContext;
  body: Record<string, unknown>;
  phase: RouterAbEd25519NormalSigningRoutePhase;
}): Promise<Response> {
  const startedAt = performance.now();
  const timing: Ed25519SigningGatewayTiming = {
    authorize: null,
    admit: null,
    proxy: null,
    complete: null,
    total: null,
  };
  const response = await executeRouterAbEd25519NormalSigningRoute(input, timing);
  timing.total = performance.now() - startedAt;
  const headers = new Headers(response.headers);
  for (const [stage, duration] of Object.entries(timing)) {
    if (duration !== null) {
      headers.append(
        'Server-Timing',
        `ed25519_sign_${stage};dur=${Math.max(0, duration).toFixed(1)}`,
      );
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function timeEd25519SigningStage<T>(
  timing: Ed25519SigningGatewayTiming,
  stage: Exclude<keyof Ed25519SigningGatewayTiming, 'total'>,
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

async function executeRouterAbEd25519NormalSigningRoute(
  input: {
    ctx: FetchRouterApiContext;
    body: Record<string, unknown>;
    phase: RouterAbEd25519NormalSigningRoutePhase;
  },
  timing: Ed25519SigningGatewayTiming,
): Promise<Response> {
  const authorization = await timeEd25519SigningStage(timing, 'authorize', authorizeRouterAbEd25519NormalSigningRoute({
    body: input.body,
    rawBody: input.body,
    headers: Object.fromEntries(input.ctx.request.headers.entries()),
    session: input.ctx.opts.session,
    authorizedOperations: input.ctx.service.authorizedOperations,
    authorizationSessions: input.ctx.service.authorizationSessions,
    admissionAdapter: input.ctx.opts.routerAbNormalSigningAdmission,
    resolveEd25519MaterialActivation:
      input.ctx.service.walletRegistration.resolveEd25519MaterialActivation.bind(
        input.ctx.service.walletRegistration,
      ),
    phase: input.phase,
  }));
  if (!authorization.ok) {
    return json(authorization.result.body, { status: authorization.result.status });
  }
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
      const upstream = await timeEd25519SigningStage(timing, 'proxy', proxyEd25519OwnerLaneExecution({
        ctx: input.ctx,
        authorization,
        authorizedOperation: execution.operation,
        body: {
          ...input.body,
          authorized_operation: buildRouterAbEd25519AuthorizedOperationWire({
            operation: execution.operation,
            binding: await ed25519OperationStepUpBinding(
              input.ctx,
              authorization.session,
              execution.operation,
            ),
          }),
        },
      }));
      const upstreamBodyText = await upstream
        .clone()
        .text()
        .catch(() => '');
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
        const completed = await timeEd25519SigningStage(timing, 'complete', completeEd25519Operation({
          ctx: input.ctx,
          operation: execution.operation,
          result: upstream.status < 500 ? 'failed_before_side_effect' : 'failed_after_side_effect',
          response: buildEd25519ReplayResponse({ response: upstream, bodyText: upstreamBodyText }),
        }));
        return requireCompletedEd25519OperationResponse(completed);
      }
      const headers = new Headers(upstream.headers);
      headers.delete('content-length');
      return new Response(
        JSON.stringify(
          signingPrepareSessionResponse({
            ...upstreamBody,
            authorized_operation: buildEd25519VerifiedStepUpAuthorizedOperationReceipt({
              authorization,
            }),
          }, authorization),
        ),
        {
          status: upstream.status,
          statusText: upstream.statusText,
          headers,
        },
      );
    }
    if (authorization.phase !== 'finalize') {
      throw new Error('Operation step-up finalize authorization phase changed');
    }
    const validatedAuthorization = await timeEd25519SigningStage(timing, 'admit', validateEd25519VerifiedStepUpAuthorizedOperation({
      ctx: input.ctx,
      body: input.body,
      authorization,
    }));
    if (!validatedAuthorization.ok) return validatedAuthorization.response;
    const replay = replayCompletedEd25519Operation(validatedAuthorization.operation);
    if (replay) return replay;
    const upstream = await timeEd25519SigningStage(timing, 'proxy', proxyEd25519OwnerLaneExecution({
      ctx: input.ctx,
      authorization,
      authorizedOperation: validatedAuthorization.operation,
      body: {
        ...input.body,
        authorized_operation: buildRouterAbEd25519AuthorizedOperationWire({
          operation: validatedAuthorization.operation,
          binding: await ed25519OperationStepUpBinding(
            input.ctx,
            authorization.session,
            validatedAuthorization.operation,
          ),
        }),
      },
    }));
    const upstreamBodyText = await upstream
      .clone()
      .text()
      .catch(() => '');
    if (
      isRouterAbEd25519OperationInProgressResponse({
        status: upstream.status,
        bodyText: upstreamBodyText,
      })
    ) {
      return upstream;
    }
    const completed = await timeEd25519SigningStage(timing, 'complete', completeEd25519Operation({
      ctx: input.ctx,
      operation: validatedAuthorization.operation,
      result: upstream.ok
        ? 'succeeded'
        : upstream.status < 500
          ? 'failed_before_side_effect'
          : 'failed_after_side_effect',
      response: buildEd25519ReplayResponse({ response: upstream, bodyText: upstreamBodyText }),
    }));
    return requireCompletedEd25519OperationResponse(completed);
  }
  if (input.phase === 'prepare') {
    const authorized = await timeEd25519SigningStage(timing, 'admit', authorizeEd25519ReusableWalletSessionOperation({
      ctx: input.ctx,
      body: input.body,
      authorization,
    }));
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
      return json(
        {
          ok: false,
          code:
            ownerDecision.kind === 'denied'
              ? ownerDecision.denial.code
              : 'authorization_unavailable',
          message:
            ownerDecision.kind === 'denied'
              ? ownerDecision.denial.message
              : 'Ed25519 operation step-up was not admitted',
          authorization_decision:
            ownerDecision.kind === 'denied'
              ? ownerDecision
              : {
                  kind: 'denied' as const,
                  denial: {
                    code: 'authorization_unavailable' as const,
                    message: 'Ed25519 operation step-up was not admitted',
                  },
                },
        },
        { status: 403 },
      );
    }
    const upstream = await timeEd25519SigningStage(timing, 'proxy', proxyEd25519OwnerLaneExecution({
      ctx: input.ctx,
      authorization,
      authorizedOperation: execution.operation,
      body: {
        ...input.body,
        authorized_operation: buildRouterAbEd25519AuthorizedOperationWire({
          operation: execution.operation,
          binding: buildEd25519GatewayOwnerWalletSessionBinding(
            authorization,
            pinnedEd25519WalletScope(authorization, authorized.admission.ownerScope),
          ),
        }),
      },
    }));
    const upstreamBodyText = await upstream
      .clone()
      .text()
      .catch(() => '');
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
      const completed = await timeEd25519SigningStage(timing, 'complete', completeEd25519Operation({
        ctx: input.ctx,
        operation: execution.operation,
        result: upstream.status < 500 ? 'failed_before_side_effect' : 'failed_after_side_effect',
        response: buildEd25519ReplayResponse({ response: upstream, bodyText: upstreamBodyText }),
      }));
      return requireCompletedEd25519OperationResponse(completed);
    }
    const headers = new Headers(upstream.headers);
    headers.delete('content-length');
    return new Response(
      JSON.stringify(
        signingPrepareSessionResponse({
          ...upstreamBody,
          authorized_operation: authorized.admission.receipt,
        }, authorization),
      ),
      {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      },
    );
  }
  const validatedAuthorization = await timeEd25519SigningStage(timing, 'admit', validateEd25519ReusableAuthorizedOperation({
    ctx: input.ctx,
    body: input.body,
    authorization,
  }));
  if (!validatedAuthorization.ok) return validatedAuthorization.response;
  const replay = replayCompletedEd25519Operation(validatedAuthorization.operation);
  if (replay) return replay;
  if (!validatedAuthorization.ownerScope) {
    throw new Error('Pinned owner Wallet Session scope is unavailable');
  }
  const upstream = await timeEd25519SigningStage(timing, 'proxy', proxyEd25519OwnerLaneExecution({
    ctx: input.ctx,
    authorization,
    authorizedOperation: validatedAuthorization.operation,
    body: {
      ...input.body,
      authorized_operation: buildRouterAbEd25519AuthorizedOperationWire({
        operation: validatedAuthorization.operation,
        binding: buildEd25519GatewayOwnerWalletSessionBinding(
          authorization,
          pinnedEd25519WalletScope(authorization, validatedAuthorization.ownerScope),
        ),
      }),
    },
  }));
  const upstreamBodyText = await upstream
    .clone()
    .text()
    .catch(() => '');
  if (
    isRouterAbEd25519OperationInProgressResponse({
      status: upstream.status,
      bodyText: upstreamBodyText,
    })
  ) {
    return upstream;
  }
  const completed = await timeEd25519SigningStage(timing, 'complete', completeEd25519Operation({
    ctx: input.ctx,
    operation: validatedAuthorization.operation,
    result: upstream.ok
      ? 'succeeded'
      : upstream.status < 500
        ? 'failed_before_side_effect'
        : 'failed_after_side_effect',
    response: buildEd25519ReplayResponse({ response: upstream, bodyText: upstreamBodyText }),
  }));
  return requireCompletedEd25519OperationResponse(completed);
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

  if (ctx.method !== 'POST') return null;

  const pathname = ctx.pathname;
  if (
    pathname !== ROUTER_AB_ED25519_WALLET_SESSION_PATH &&
    pathname !== ROUTER_AB_ED25519_NORMAL_SIGNING_PREPARE_PATH &&
    pathname !== ROUTER_AB_ED25519_NORMAL_SIGNING_PATH
  ) {
    return null;
  }

  const bodyUnknown = await readJson(ctx.request.clone());
  const body =
    bodyUnknown && typeof bodyUnknown === 'object' && !Array.isArray(bodyUnknown)
      ? (bodyUnknown as Record<string, unknown>)
      : {};

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
        return json(
          {
            ok: false,
            code: 'invalid_body',
            message: 'Ed25519 Yao WebAuthn budget refresh requires passkey authority',
          },
          { status: 400 },
        );
      }
      if (b.relayerKeyId !== b.sessionPolicy.relayerKeyId) {
        return json(
          {
            ok: false,
            code: 'invalid_body',
            message: 'relayerKeyId must match the Ed25519 Yao session policy',
          },
          { status: 400 },
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
        return json(
          {
            ok: false,
            code: runtimePolicyScopeResolution.code,
            message: runtimePolicyScopeResolution.message,
          },
          { status: runtimePolicyScopeResolution.status },
        );
      }
      const runtimePolicyScope = runtimePolicyScopeResolution.scope;
      if (
        !runtimePolicyScope ||
        !sameThresholdEd25519RuntimePolicyScopeV1(
          runtimePolicyScope,
          b.sessionPolicy.runtimePolicyScope,
        )
      ) {
        return json(
          {
            ok: false,
            code: 'scope_mismatch',
            message: 'Ed25519 Yao runtime policy scope does not match the active environment',
          },
          { status: 403 },
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

function sameThresholdEd25519RuntimePolicyScopeV1(
  left: RuntimePolicyScope,
  right: RuntimePolicyScope,
): boolean {
  return (
    left.orgId === right.orgId &&
    left.projectId === right.projectId &&
    left.envId === right.envId &&
    left.signingRootVersion === right.signingRootVersion
  );
}
