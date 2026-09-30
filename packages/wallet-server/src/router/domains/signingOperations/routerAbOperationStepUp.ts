// Operation step-up authentication: a Wallet Session credential or a verified owner proof becomes
// a step-up session, and a recorded step-up operation is claimed.
import { resolveWalletSessionOperationCredentialAdmission } from '../../auth/commonRouterUtils';
import { extractBearerCredential } from '../../auth/routerApiKeyAuth';
import { base64UrlEncode } from '@shared/utils/encoders';
import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type {
  RouterApiAuthorizedOperationService,
  RouterApiAuthorizationSessionService,
  RouterApiWalletRegistrationService,
  RouterApiWalletSessionAuthorizationV2AdmissionContext,
  RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext,
} from '../../framework/authServicePort';
import { resolveWalletSessionAuthorizationV2Admission } from './walletExecutionAdmission';
import type { WalletExecutionLaneAuthSource } from '../../../core/signingLanes/WalletExecutionLaneProjection';
import {
  walletAuthAuthorityRef,
  type WalletAuthAuthority,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import {
  parsePrincipalId,
  type PrincipalId,
  type TenantId,
} from '@shared/authorization/capabilityKinds';
import {
  parseSessionOrigin,
  type AuthorizedOperation,
  type AuthorizedOperationInput,
  type SessionOrigin,
} from '../../../authorization/domain';
import {
  routerAbMpcMaterialActivationRefToWire,
  sameRouterAbMpcMaterialActivationRef,
  type RouterAbMpcMaterialActivationRefWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import type { Ed25519OperationKind } from './ed25519AuthorizedOperationReceipt';
import { parseProviderSubject, type WalletAuthMethodId } from '@shared/utils/domainIds';
import {
  type RouterAbJsonRouteResult,
  routerAbStepUpError,
} from './routerAbNormalSigningAdmission';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

export type ActiveEd25519MaterialActivation = Extract<
  Awaited<ReturnType<RouterApiWalletRegistrationService['resolveEd25519MaterialActivation']>>,
  { readonly ok: true }
>;

export type ActiveEcdsaMaterialActivation = Extract<
  Awaited<ReturnType<RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation']>>,
  { readonly ok: true }
>;

type RouterAbOperationStepUpWalletSessionBase = {
  readonly tenantId: TenantId;
  readonly principalId: PrincipalId;
  readonly sessionId: string;
  readonly walletId: string;
  readonly runtimePolicyScope: RuntimePolicyScope;
};

export type RouterAbExactOperationStepUpWalletSession = RouterAbOperationStepUpWalletSessionBase & {
  readonly laneAuthorization: {
    readonly kind: 'wallet_auth_method';
    readonly walletAuthMethodId: WalletAuthMethodId;
  };
};

type RouterAbVerifiedOwnerOperationStepUpWalletSession =
  RouterAbOperationStepUpWalletSessionBase & {
    readonly laneAuthorization: {
      readonly kind: 'authority_ref';
      readonly authorityRef: WalletAuthAuthorityRef;
      readonly authSource: WalletExecutionLaneAuthSource;
    };
  };

export type RouterAbOperationStepUpWalletSession =
  | RouterAbExactOperationStepUpWalletSession
  | RouterAbVerifiedOwnerOperationStepUpWalletSession;

type RouterAbEd25519OperationStepUpSessionResolution =
  | {
      readonly ok: true;
      readonly activeMaterial: ActiveEd25519MaterialActivation;
      readonly session: RouterAbExactOperationStepUpWalletSession;
    }
  | RouterAbOperationStepUpAuthenticationFailure;

export async function resolveRouterAbEd25519OperationStepUpSession(input: {
  readonly walletId: string;
  readonly materialOwner: string;
  readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  readonly requestExpiresAtMs: number;
  readonly operationKind: Ed25519OperationKind;
  readonly authorizedOperations: RouterApiAuthorizedOperationService;
  readonly session: RouterApiWalletSessionAuthorizationV2AdmissionContext['authorization']['session'];
  readonly admission: Extract<
    ReturnType<typeof resolveWalletSessionAuthorizationV2Admission>,
    { readonly ok: true; readonly keyFamily: 'ed25519' }
  >;
  readonly resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
}): Promise<RouterAbEd25519OperationStepUpSessionResolution> {
  const admittedMaterialActivation = routerAbMpcMaterialActivationRefToWire(
    input.admission.materialActivation,
  );
  if (
    input.admission.operationKind !== input.operationKind ||
    String(input.session.walletId) !== input.walletId ||
    input.materialOwner !== input.walletId ||
    !Number.isSafeInteger(input.requestExpiresAtMs) ||
    input.requestExpiresAtMs > input.session.expiresAtMs ||
    !sameRouterAbMpcMaterialActivationRef(admittedMaterialActivation, input.materialActivation)
  ) {
    return walletSessionScopeInvalidFailure();
  }

  let activeMaterial: Awaited<
    ReturnType<RouterApiWalletRegistrationService['resolveEd25519MaterialActivation']>
  >;
  try {
    activeMaterial = await input.resolveEd25519MaterialActivation({
      walletId: input.walletId,
      materialActivation: admittedMaterialActivation,
    });
  } catch {
    return walletSessionUnavailableFailure();
  }
  if (
    !activeMaterial.ok ||
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      admittedMaterialActivation,
    ) ||
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.exportIdentity.scope.material_activation,
      admittedMaterialActivation,
    ) ||
    activeMaterial.exportIdentity.scope.account_id !== input.walletId ||
    activeMaterial.exportIdentity.application_binding.wallet_id !== input.walletId ||
    base64UrlEncode(Uint8Array.from(activeMaterial.exportIdentity.registered_public_key)) !==
      input.admission.signer.registeredPublicKeyB64u
  ) {
    return {
      ok: false,
      error: routerAbStepUpError(
        activeMaterial.ok || activeMaterial.code !== 'internal' ? 403 : 503,
        activeMaterial.ok || activeMaterial.code !== 'internal'
          ? 'scope_mismatch'
          : 'wallet_session_unavailable',
        activeMaterial.ok
          ? 'Wallet Session material does not match the active Ed25519 material'
          : activeMaterial.message,
      ),
    };
  }
  const exact = exactOperationStepUpSession({
    session: input.session,
    authorizedOperations: input.authorizedOperations,
    runtimePolicyScope: activeMaterial.runtimePolicyScope,
  });
  if (!exact.ok) return exact;
  return { ok: true, activeMaterial, session: exact.session };
}

type RouterAbExactOperationStepUpIdentityInput = {
  readonly kind: 'wallet_session_operation_credential_v1';
  readonly headers: Record<string, string | string[] | undefined>;
  readonly walletId: string;
  readonly materialOwner: string;
  readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  readonly requestExpiresAtMs: number;
  readonly authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  readonly authorizationSessions: RouterApiAuthorizationSessionService | null | undefined;
} & ReadonlyExclusiveUnion<
  | {
      readonly keyFamily: 'ed25519';
      readonly operationKind: Ed25519OperationKind;
      readonly resolveEd25519MaterialActivation: RouterApiWalletRegistrationService['resolveEd25519MaterialActivation'];
    }
  | {
      readonly keyFamily: 'ecdsa_secp256k1';
      readonly operationKind: 'evm.sign_transaction' | 'evm.export_key';
      readonly resolveEcdsaMaterialActivation: RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation'];
    }
>;

type RouterAbVerifiedOwnerOperationStepUpIdentityInput = {
  readonly kind: 'verified_owner_proof';
  readonly headers: Record<string, string | string[] | undefined>;
  readonly walletId: string;
  readonly materialOwner: string;
  readonly operationId: string;
  readonly authority: WalletAuthAuthority;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly expiresAtMs: number;
  readonly authorizedOperations: RouterApiAuthorizedOperationService | null | undefined;
  readonly authorizationSessions?: never;
  readonly keyFamily?: never;
  readonly operationKind?: never;
  readonly materialActivation?: never;
  readonly requestExpiresAtMs?: never;
  readonly resolveEd25519MaterialActivation?: never;
  readonly resolveEcdsaMaterialActivation?: never;
};

export type RouterAbOperationStepUpAuthenticationFailure = {
  readonly ok: false;
  readonly error: RouterAbJsonRouteResult;
};

type RouterAbOperationStepUpAuthenticationSuccess<
  TSession extends RouterAbOperationStepUpWalletSession,
> = {
  readonly ok: true;
  readonly authorizedOperations: RouterApiAuthorizedOperationService;
  readonly session: TSession;
  readonly requestOrigin: SessionOrigin;
  readonly expiresAtMs: number;
};

export type RouterAbExactOperationStepUpAuthenticationResult =
  | RouterAbOperationStepUpAuthenticationSuccess<RouterAbExactOperationStepUpWalletSession>
  | RouterAbOperationStepUpAuthenticationFailure;

type RouterAbVerifiedOwnerOperationStepUpAuthenticationResult =
  | (RouterAbOperationStepUpAuthenticationSuccess<RouterAbVerifiedOwnerOperationStepUpWalletSession> & {
      readonly authorityRef: WalletAuthAuthorityRef;
    })
  | RouterAbOperationStepUpAuthenticationFailure;

export function walletSessionUnavailableFailure(): RouterAbOperationStepUpAuthenticationFailure {
  return {
    ok: false,
    error: routerAbStepUpError(503, 'wallet_session_unavailable', 'Wallet Session is unavailable'),
  };
}

export function walletSessionScopeInvalidFailure(): RouterAbOperationStepUpAuthenticationFailure {
  return {
    ok: false,
    error: routerAbStepUpError(403, 'scope_mismatch', 'Wallet Session scope is invalid'),
  };
}

export function parseStepUpRequestOrigin(
  headers: Record<string, string | string[] | undefined>,
):
  | { readonly ok: true; readonly requestOrigin: SessionOrigin }
  | RouterAbOperationStepUpAuthenticationFailure {
  const requestOriginRaw =
    (Array.isArray(headers.origin) ? headers.origin[0] : headers.origin) || '';
  try {
    return { ok: true, requestOrigin: parseSessionOrigin(String(requestOriginRaw).trim()) };
  } catch {
    return {
      ok: false,
      error: routerAbStepUpError(401, 'unauthorized', 'Wallet owner proof origin is invalid'),
    };
  }
}

export function walletSessionCandidateAdmission(
  session: RouterApiWalletSessionAuthorizationV2AdmissionContext['authorization']['session'],
  candidate: Pick<
    RouterApiWalletSessionAuthorizationV2AdmissionContext,
    'authority' | 'authMethod' | 'retiredAtMs'
  >,
  operation:
    | { readonly keyFamily: 'ed25519'; readonly operationKind: Ed25519OperationKind }
    | { readonly keyFamily: 'ecdsa_secp256k1'; readonly operationKind: 'evm.sign_transaction' },
) {
  return resolveWalletSessionAuthorizationV2Admission({
    authorization: session,
    authority: candidate.authority,
    authMethod: candidate.authMethod,
    operation: {
      tenantId: session.tenantId,
      principalId: session.principalId,
      walletId: session.walletId,
      ...operation,
    },
    retiredAtMs: candidate.retiredAtMs,
    nowMs: Date.now(),
  });
}

// An exhausted Wallet Session can still authorize the operation it already admitted, so a
// request whose session is unavailable reads the exhausted candidate for its credential.
export async function readExhaustedWalletSessionCandidate(input: {
  readonly authorizationSessions: RouterApiAuthorizationSessionService;
  readonly token: string;
  readonly operation: Parameters<typeof walletSessionCandidateAdmission>[2];
}): Promise<
  | {
      readonly ok: true;
      readonly candidate: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext;
      readonly session: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext['status']['session'];
      readonly admission: ReturnType<typeof walletSessionCandidateAdmission>;
    }
  | RouterAbOperationStepUpAuthenticationFailure
  | null
> {
  let candidate: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext | null;
  try {
    candidate =
      await input.authorizationSessions.readExhaustedWalletSessionAuthorizationV2CandidateByOperationCredential(
        {
          tenantId: input.authorizationSessions.tenantId,
          token: input.token,
          nowMs: Date.now(),
        },
      );
  } catch {
    return walletSessionUnavailableFailure();
  }
  if (!candidate) return null;
  const session = candidate.status.session;
  return {
    ok: true,
    candidate,
    session,
    admission: walletSessionCandidateAdmission(session, candidate, input.operation),
  };
}

export function ecdsaStepUpActiveMaterial(input: {
  readonly activeMaterial: Awaited<
    ReturnType<RouterApiWalletRegistrationService['resolveEcdsaMaterialActivation']>
  >;
  readonly admittedMaterialActivation: RouterAbMpcMaterialActivationRefWire;
  readonly walletId: string;
  readonly signer: { readonly thresholdPublicKey33B64u: string; readonly evmAddress: string };
}):
  | { readonly ok: true; readonly activeMaterial: ActiveEcdsaMaterialActivation }
  | RouterAbOperationStepUpAuthenticationFailure {
  const activeMaterial = input.activeMaterial;
  const normalSigning = activeMaterial.ok
    ? activeMaterial.routerAbEcdsaDerivationNormalSigning
    : null;
  if (
    !activeMaterial.ok ||
    !normalSigning ||
    !sameRouterAbMpcMaterialActivationRef(
      activeMaterial.materialActivation,
      input.admittedMaterialActivation,
    ) ||
    !sameRouterAbMpcMaterialActivationRef(
      normalSigning.scope.material_activation,
      input.admittedMaterialActivation,
    ) ||
    normalSigning.scope.wallet_id !== input.walletId ||
    normalSigning.scope.public_identity.threshold_public_key33_b64u !==
      input.signer.thresholdPublicKey33B64u ||
    normalSigning.scope.public_identity.ethereum_address20_b64u !==
      evmAddress20B64u(input.signer.evmAddress)
  ) {
    return {
      ok: false,
      error: routerAbStepUpError(
        activeMaterial.ok || activeMaterial.code !== 'internal' ? 403 : 503,
        activeMaterial.ok || activeMaterial.code !== 'internal'
          ? 'scope_mismatch'
          : 'wallet_session_unavailable',
        activeMaterial.ok
          ? 'Wallet Session material does not match the active ECDSA material'
          : activeMaterial.message,
      ),
    };
  }
  return { ok: true, activeMaterial };
}

export function exactOperationStepUpSession(input: {
  readonly session: RouterApiWalletSessionAuthorizationV2AdmissionContext['authorization']['session'];
  readonly authorizedOperations: Pick<RouterApiAuthorizedOperationService, 'tenantId'>;
  readonly runtimePolicyScope: RuntimePolicyScope;
}):
  | { readonly ok: true; readonly session: RouterAbExactOperationStepUpWalletSession }
  | RouterAbOperationStepUpAuthenticationFailure {
  if (
    input.session.tenantId !== input.authorizedOperations.tenantId ||
    input.runtimePolicyScope.orgId !== input.session.tenantId ||
    input.session.expiresAtMs <= Date.now()
  ) {
    return walletSessionScopeInvalidFailure();
  }
  return {
    ok: true,
    session: {
      tenantId: input.session.tenantId,
      principalId: input.session.principalId,
      sessionId: String(input.session.authorizationId),
      walletId: String(input.session.walletId),
      runtimePolicyScope: input.runtimePolicyScope,
      laneAuthorization: {
        kind: 'wallet_auth_method',
        walletAuthMethodId: input.session.walletAuthMethodId,
      },
    },
  };
}

export function authenticateRouterAbWalletOperationStepUpIdentity(
  input: RouterAbExactOperationStepUpIdentityInput,
): Promise<RouterAbExactOperationStepUpAuthenticationResult>;
export function authenticateRouterAbWalletOperationStepUpIdentity(
  input: RouterAbVerifiedOwnerOperationStepUpIdentityInput,
): Promise<RouterAbVerifiedOwnerOperationStepUpAuthenticationResult>;
export async function authenticateRouterAbWalletOperationStepUpIdentity(
  input:
    | RouterAbExactOperationStepUpIdentityInput
    | RouterAbVerifiedOwnerOperationStepUpIdentityInput,
): Promise<
  | RouterAbExactOperationStepUpAuthenticationResult
  | RouterAbVerifiedOwnerOperationStepUpAuthenticationResult
> {
  if (!input.authorizedOperations) {
    return {
      ok: false,
      error: routerAbStepUpError(
        501,
        'not_configured',
        'Router A/B operation step-up authorization is not configured',
      ),
    };
  }
  const origin = parseStepUpRequestOrigin(input.headers);
  if (!origin.ok) return origin;
  const requestOrigin = origin.requestOrigin;
  if (input.kind === 'verified_owner_proof') {
    const tenantId = input.authorizedOperations.tenantId;
    const authorityRef = await walletAuthAuthorityRef({ authority: input.authority });
    const principal = parsePrincipalId(
      input.authority.factor.kind === 'email_otp'
        ? input.authority.factor.providerUserId
        : input.walletId,
    );
    const authSource = walletExecutionLaneAuthSourceFromAuthority(input.authority);
    if (
      !principal.ok ||
      !authSource ||
      input.walletId !== input.materialOwner ||
      input.authority.walletId !== input.walletId ||
      input.runtimePolicyScope.orgId !== tenantId ||
      input.expiresAtMs <= Date.now()
    ) {
      return {
        ok: false,
        error: routerAbStepUpError(403, 'scope_mismatch', 'Wallet owner proof scope is invalid'),
      };
    }
    return {
      ok: true,
      authorizedOperations: input.authorizedOperations,
      session: {
        tenantId,
        principalId: principal.value,
        sessionId: input.operationId,
        walletId: input.walletId,
        runtimePolicyScope: input.runtimePolicyScope,
        laneAuthorization: {
          kind: 'authority_ref',
          authorityRef,
          authSource,
        },
      },
      authorityRef,
      requestOrigin,
      expiresAtMs: input.expiresAtMs,
    };
  }
  if (!input.authorizationSessions) {
    return {
      ok: false,
      error: routerAbStepUpError(
        501,
        'not_configured',
        'Router A/B Wallet Sessions are not configured',
      ),
    };
  }
  const token = extractBearerCredential(input.headers);
  if (!token) {
    return {
      ok: false,
      error: routerAbStepUpError(401, 'unauthorized', 'Wallet Session is required'),
    };
  }
  let resolution: Awaited<ReturnType<typeof resolveWalletSessionOperationCredentialAdmission>>;
  try {
    const operation =
      input.keyFamily === 'ed25519'
        ? {
            keyFamily: 'ed25519' as const,
            operationKind: input.operationKind,
          }
        : {
            keyFamily: 'ecdsa_secp256k1' as const,
            operationKind: input.operationKind,
          };
    resolution = await resolveWalletSessionOperationCredentialAdmission({
      authorizationSessions: input.authorizationSessions,
      token,
      nowMs: Date.now(),
      operation,
    });
  } catch {
    return walletSessionUnavailableFailure();
  }
  if (resolution.kind === 'not_found') {
    return {
      ok: false,
      error: routerAbStepUpError(401, 'unauthorized', 'Wallet Session is invalid'),
    };
  }
  if (resolution.kind === 'rejected') return walletSessionScopeInvalidFailure();
  const admission = resolution.admission;
  const session = admission.context.authorization.session;
  const admittedMaterialActivation = routerAbMpcMaterialActivationRefToWire(
    admission.admission.materialActivation,
  );
  if (admission.curve === 'ed25519' && input.keyFamily === 'ed25519') {
    const resolved = await resolveRouterAbEd25519OperationStepUpSession({
      walletId: input.walletId,
      materialOwner: input.materialOwner,
      materialActivation: input.materialActivation,
      requestExpiresAtMs: input.requestExpiresAtMs,
      operationKind: input.operationKind,
      authorizedOperations: input.authorizedOperations,
      session,
      admission: admission.admission,
      resolveEd25519MaterialActivation: input.resolveEd25519MaterialActivation,
    });
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return {
      ok: true,
      authorizedOperations: input.authorizedOperations,
      session: resolved.session,
      requestOrigin,
      expiresAtMs: session.expiresAtMs,
    };
  }
  if (
    admission.admission.keyFamily !== input.keyFamily ||
    admission.admission.operationKind !== input.operationKind ||
    String(session.walletId) !== input.walletId ||
    input.materialOwner !== input.walletId ||
    !Number.isSafeInteger(input.requestExpiresAtMs) ||
    input.requestExpiresAtMs > session.expiresAtMs ||
    !sameRouterAbMpcMaterialActivationRef(admittedMaterialActivation, input.materialActivation)
  ) {
    return walletSessionScopeInvalidFailure();
  }
  let runtimePolicyScope: RuntimePolicyScope;
  try {
    if (admission.curve === 'ecdsa' && input.keyFamily === 'ecdsa_secp256k1') {
      const active = ecdsaStepUpActiveMaterial({
        activeMaterial: await input.resolveEcdsaMaterialActivation({
          walletId: input.walletId,
          materialActivation: admittedMaterialActivation,
        }),
        admittedMaterialActivation,
        walletId: input.walletId,
        signer: admission.admission.signer,
      });
      if (!active.ok) return active;
      runtimePolicyScope = active.activeMaterial.runtimePolicyScope;
    } else {
      return {
        ok: false,
        error: routerAbStepUpError(403, 'scope_mismatch', 'Wallet Session family is invalid'),
      };
    }
  } catch {
    return walletSessionUnavailableFailure();
  }
  const exact = exactOperationStepUpSession({
    session,
    authorizedOperations: input.authorizedOperations,
    runtimePolicyScope,
  });
  if (!exact.ok) return exact;
  return {
    ok: true,
    authorizedOperations: input.authorizedOperations,
    session: exact.session,
    requestOrigin,
    expiresAtMs: session.expiresAtMs,
  };
}

function walletExecutionLaneAuthSourceFromAuthority(
  authority: WalletAuthAuthority,
): WalletExecutionLaneAuthSource | null {
  if (authority.factor.kind === 'passkey') {
    return {
      kind: 'passkey',
      credentialIdB64u: authority.factor.credentialIdB64u,
    };
  }
  const providerSubject = parseProviderSubject(authority.factor.providerUserId);
  return providerSubject.ok
    ? {
        kind: 'oidc_provider',
        providerId: authority.factor.provider === 'google' ? 'google_oidc' : 'oidc',
        providerSubject: providerSubject.value,
      }
    : null;
}

function evmAddress20B64u(value: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  const bytes = new Uint8Array(20);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return base64UrlEncode(bytes);
}

// A step-up claims the operation exactly as it was recorded: verified step-up evidence and
// no quota.
export function recordedStepUpOperationClaim(
  existing: AuthorizedOperation,
):
  | { readonly ok: true; readonly operation: AuthorizedOperationInput }
  | { readonly ok: false; readonly error: RouterAbJsonRouteResult } {
  if (
    existing.authorization.kind !== 'verified_step_up' ||
    existing.quota.kind !== 'quota_neutral'
  ) {
    return {
      ok: false,
      error: routerAbStepUpError(
        409,
        'authorized_operation_missing',
        'Operation authorization has an invalid source or quota',
      ),
    };
  }
  return {
    ok: true,
    operation: {
      tenantId: existing.tenantId,
      authorizedOperationId: existing.authorizedOperationId,
      auditEventId: existing.auditEventId,
      operation: existing.operation,
      authorization: existing.authorization,
      quota: existing.quota,
      claimedAtMs: Date.now(),
    },
  };
}

export function routerAbOperationStepUpClaimFailure(
  result: Awaited<ReturnType<RouterApiAuthorizedOperationService['admitAuthorizedOperation']>>,
): RouterAbJsonRouteResult | null {
  switch (result.kind) {
    case 'claimed':
    case 'operation_in_progress':
    case 'replayed':
      return null;
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
      return routerAbStepUpError(403, result.kind, 'Operation step-up authorization is invalid');
    case 'wallet_session_quota_exhausted':
      return routerAbStepUpError(409, result.kind, 'Operation step-up authorization is invalid');
    case 'material_mismatch':
      return routerAbStepUpError(403, result.kind, 'Operation step-up material is invalid');
  }
}
