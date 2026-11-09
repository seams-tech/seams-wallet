import type { RouterAbEd25519YaoRecoveryAdmissionRequestV1 } from '@shared/utils/routerAbEd25519Yao';
import { sameRouterAbEd25519YaoByteSequence } from '@shared/utils/routerAbEd25519Yao';
import { base64UrlEncode } from '@shared/utils/base64';
import type {
  RouterApiAuthorizationSessionService,
  RouterApiWalletRegistrationService,
} from '../../../framework/authServicePort';
import { extractBearerCredential } from '../../../auth/routerApiKeyAuth';
import { resolveWalletSessionOperationCredentialAdmission } from '../../../auth/commonRouterUtils';
import { walletSessionFailureMessage } from '../../../auth/walletSessionFailure';
import { NEAR_ED25519_MPC_OPERATION_KINDS } from '@shared/authorization/capabilityKinds';
import {
  routerAbMpcMaterialActivationRefToWire,
  sameRouterAbMpcMaterialActivationRef,
} from '@shared/utils/routerAbNormalSigningIdentity';

/**
 * The checks that tie an Ed25519 Wallet Session bearer to the wallet's active
 * material. Recovery and reissue admissions both use them.
 */

export type WalletSessionAuthorizationFailureV1 = {
  readonly ok: false;
  readonly status: 401 | 403 | 409 | 429 | 503;
  readonly code: string;
  readonly message: string;
};

export type WalletSessionMaterialServicesV1 = {
  readonly authorizationSessions: RouterApiAuthorizationSessionService;
  readonly resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
};

export function walletSessionAuthorizationFailure(input: {
  readonly status: 401 | 403 | 409 | 429 | 503;
  readonly code: string;
  readonly message: string;
}): WalletSessionAuthorizationFailureV1 {
  return { ok: false, status: input.status, code: input.code, message: input.message };
}

export function sameRouterAbEd25519YaoApplicationBindingV1(
  left: RouterAbEd25519YaoRecoveryAdmissionRequestV1['application_binding'],
  right: RouterAbEd25519YaoRecoveryAdmissionRequestV1['application_binding'],
): boolean {
  return (
    left.wallet_id === right.wallet_id &&
    left.near_ed25519_signing_key_id === right.near_ed25519_signing_key_id &&
    left.signing_root_id === right.signing_root_id &&
    left.key_creation_signer_slot === right.key_creation_signer_slot
  );
}

export type ExactEd25519OperationCredentialAdmission = Extract<
  Extract<
    Awaited<ReturnType<typeof resolveWalletSessionOperationCredentialAdmission>>,
    { readonly kind: 'admitted' }
  >['admission'],
  { readonly curve: 'ed25519' }
>;

export type ActiveEd25519MaterialResolution = Extract<
  Awaited<ReturnType<RouterApiWalletRegistrationService['resolveEd25519MaterialActivation']>>,
  { readonly ok: true }
>;

type ExactEd25519OperationCredentialAdmissionResolution =
  | {
      readonly kind: 'authorized';
      readonly admission: ExactEd25519OperationCredentialAdmission;
    }
  | {
      readonly kind: 'rejected';
      readonly result: WalletSessionAuthorizationFailureV1;
    };

export type ExactEd25519OperationCredentialMaterialResolution =
  | {
      readonly kind: 'authorized';
      readonly admission: ExactEd25519OperationCredentialAdmission;
      readonly activeMaterial: ActiveEd25519MaterialResolution;
      readonly materialActivation: ActiveEd25519MaterialResolution['materialActivation'];
    }
  | {
      readonly kind: 'rejected';
      readonly result: WalletSessionAuthorizationFailureV1;
    };

export async function resolveExactEd25519OperationCredentialAdmission(input: {
  readonly request: Request;
  readonly services: WalletSessionMaterialServicesV1;
}): Promise<ExactEd25519OperationCredentialAdmissionResolution> {
  const token = extractBearerCredential(input.request.headers);
  if (!token) {
    return {
      kind: 'rejected',
      result: walletSessionAuthorizationFailure({
        status: 401,
        code: 'wallet_session_missing',
        message: walletSessionFailureMessage('wallet_session_missing'),
      }),
    };
  }
  let resolution: Awaited<ReturnType<typeof resolveWalletSessionOperationCredentialAdmission>>;
  try {
    resolution = await resolveWalletSessionOperationCredentialAdmission({
      authorizationSessions: input.services.authorizationSessions,
      token,
      nowMs: Date.now(),
      operation: {
        keyFamily: 'ed25519',
        operationKind: NEAR_ED25519_MPC_OPERATION_KINDS.signTransaction,
      },
    });
  } catch {
    return {
      kind: 'rejected',
      result: walletSessionAuthorizationFailure({
        status: 503,
        code: 'wallet_session_unavailable',
        message: walletSessionFailureMessage('wallet_session_unavailable'),
      }),
    };
  }
  if (resolution.kind === 'not_found') {
    return {
      kind: 'rejected',
      result: walletSessionAuthorizationFailure({
        status: 401,
        code: 'wallet_session_invalid',
        message: walletSessionFailureMessage('wallet_session_invalid'),
      }),
    };
  }
  if (resolution.kind !== 'admitted' || resolution.admission.curve !== 'ed25519') {
    return {
      kind: 'rejected',
      result: walletSessionAuthorizationFailure({
        status: 403,
        code: 'wallet_session_scope_mismatch',
        message: walletSessionFailureMessage('wallet_session_scope_mismatch'),
      }),
    };
  }
  return { kind: 'authorized', admission: resolution.admission };
}

/** The unexhausted Ed25519 Wallet Session of the bearer and its active material. */
export async function resolveExactEd25519OperationCredentialMaterial(input: {
  readonly request: Request;
  readonly services: WalletSessionMaterialServicesV1;
}): Promise<ExactEd25519OperationCredentialMaterialResolution> {
  const credential = await resolveExactEd25519OperationCredentialAdmission(input);
  if (credential.kind === 'rejected') return credential;
  const admission = credential.admission;
  const walletId = String(admission.context.authorization.session.walletId);
  const materialActivation = routerAbMpcMaterialActivationRefToWire(
    admission.admission.materialActivation,
  );
  let activeMaterial: Awaited<
    ReturnType<RouterApiWalletRegistrationService['resolveEd25519MaterialActivation']>
  >;
  try {
    activeMaterial = await input.services.resolveEd25519MaterialActivation({
      walletId,
      materialActivation,
    });
  } catch {
    return {
      kind: 'rejected',
      result: walletSessionAuthorizationFailure({
        status: 503,
        code: 'wallet_session_unavailable',
        message: walletSessionFailureMessage('wallet_session_unavailable'),
      }),
    };
  }
  if (!activeMaterial.ok) {
    const code =
      activeMaterial.code === 'internal'
        ? 'wallet_session_unavailable'
        : 'wallet_session_scope_mismatch';
    return {
      kind: 'rejected',
      result: walletSessionAuthorizationFailure({
        status: activeMaterial.code === 'internal' ? 503 : 403,
        code,
        message: walletSessionFailureMessage(code),
      }),
    };
  }
  return { kind: 'authorized', admission, activeMaterial, materialActivation };
}

/** The request names the Wallet Session's wallet, signer and active material exactly. */
export function activeEd25519AdmissionMatchesWalletSession(input: {
  readonly request: Pick<
    RouterAbEd25519YaoRecoveryAdmissionRequestV1,
    | 'scope'
    | 'active_material_activation'
    | 'application_binding'
    | 'participant_ids'
    | 'registered_public_key'
  >;
  readonly admission: ExactEd25519OperationCredentialAdmission;
  readonly activeMaterial: ActiveEd25519MaterialResolution;
  readonly materialActivation: ActiveEd25519MaterialResolution['materialActivation'];
}): boolean {
  const request = input.request;
  const identity = input.activeMaterial.exportIdentity;
  const walletId = String(input.admission.context.authorization.session.walletId);
  const registeredPublicKeyB64u = base64UrlEncode(Uint8Array.from(identity.registered_public_key));
  return (
    String(input.admission.admission.signer.walletId) === walletId &&
    registeredPublicKeyB64u === input.admission.admission.signer.registeredPublicKeyB64u &&
    request.scope.account_id === walletId &&
    request.application_binding.wallet_id === walletId &&
    sameRouterAbMpcMaterialActivationRef(
      request.active_material_activation,
      input.materialActivation,
    ) &&
    sameRouterAbMpcMaterialActivationRef(
      input.activeMaterial.materialActivation,
      input.materialActivation,
    ) &&
    sameRouterAbMpcMaterialActivationRef(
      identity.scope.material_activation,
      input.materialActivation,
    ) &&
    request.scope.root_share_epoch === identity.scope.root_share_epoch &&
    request.scope.account_id === identity.scope.account_id &&
    request.scope.threshold_session_id === identity.scope.threshold_session_id &&
    request.scope.signer_set_id === identity.scope.signer_set_id &&
    request.scope.signing_worker_id === identity.scope.signing_worker_id &&
    input.activeMaterial.runtimePolicyScope.signingRootVersion === request.scope.root_share_epoch &&
    input.activeMaterial.nearAccountId.length > 0 &&
    input.activeMaterial.signerSlot === request.application_binding.key_creation_signer_slot &&
    input.activeMaterial.signingWorkerId === request.scope.signing_worker_id &&
    sameRouterAbEd25519YaoApplicationBindingV1(
      request.application_binding,
      identity.application_binding,
    ) &&
    request.participant_ids[0] === input.activeMaterial.participantIds[0] &&
    request.participant_ids[1] === input.activeMaterial.participantIds[1] &&
    request.participant_ids[0] === identity.participant_ids[0] &&
    request.participant_ids[1] === identity.participant_ids[1] &&
    sameRouterAbEd25519YaoByteSequence(
      request.registered_public_key,
      identity.registered_public_key,
    )
  );
}
