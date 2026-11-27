import type { WalletSessionBudget } from '@shared/threshold/walletSessionBudget';
import type { FetchRouterApiContext } from '../createFetchRouter';
import { json, jsonFailure } from '../../../framework/http';
import {
  resolveWalletSessionOperationCredentialAdmission,
  type WalletSessionOperationCredentialAdmission,
} from '../../../auth/commonRouterUtils';
import {
  parseRouterAbEcdsaPostRegistrationSessionActivationRequestV1,
  type RouterAbEcdsaPostRegistrationSessionActivationRequestV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import { WALLET_SESSION_FAILURE_CODES } from '@shared/utils/walletSessionFailure';
import {
  walletSessionFailure,
  walletSessionFailureStatus,
  type WalletSessionBoundaryFailure,
} from '../../../auth/walletSessionFailure';
import {
  EVM_ECDSA_MPC_OPERATION_KINDS,
  parseWalletSessionMintId,
  parseEcdsaAuthorizationSessionId,
  type PrincipalId,
  type EcdsaAuthorizationSessionId,
} from '@shared/authorization/capabilityKinds';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking/contracts';
import type { WalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import { walletIdFromString } from '@shared/utils/registrationIds';
import {
  buildWalletSessionCapabilitySubjectsV1,
  projectActiveWalletSession,
  type VerifiedOwnerProof,
  type WalletSessionCapabilitySubjectsV1,
} from '../../../../authorization/domain';
import { resolveWalletAuthMethodIdForAuthority } from '../../../../core/signingLanes/WalletExecutionLaneProjection';
import {
  sameRouterAbMpcMaterialActivationRef,
  routerAbMpcMaterialActivationRefToWire,
} from '@shared/utils/routerAbNormalSigningIdentity';

type VerifiedOwnerWalletSessionProof = Extract<
  VerifiedOwnerProof,
  { readonly purpose: 'wallet_session' }
>;

type StrictEcdsaOperationCredentialAuthorization =
  | {
      readonly ok: true;
      readonly kind: 'wallet_session_operation_credential_v1';
      readonly proof: VerifiedOwnerWalletSessionProof;
      readonly admission: Extract<
        WalletSessionOperationCredentialAdmission,
        { readonly curve: 'ecdsa' }
      >;
      readonly authorizationSessionId: EcdsaAuthorizationSessionId;
    }
  | WalletSessionBoundaryFailure;

type StrictEcdsaDirectWalletSessionAuthorization = {
  readonly ok: true;
  readonly kind: 'issue_direct_wallet_session_v2';
  readonly proof: VerifiedOwnerWalletSessionProof;
  readonly principalId: PrincipalId;
  readonly authorizationSessionId: EcdsaAuthorizationSessionId;
  readonly authorityRef: WalletAuthAuthorityRef;
  readonly authSource: VerifiedOwnerWalletSessionProof['authSource'];
};

function assertNeverStrictEcdsaSessionActivationAuthorization(value: never): never {
  throw new Error(`Unsupported ECDSA session activation authorization: ${String(value)}`);
}

async function authorizeStrictEcdsaSessionActivation(input: {
  readonly walletId: string;
  readonly proof: VerifiedOwnerWalletSessionProof;
}): Promise<StrictEcdsaDirectWalletSessionAuthorization | WalletSessionBoundaryFailure> {
  if (String(input.proof.walletId) !== input.walletId) {
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.scopeMismatch);
  }
  const authorizationSessionId = parseEcdsaAuthorizationSessionId(input.proof.proofId);
  if (!authorizationSessionId.ok) {
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.scopeMismatch);
  }
  return {
    ok: true,
    kind: 'issue_direct_wallet_session_v2',
    proof: input.proof,
    principalId: input.proof.principalId,
    authorizationSessionId: authorizationSessionId.value,
    authorityRef: input.proof.authority,
    authSource: input.proof.authSource,
  };
}

async function authorizeStrictEcdsaSessionActivationFromOperationCredential(input: {
  readonly authorizationSessions: FetchRouterApiContext['service']['authorizationSessions'];
  readonly walletId: string;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly proof: VerifiedOwnerWalletSessionProof;
}): Promise<StrictEcdsaOperationCredentialAuthorization> {
  let resolution: Awaited<ReturnType<typeof resolveWalletSessionOperationCredentialAdmission>>;
  try {
    resolution = await resolveWalletSessionOperationCredentialAdmission({
      authorizationSessions: input.authorizationSessions,
      token: input.operationCredential.token,
      nowMs: Date.now(),
      operation: {
        keyFamily: 'ecdsa_secp256k1',
        operationKind: EVM_ECDSA_MPC_OPERATION_KINDS.signTransaction,
      },
    });
  } catch {
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.unavailable);
  }
  if (resolution.kind !== 'admitted' || resolution.admission.curve !== 'ecdsa') {
    return walletSessionFailure(
      resolution.kind === 'not_found'
        ? WALLET_SESSION_FAILURE_CODES.invalid
        : WALLET_SESSION_FAILURE_CODES.scopeMismatch,
    );
  }
  const admission = resolution.admission;
  const session = admission.context.authorization.session;
  const proofWalletAuthMethodId = await resolveWalletAuthMethodIdForAuthority({
    walletId: session.walletId,
    authorityRef: input.proof.authority,
    authSource: input.proof.authSource,
    authMethods: [admission.context.authMethod],
  });
  if (
    String(session.walletId) !== input.walletId ||
    input.operationCredential.walletSessionId !== session.walletSessionId ||
    input.proof.tenantId !== session.tenantId ||
    input.proof.principalId !== session.principalId ||
    input.proof.walletId !== session.walletId ||
    input.proof.authority.walletId !== session.walletId ||
    input.proof.authority.walletAuthMethodId !== session.walletAuthMethodId ||
    proofWalletAuthMethodId !== session.walletAuthMethodId
  ) {
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.scopeMismatch);
  }
  const authorizationSessionId = parseEcdsaAuthorizationSessionId(input.proof.proofId);
  if (!authorizationSessionId.ok) {
    return walletSessionFailure(WALLET_SESSION_FAILURE_CODES.scopeMismatch);
  }
  return {
    ok: true,
    kind: 'wallet_session_operation_credential_v1',
    proof: input.proof,
    admission,
    authorizationSessionId: authorizationSessionId.value,
  };
}

function exactEcdsaMaterialMatchesActivation(
  capabilitySubjects: WalletSessionCapabilitySubjectsV1,
  request: RouterAbEcdsaPostRegistrationSessionActivationRequestV1,
): boolean {
  for (const subject of capabilitySubjects) {
    if (subject.kind !== 'sign' || subject.keyFamily !== 'ecdsa_secp256k1') continue;
    return sameRouterAbMpcMaterialActivationRef(
      request.public_capability.material_activation,
      routerAbMpcMaterialActivationRefToWire(subject.materialActivation),
    );
  }
  return false;
}

type StrictEcdsaSessionActivationInput =
  | {
      readonly ctx: FetchRouterApiContext;
      readonly body: unknown;
      readonly source: 'verified_wallet_unlock';
      readonly proof: VerifiedOwnerWalletSessionProof;
      /** The app's budget for the Wallet Session this activation issues. Null: none. */
      readonly walletSessionBudget: WalletSessionBudget | null;
    }
  | {
      readonly ctx: FetchRouterApiContext;
      readonly body: unknown;
      readonly source: 'wallet_session_operation_credential_v1';
      readonly operationCredential: WalletSessionOperationCredentialV1;
      readonly proof: VerifiedOwnerWalletSessionProof;
    };

export async function handleStrictEcdsaSessionActivation(
  input: StrictEcdsaSessionActivationInput,
): Promise<Response> {
  let request: RouterAbEcdsaPostRegistrationSessionActivationRequestV1;
  try {
    request = parseRouterAbEcdsaPostRegistrationSessionActivationRequestV1(input.body);
  } catch (error: unknown) {
    return jsonFailure(
      400,
      'invalid_body',
      error instanceof Error
        ? error.message
        : 'ECDSA post-registration session activation is invalid',
    );
  }
  const authorized =
    input.source === 'wallet_session_operation_credential_v1'
      ? await authorizeStrictEcdsaSessionActivationFromOperationCredential({
          authorizationSessions: input.ctx.service.authorizationSessions,
          walletId: request.public_capability.client_id,
          operationCredential: input.operationCredential,
          proof: input.proof,
        })
      : await authorizeStrictEcdsaSessionActivation({
          walletId: request.public_capability.client_id,
          proof: input.proof,
        });
  if (!authorized.ok) {
    return json(authorized, { status: walletSessionFailureStatus(authorized.code) });
  }
  if (
    authorized.kind === 'wallet_session_operation_credential_v1' &&
    (!sameRouterAbMpcMaterialActivationRef(
      request.public_capability.material_activation,
      routerAbMpcMaterialActivationRefToWire(authorized.admission.admission.materialActivation),
    ) ||
      request.session_policy.wallet_session_mint_id !==
        authorized.admission.context.authorization.session.mintId ||
      authorized.admission.context.authorization.session.tenantId !==
        authorized.admission.context.authorization.quota.tenantId ||
      authorized.admission.context.authorization.session.principalId !==
        authorized.admission.context.authorization.quota.principalId ||
      authorized.admission.context.authorization.session.walletSessionId !==
        authorized.admission.context.authorization.quota.walletSessionId ||
      authorized.admission.context.authorization.session.quotaId !==
        authorized.admission.context.authorization.quota.quotaId ||
      authorized.admission.context.authorization.session.expiresAtMs !==
        authorized.admission.context.authorization.quota.expiresAtMs)
  ) {
    return jsonFailure(
      walletSessionFailureStatus(WALLET_SESSION_FAILURE_CODES.scopeMismatch),
      WALLET_SESSION_FAILURE_CODES.scopeMismatch,
      'ECDSA activation material is outside the exact Wallet Session capability',
    );
  }
  const activated =
    await input.ctx.service.walletRegistration.activateEcdsaPostRegistrationSession(request);
  if (!activated.ok) {
    return json(activated, {
      status: activated.code === 'not_found' ? 404 : activated.code === 'internal' ? 500 : 400,
    });
  }
  const walletKey = activated.walletKey;
  const normalSigning = activated.normalSigning;
  if (
    activated.session.thresholdSessionId !== request.session_policy.threshold_session_id ||
    walletKey.walletId !== request.public_capability.client_id
  ) {
    return jsonFailure(
      403,
      'scope_mismatch',
      'ECDSA activation did not preserve the requested wallet and threshold session',
    );
  }
  if (authorized.kind === 'wallet_session_operation_credential_v1') {
    const session = authorized.admission.context.authorization.session;
    const quota = authorized.admission.context.authorization.quota;
    if (session.walletId !== walletKey.walletId) {
      return jsonFailure(
        403,
        'scope_mismatch',
        'ECDSA activation did not preserve the exact Wallet Session',
      );
    }
    return json(
      {
        kind: 'router_ab_ecdsa_credential_free_session_activated_v1',
        public_capability: request.public_capability,
        session: {
          authorization_session_id: authorized.authorizationSessionId,
          authorization_id: session.authorizationId,
          threshold_session_id: activated.session.thresholdSessionId,
          wallet_session_id: session.walletSessionId,
          quota_id: session.quotaId,
          expires_at_ms: session.expiresAtMs,
          remaining_uses: quota.remainingUses,
        },
        normal_signing: normalSigning,
      },
      { status: 200 },
    );
  }
  if (authorized.kind === 'issue_direct_wallet_session_v2') {
    const mintId = parseWalletSessionMintId(request.session_policy.wallet_session_mint_id);
    if (!mintId.ok) {
      return jsonFailure(400, 'invalid_body', 'ECDSA Wallet Session mint identity is invalid');
    }
    const activeAuthority =
      await input.ctx.service.walletAuthMethods.resolveActiveWalletSessionAuthority({
        walletId: walletIdFromString(walletKey.walletId),
        authorityRef: authorized.authorityRef,
        authSource: authorized.authSource,
      });
    if (activeAuthority.kind === 'rejected') {
      return jsonFailure(401, activeAuthority.code, activeAuthority.message);
    }
    const capabilitySubjects = buildWalletSessionCapabilitySubjectsV1(activeAuthority.authority);
    if (!exactEcdsaMaterialMatchesActivation(capabilitySubjects, request)) {
      return jsonFailure(
        403,
        'scope_mismatch',
        'ECDSA activation material is outside the resolved Wallet Session authority',
      );
    }
    const directIssue =
      await input.ctx.service.authorizationSessions.issueDirectWalletSessionAuthorizationV2({
        tenantId: input.ctx.service.authorizationSessions.tenantId,
        principalId: authorized.principalId,
        walletId: walletIdFromString(walletKey.walletId),
        authority: activeAuthority.authority,
        walletAuthMethodId: activeAuthority.authMethod.walletAuthMethodId,
        mintId: mintId.value,
        requestedBudget: input.source === 'verified_wallet_unlock' ? input.walletSessionBudget : null,
        issuedAtMs: Date.now(),
      });
    if (directIssue.kind === 'already_committed') {
      return json(
        {
          ok: false,
          code: 'already_committed',
          next: directIssue.next,
          wallet_id: directIssue.walletId,
          authority_id: directIssue.authorityId,
          wallet_auth_method_id: directIssue.walletAuthMethodId,
          authorization_id: directIssue.authorizationId,
          wallet_session_id: directIssue.walletSessionId,
          quota_id: directIssue.quotaId,
        },
        { status: 409 },
      );
    }
    return json(
      {
        kind: 'router_ab_ecdsa_post_registration_session_activated_v1',
        public_capability: request.public_capability,
        session: {
          authorization_session_id: authorized.authorizationSessionId,
          authorization_id: directIssue.session.authorizationId,
          threshold_session_id: activated.session.thresholdSessionId,
          wallet_session_id: directIssue.session.walletSessionId,
          quota_id: directIssue.session.quotaId,
          expires_at_ms: directIssue.session.expiresAtMs,
          remaining_uses: directIssue.quota.remainingUses,
          wallet_session: projectActiveWalletSession(directIssue),
          operation_credential: directIssue.operationCredential,
        },
        normal_signing: normalSigning,
      },
      { status: 200 },
    );
  }
  return assertNeverStrictEcdsaSessionActivationAuthorization(authorized);
}
