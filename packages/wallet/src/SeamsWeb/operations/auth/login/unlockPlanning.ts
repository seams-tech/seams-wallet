import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import { parseWalletSessionHome } from '@shared/device-linking/activeWalletSession';
import { emitUnlockEvent } from '../unlockCompletion';
import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import type {
  EcdsaKeyFactsInventoryWalletSessionCredential,
  LoginHooksOptions,
} from '@/core/types/sdkSentEvents';
import { UnlockEventPhase } from '@/core/types/sdkSentEvents';
import type {
  LoginResult,
  SigningSessionStatus,
  ThresholdWarmLoginAndCreateSessionResult,
  WalletAuthMethod,
} from '@/core/types/seams';
import type { LoginWebContext, UserAccountLookupSurface } from '@/SeamsWeb/signingSurface/types';
import type { WebAuthnAuthenticationCredential } from '@/core/types';
import { type ManagedRuntimeScopeBootstrap } from '@/core/config/managedRuntimeScope';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import { type MpcMaterialActivationRef } from '@shared/utils/domainIds';
import {
  parseWalletSessionId,
  type MpcWalletSigningQuotaId,
  type WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import {
  buildPasskeyWalletAuthAuthority,
  type PasskeyWalletAuthAuthority,
} from '@shared/utils/walletAuthAuthority';
import { IndexedDBManager } from '@/core/indexedDB';
import { exactPasskeyWalletAuthAuthorityRefForCredential } from '@/SeamsWeb/operations/authMethods/passkey/exactPasskeyAuthority';
import { getNearAccountProjection } from '@/core/accountData/near/accountProjection';
import type { ClientUserData } from '@/core/accountData/near/nearAccountData.types';
import {
  type PasskeySessionCustodyUnlockV1,
  type PasskeyWalletUnlockEd25519Session,
} from '@/core/rpcClients/near/rpcCalls';
import type {
  LocalWalletAuthMethodRecordV2,
  ProfileAuthenticatorRecord,
} from '@/core/indexedDB/passkeyClientDB.types';
import { type ExactWalletSessionAuthorization } from '@/core/signingEngine/session/persistence/walletSessionAuthorizationProjection';
import { parseSignerSlot } from '@/core/signingEngine/webauthnAuth/device/signerSlot';
import type { ThresholdEcdsaEmailOtpAuthContext } from '@/core/signingEngine/session/identity/laneIdentity';
import {
  type EmailOtpEd25519SessionPolicyAuthority,
  type PasskeyEd25519SessionPolicyAuthority,
  type ThresholdRuntimePolicyScope,
} from '@/core/signingEngine/threshold/sessionPolicy';
import { createRouterAbNormalSigningPolicy } from '@/SeamsWeb/operations/session/thresholdWarmSessionBootstrap';
import { listConfiguredThresholdEcdsaPublicationTargets } from '@/SeamsWeb/operations/session/thresholdEcdsaProvisioning';
import { assertWalletRuntimePostconditions } from '@/core/signingEngine/session/postconditions/runtimePostconditions';
import type { OwnerLaneScope } from '@/core/signingEngine/session/identity/signingLaneAuthBinding';
import { type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { toRpId } from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import {
  exactEd25519SigningLaneIdentity,
  nearEd25519SignerBindingFromBoundaryFields,
  type ExactEd25519SigningLaneIdentity,
} from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';
import type { SigningLaneAuthBinding } from '@/core/signingEngine/session/identity/signingLaneAuthBinding';
import { type WalletUnlockSelection } from '@/core/signingEngine/session/passkey/unlockEcdsaWarmupPlanner';
import { SIGNER_AUTH_METHODS } from '@shared/utils/signerDomain';
import { type WalletAuthMethodBinding } from '@shared/utils/walletCapabilityBindings';
import {
  passkeyCredentialIdB64uFromAuthentication,
  passkeyPrfFirstB64uFromCredential,
} from '@/SeamsWeb/operations/authMethods/passkey/ecdsaBootstrap';
import type { ProvisionWarmEd25519CapabilitySuccessResult } from '@/core/signingEngine/session/warmCapabilities/types';
import { type WalletUnlockSubjectSet } from '../walletUnlockSubject';
import type {
  ResolvedLoginWalletBinding,
  ResolvedLoginWalletIdentity,
  ResolvedLoginEcdsaOnlyWallet,
} from './identity';
import type { ThresholdEcdsaAuthorizedEd25519Mint, ThresholdLoginWarmupPlan } from './signerWarmup';
import { assertNeverLoginState, resolveLoginWalletIdentity } from './identity';
import {
  sameEd25519ParticipantIds,
  sameThresholdRuntimePolicyScope,
  sameRouterAbEd25519NormalSigningState,
} from './signerState';
import type { ConfiguredThresholdEcdsaPublicationTarget } from './passkeyExchange';

type LoginUnlockAccountSubject =
  | {
      kind: 'near_wallet';
      walletId: WalletId;
      operationalPublicKey: string | null;
      userData?: never;
    }
  | {
      kind: 'ecdsa_wallet_only';
      walletId: WalletId;
      userData?: never;
      operationalPublicKey: null;
    };

export type LoginPasskeyAuthenticator = Pick<
  ProfileAuthenticatorRecord,
  'credentialId' | 'transports' | 'signerSlot'
>;

type LoginUnlockAccountPhase = {
  kind: 'login_unlock_account_phase_ready';
  accountSubject: LoginUnlockAccountSubject;
  authenticators: LoginPasskeyAuthenticator[];
  baseSignerSlot: number;
  localUnlockAuthMethod: WalletAuthMethod;
  requiresLocalPasskeyUnlock: boolean;
};

async function readActiveWalletPasskeyAuthenticators(
  walletId: WalletId,
): Promise<LoginPasskeyAuthenticator[]> {
  const [authenticators, authMethods] = await Promise.all([
    IndexedDBManager.listWalletPasskeyAuthenticators(String(walletId)),
    IndexedDBManager.listWalletAuthMethodsV2ForWallet(String(walletId)).catch(
      () => [] as LocalWalletAuthMethodRecordV2[],
    ),
  ]);
  const activeCredentialIds = new Set<string>();
  for (const method of authMethods) {
    if (method.kind === 'passkey' && method.status === 'active') {
      activeCredentialIds.add(method.credentialIdB64u);
    }
  }
  return authenticators.filter((authenticator) =>
    activeCredentialIds.has(authenticator.credentialId),
  );
}

export type LoginEcdsaKeyFactsInventoryAuthority =
  | {
      kind: 'wallet_session_operation_credential_v1';
      operationCredential: EcdsaKeyFactsInventoryWalletSessionCredential;
    }
  | {
      kind: 'webauthn';
    };

type LoginNoServerSessionPasskeyCredentialPlan =
  | {
      kind: 'wallet_unlock_owns_passkey_credential';
    }
  | {
      kind: 'local_unlock_passkey_assertion';
    }
  | {
      kind: 'passkey_credential_already_collected';
    }
  | {
      kind: 'no_local_passkey_required';
    };

type LoginWarmupPasskeyCredentialPlan =
  | {
      kind: 'existing_passkey_credential';
    }
  | {
      kind: 'no_passkey_credential_required';
    }
  | {
      kind: 'wallet_custody';
    };

export type LoginWarmupRouteAuthorization = {
  kind: 'none';
};

export type LoginWarmupCredentialState =
  | {
      kind: 'available';
      credential: WebAuthnAuthenticationCredential;
      localPasskeyCredentialIdB64u: string;
    }
  | {
      kind: 'credential_id_only';
      credential?: never;
      localPasskeyCredentialIdB64u: string;
    }
  | {
      kind: 'unavailable';
      credential?: never;
      localPasskeyCredentialIdB64u: '';
    };

export type LoginWarmupRuntimeScopeBootstrapState =
  | {
      kind: 'available';
      runtimeScopeBootstrap: ManagedRuntimeScopeBootstrap;
    }
  | {
      kind: 'unavailable';
      runtimeScopeBootstrap?: never;
    };

export type ActivePasskeySessionCustodyUnlockV1 = Omit<PasskeySessionCustodyUnlockV1, 'ed25519'> & {
  readonly ed25519: Extract<PasskeySessionCustodyUnlockV1['ed25519'], { kind: 'active' }>;
};

export type LoginWarmupEd25519MintPlan =
  | {
      kind: 'not_requested';
      thresholdSessionId?: never;
      authorization?: never;
    }
  | {
      kind: 'fresh';
      thresholdSessionId?: never;
      authorization?: never;
    }
  | {
      kind: 'ecdsa_authorized';
      thresholdSessionId: string;
      authorization?: never;
    }
  | {
      kind: 'wallet_custody';
      custody: ActivePasskeySessionCustodyUnlockV1;
      thresholdSessionId: string;
      authorization?: never;
    };

export type LoginWarmupEd25519SessionAuthority =
  | {
      kind: 'not_requested';
      authority?: never;
      source?: never;
      emailOtpAuthContext?: never;
    }
  | {
      kind: 'passkey';
      authority: PasskeyEd25519SessionPolicyAuthority;
      source: 'login';
      emailOtpAuthContext?: never;
    }
  | {
      kind: 'email_otp';
      authority: EmailOtpEd25519SessionPolicyAuthority;
      source: 'email_otp';
      emailOtpAuthContext: ThresholdEcdsaEmailOtpAuthContext;
    };

export function isActiveThresholdLoginSigningSession(
  sessionStatus: SigningSessionStatus | null | undefined,
): sessionStatus is ThresholdWarmLoginAndCreateSessionResult['signingSession'] {
  return sessionStatus?.status === 'active';
}

export function resolveLoginEcdsaKeyFactsInventoryAuthority(args: {
  request: LoginHooksOptions['ecdsaKeyFactsInventory'] | null;
  routeAuthorization: LoginWarmupRouteAuthorization;
}): LoginEcdsaKeyFactsInventoryAuthority | null {
  if (!args.request) return null;
  switch (args.request.mode) {
    case 'wallet_session_operation_credential_v1': {
      try {
        return {
          kind: 'wallet_session_operation_credential_v1',
          operationCredential: parseLoginEcdsaInventoryOperationCredential(
            args.request.operationCredential,
          ),
        };
      } catch {
        return null;
      }
    }
    case 'webauthn':
      return { kind: 'webauthn' };
  }
  return null;
}

function parseLoginEcdsaInventoryOperationCredential(
  value: EcdsaKeyFactsInventoryWalletSessionCredential,
): EcdsaKeyFactsInventoryWalletSessionCredential {
  if (value.kind === 'opaque_wallet_session_operation_credential_v1') {
    return parseWalletSessionOperationCredentialV1(value);
  }
  if (
    value.kind !== 'opaque_hosted_wallet_session_operation_credential_v1' ||
    !/^wsh_[A-Za-z0-9_-]{43}$/.test(value.token)
  ) {
    throw new Error('Hosted Wallet Session operation credential is invalid');
  }
  const walletSessionId = parseWalletSessionId(value.walletSessionId);
  if (!walletSessionId.ok) {
    throw new Error(`Hosted Wallet Session ID is invalid: ${walletSessionId.error.message}`);
  }
  return {
    kind: value.kind,
    home: parseWalletSessionHome(value.home),
    token: value.token,
    walletSessionId: walletSessionId.value,
  };
}

export function resolveLoginWarmupRouteAuthorization(): LoginWarmupRouteAuthorization {
  return { kind: 'none' };
}

function loginPasskeyCredentialIdB64u(args: {
  authenticators: readonly LoginPasskeyAuthenticator[];
  signerSlot: number;
}): string {
  return String(
    args.authenticators.find((authenticator) => authenticator.signerSlot === args.signerSlot)
      ?.credentialId ||
      args.authenticators[0]?.credentialId ||
      '',
  ).trim();
}

function buildLoginPasskeyWalletAuthAuthority(args: {
  walletId: WalletId;
  rpId: string;
  credentialIdB64u: string;
}): PasskeyWalletAuthAuthority {
  return buildPasskeyWalletAuthAuthority({
    walletId: args.walletId,
    rpId: args.rpId,
    credentialIdB64u: args.credentialIdB64u,
  });
}

function resolveLoginEd25519SessionAuthority(args: {
  wantsEd25519Warmup: boolean;
  authMethod: WalletAuthMethod;
  walletId: WalletId;
  rpId: string;
  passkeyCredentialIdB64u: string;
  routeAuthorization: LoginWarmupRouteAuthorization;
}): LoginWarmupEd25519SessionAuthority {
  if (!args.wantsEd25519Warmup) return { kind: 'not_requested' };
  if (args.authMethod === SIGNER_AUTH_METHODS.passkey) {
    const authority = buildLoginPasskeyWalletAuthAuthority({
      walletId: args.walletId,
      rpId: args.rpId,
      credentialIdB64u: args.passkeyCredentialIdB64u,
    });
    return {
      kind: 'passkey',
      authority: { kind: 'wallet_auth_authority', authority },
      source: 'login',
    };
  }
  if (args.authMethod === SIGNER_AUTH_METHODS.emailOtp) {
    throw new Error('[login] Email OTP warm-up requires its proof-bound unlock flow');
  }
  throw new Error(`[login] unsupported wallet auth method for Ed25519 warm-up: ${args.authMethod}`);
}

export function requireRequestedLoginEd25519SessionAuthority(
  authority: LoginWarmupEd25519SessionAuthority,
): Exclude<LoginWarmupEd25519SessionAuthority, { kind: 'not_requested' }> {
  if (authority.kind === 'not_requested') {
    throw new Error('[login] threshold Ed25519 warm-up authority is missing');
  }
  return authority;
}

export function bindLoginEd25519SessionAuthorityToAuthenticatedCredential(args: {
  authority: Exclude<LoginWarmupEd25519SessionAuthority, { kind: 'not_requested' }>;
  walletId: WalletId;
  rpId: string;
  credentialIdB64u: string;
}): Exclude<LoginWarmupEd25519SessionAuthority, { kind: 'not_requested' }> {
  if (args.authority.kind === 'email_otp') return args.authority;
  const authority = buildLoginPasskeyWalletAuthAuthority({
    walletId: args.walletId,
    rpId: args.rpId,
    credentialIdB64u: args.credentialIdB64u,
  });
  return {
    kind: 'passkey',
    authority: { kind: 'wallet_auth_authority', authority },
    source: 'login',
  };
}

function loginEd25519ExactProvisionAuthBinding(
  authority: Exclude<LoginWarmupEd25519SessionAuthority, { kind: 'not_requested' }>,
): SigningLaneAuthBinding {
  switch (authority.kind) {
    case 'passkey':
      return {
        kind: 'passkey',
        rpId: toRpId(authority.authority.authority.verifier.rpId),
        credentialIdB64u: String(
          authority.authority.authority.factor.credentialIdB64u || '',
        ).trim(),
      };
    case 'email_otp':
      return {
        kind: 'email_otp',
        providerSubjectId: String(authority.authority.authority.factor.providerUserId || '').trim(),
      };
  }
  authority satisfies never;
  throw new Error('[login] unsupported Ed25519 exact provision authority');
}

function loginEd25519ExactProvisionLaneIdentity(args: {
  walletBinding: ResolvedLoginWalletBinding;
  signerSlot: number;
  thresholdSessionId: string;
  walletSessionId: WalletSessionId;
  quotaId: MpcWalletSigningQuotaId;
  authority: Exclude<LoginWarmupEd25519SessionAuthority, { kind: 'not_requested' }>;
}): ExactEd25519SigningLaneIdentity {
  return exactEd25519SigningLaneIdentity({
    signer: nearEd25519SignerBindingFromBoundaryFields({
      walletId: args.walletBinding.walletId,
      nearAccountId: args.walletBinding.nearAccountId,
      nearEd25519SigningKeyId: args.walletBinding.nearEd25519SigningKeyId,
      signerSlot: args.signerSlot,
    }),
    auth: loginEd25519ExactProvisionAuthBinding(args.authority),
    walletSessionId: args.walletSessionId,
    quotaId: args.quotaId,
    thresholdSessionId: args.thresholdSessionId,
  });
}

export function resolveLoginWarmEd25519ProvisioningIdentity(args: {
  mintPlan: LoginWarmupEd25519MintPlan;
  ecdsaMint: ThresholdEcdsaAuthorizedEd25519Mint | null;
  walletBinding: ResolvedLoginWalletBinding;
  signerSlot: number;
  authority: Exclude<LoginWarmupEd25519SessionAuthority, { kind: 'not_requested' }>;
}): ReadonlyExclusiveUnion<
  | {
      readonly kind: 'exact_ed25519_provisioning';
      readonly operationCredential: WalletSessionOperationCredentialV1;
      readonly laneIdentity: ExactEd25519SigningLaneIdentity;
    }
  | {
      readonly kind: 'fresh_ed25519_provisioning';
      readonly materialActivation: MpcMaterialActivationRef;
    }
> {
  switch (args.mintPlan.kind) {
    case 'not_requested':
      throw new Error('[login] threshold Ed25519 mint plan is missing');
    case 'wallet_custody':
      if (args.ecdsaMint) {
        return {
          kind: 'exact_ed25519_provisioning' as const,
          operationCredential: args.ecdsaMint.operationCredential,
          laneIdentity: loginEd25519ExactProvisionLaneIdentity({
            walletBinding: args.walletBinding,
            signerSlot: args.signerSlot,
            thresholdSessionId: args.mintPlan.thresholdSessionId,
            walletSessionId: args.ecdsaMint.operationCredential.walletSessionId,
            quotaId: args.ecdsaMint.quotaId,
            authority: args.authority,
          }),
        };
      }
      return {
        kind: 'fresh_ed25519_provisioning' as const,
        materialActivation: args.mintPlan.custody.ed25519.capability.materialActivation,
      };
    case 'fresh':
      throw new Error(
        '[login] fresh Ed25519 passkey provisioning requires canonical material activation',
      );
    case 'ecdsa_authorized':
      if (!args.ecdsaMint) {
        throw new Error(
          '[login] threshold Ed25519 warm-up requires the ECDSA bootstrap session minted during unlock',
        );
      }
      return {
        kind: 'exact_ed25519_provisioning' as const,
        operationCredential: args.ecdsaMint.operationCredential,
        laneIdentity: loginEd25519ExactProvisionLaneIdentity({
          walletBinding: args.walletBinding,
          signerSlot: args.signerSlot,
          thresholdSessionId: args.mintPlan.thresholdSessionId,
          walletSessionId: args.ecdsaMint.operationCredential.walletSessionId,
          quotaId: args.ecdsaMint.quotaId,
          authority: args.authority,
        }),
      };
  }
  return assertNeverLoginState(args.mintPlan);
}

export function resolveLoginPasskeyMaterialActivation(
  identity: ReturnType<typeof resolveLoginWarmEd25519ProvisioningIdentity>,
  mintPlan: LoginWarmupEd25519MintPlan,
): MpcMaterialActivationRef {
  if (identity.kind === 'fresh_ed25519_provisioning' && identity.materialActivation) {
    return identity.materialActivation;
  }
  if (mintPlan.kind === 'wallet_custody') {
    return mintPlan.custody.ed25519.capability.materialActivation;
  }
  throw new Error('[login] passkey Ed25519 warm-up requires a canonical material activation');
}

type LoginEd25519ProvisionScope = {
  relayerKeyId: string;
  participantIds: readonly number[];
  runtimePolicyScope: ThresholdRuntimePolicyScope | null;
  routerAbNormalSigning: ReturnType<typeof createRouterAbNormalSigningPolicy>;
};

export function resolveLoginEd25519ProvisionScope(args: {
  mintPlan: LoginWarmupEd25519MintPlan;
  fallback: LoginEd25519ProvisionScope;
}): LoginEd25519ProvisionScope {
  if (args.mintPlan.kind !== 'wallet_custody') return args.fallback;
  return {
    relayerKeyId: args.mintPlan.custody.ed25519.relayerKeyId,
    participantIds: args.mintPlan.custody.ed25519.participantIds,
    runtimePolicyScope: args.mintPlan.custody.ed25519.capability.runtimePolicyScope,
    routerAbNormalSigning: args.fallback.routerAbNormalSigning,
  };
}

export type PasskeyUnlockEd25519Connection = Omit<
  PasskeyWalletUnlockEd25519Session,
  'sessionKind' | 'operationCredential'
> & {
  readonly ok: true;
  readonly sessionKind: PasskeyWalletUnlockEd25519Session['sessionKind'];
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly passkeyPrfFirstB64u: string;
  readonly code?: never;
  readonly message?: never;
};

export type LoginWarmEd25519Session =
  | ProvisionWarmEd25519CapabilitySuccessResult
  | PasskeyUnlockEd25519Connection;

export function passkeyUnlockEd25519Connection(args: {
  readonly session: PasskeyWalletUnlockEd25519Session;
  readonly walletBinding: ResolvedLoginWalletBinding;
  readonly signerSlot: number;
  readonly custody: ActivePasskeySessionCustodyUnlockV1;
  readonly provisionScope: LoginEd25519ProvisionScope;
  readonly credential: WebAuthnAuthenticationCredential | undefined;
  readonly remainingUses: number;
  readonly unlockAuthorization: ExactWalletSessionAuthorization | null;
}): PasskeyUnlockEd25519Connection {
  const session = args.session;
  const custody = args.custody.ed25519;
  const passkeyPrfFirstB64u = args.credential
    ? passkeyPrfFirstB64uFromCredential(args.credential)
    : '';
  if (
    session.walletId !== String(args.walletBinding.walletId) ||
    session.nearAccountId !== String(args.walletBinding.nearAccountId) ||
    session.nearEd25519SigningKeyId !== String(args.walletBinding.nearEd25519SigningKeyId) ||
    custody.signerSlot !== args.signerSlot ||
    session.relayerKeyId !== args.provisionScope.relayerKeyId ||
    session.thresholdSessionId !== custody.capability.lifecycle.thresholdSessionId ||
    session.remainingUses !== args.remainingUses ||
    !sameEd25519ParticipantIds(session.participantIds, args.provisionScope.participantIds) ||
    !args.provisionScope.runtimePolicyScope ||
    !sameThresholdRuntimePolicyScope(
      session.runtimePolicyScope,
      args.provisionScope.runtimePolicyScope,
    ) ||
    !sameRouterAbEd25519NormalSigningState(
      session.routerAbNormalSigning,
      args.provisionScope.routerAbNormalSigning,
    ) ||
    !passkeyPrfFirstB64u
  ) {
    throw new Error('[login] verified unlock returned an invalid Ed25519 Wallet Session');
  }
  switch (session.sessionKind) {
    case 'issued_exact_wallet_session':
      if (session.operationCredential.walletSessionId !== session.walletSessionId) {
        throw new Error('[login] verified unlock returned a mismatched Ed25519 credential');
      }
      return { ok: true, ...session, passkeyPrfFirstB64u };
    case 'already_committed_exact_wallet_session': {
      /* The pre-issued exact session was committed before verification, so its
         credential arrives as the response's top-level Wallet Session
         authorization rather than on the Ed25519 session record. */
      const authorization = args.unlockAuthorization;
      if (!authorization) {
        throw new Error(
          '[login] verified unlock reused an Ed25519 Wallet Session without its authorization',
        );
      }
      if (
        authorization.operationCredential.walletSessionId !== session.walletSessionId ||
        authorization.record.walletId !== session.walletId ||
        authorization.record.authorizationId !== session.authorizationId ||
        authorization.record.quotaId !== session.quotaId ||
        authorization.record.expiresAtMs !== session.expiresAtMs
      ) {
        throw new Error('[login] verified unlock reused a mismatched Ed25519 Wallet Session');
      }
      return {
        ok: true,
        ...session,
        operationCredential: authorization.operationCredential,
        passkeyPrfFirstB64u,
      };
    }
    default:
      return assertNeverLoginState(session);
  }
}

export function resolveLoginNoServerSessionPasskeyCredentialPlan(args: {
  requiresLocalPasskeyUnlock: boolean;
  requireThresholdWarmup: boolean;
  hasLoginCredential: boolean;
}): LoginNoServerSessionPasskeyCredentialPlan {
  if (args.hasLoginCredential) return { kind: 'passkey_credential_already_collected' };
  if (!args.requiresLocalPasskeyUnlock) return { kind: 'no_local_passkey_required' };
  if (args.requireThresholdWarmup) return { kind: 'wallet_unlock_owns_passkey_credential' };
  return { kind: 'local_unlock_passkey_assertion' };
}

export function resolveLoginWarmupPasskeyCredentialPlan(args: {
  requiresLocalPasskeyUnlock: boolean;
  hasLoginCredential: boolean;
  routeAuthorization: LoginWarmupRouteAuthorization;
  warmupPlan: ThresholdLoginWarmupPlan;
}): LoginWarmupPasskeyCredentialPlan {
  if (args.warmupPlan.signersToWarm.includes('ed25519') && args.requiresLocalPasskeyUnlock) {
    return { kind: 'wallet_custody' };
  }
  if (args.hasLoginCredential) return { kind: 'existing_passkey_credential' };
  args.routeAuthorization.kind satisfies 'none';
  if (args.requiresLocalPasskeyUnlock) {
    throw new Error('[login] passkey warm-up requires the verified wallet-unlock credential');
  }
  return { kind: 'no_passkey_credential_required' };
}

export function authenticatorsForCredentialIds(args: {
  authenticators: readonly LoginPasskeyAuthenticator[];
  credentialIds: readonly string[] | null;
}): readonly LoginPasskeyAuthenticator[] {
  if (!args.credentialIds) return args.authenticators;
  const allowed = new Set<string>();
  for (const credentialId of args.credentialIds) allowed.add(credentialId.trim());
  const authenticators: LoginPasskeyAuthenticator[] = [];
  for (const authenticator of args.authenticators) {
    if (allowed.has(String(authenticator.credentialId || '').trim())) {
      authenticators.push(authenticator);
    }
  }
  if (!authenticators.length) {
    throw new Error('[login] no local authenticator matches the required credential');
  }
  return authenticators;
}

function uniqueLoginCredentialIds(authenticators: readonly LoginPasskeyAuthenticator[]): string[] {
  const credentialIds: string[] = [];
  const seen = new Set<string>();
  for (const authenticator of authenticators) {
    const credentialId = String(authenticator.credentialId || '').trim();
    if (!credentialId || seen.has(credentialId)) continue;
    seen.add(credentialId);
    credentialIds.push(credentialId);
  }
  return credentialIds;
}

export function parseLoginChallengeCredentialIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const credentialIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const credentialId = typeof entry === 'string' ? entry.trim() : '';
    if (!credentialId || seen.has(credentialId)) continue;
    seen.add(credentialId);
    credentialIds.push(credentialId);
  }
  return credentialIds;
}

export function resolveLoginPasskeyPromptCredentialIds(args: {
  authenticators: readonly LoginPasskeyAuthenticator[];
  signerSlot: number;
  serverCredentialIds: readonly string[];
}): readonly string[] {
  const signerAuthenticators: LoginPasskeyAuthenticator[] = [];
  for (const authenticator of args.authenticators) {
    if (authenticator.signerSlot === args.signerSlot) {
      signerAuthenticators.push(authenticator);
    }
  }
  const localCredentialIds = uniqueLoginCredentialIds(
    signerAuthenticators.length > 0 ? signerAuthenticators : args.authenticators,
  );
  if (localCredentialIds.length === 0) {
    throw new Error('[login] selected wallet has no local passkey credential ID');
  }
  if (args.serverCredentialIds.length === 0) return localCredentialIds;

  const serverCredentialIds = new Set(args.serverCredentialIds);
  const matchingCredentialIds: string[] = [];
  for (const credentialId of localCredentialIds) {
    if (serverCredentialIds.has(credentialId)) {
      matchingCredentialIds.push(credentialId);
    }
  }
  if (matchingCredentialIds.length === 0) {
    throw new Error('[login] server passkey allow-list does not match local wallet credentials');
  }
  return matchingCredentialIds;
}

type ResolveThresholdLoginWarmupPhaseInputArgs = {
  context: LoginWebContext;
  signerSlot: number;
  authenticators: readonly LoginPasskeyAuthenticator[];
  selection: WalletUnlockSelection;
  subjectSet: WalletUnlockSubjectSet;
  authMethod: WalletAuthMethod;
  authMethodBinding: WalletAuthMethodBinding | null;
  keyFactsInventoryAuthority: LoginEcdsaKeyFactsInventoryAuthority | null;
  routeAuthorization: LoginWarmupRouteAuthorization;
};

export type ThresholdLoginWarmupPhaseInput = {
  kind: 'threshold_login_warmup_phase_input';
  signerSlot: number;
  selection: WalletUnlockSelection;
  relayerUrl: string;
  rpId: string;
  configuredEcdsaTargets: ConfiguredThresholdEcdsaPublicationTarget[];
  selectedEcdsaTargets: ConfiguredThresholdEcdsaPublicationTarget[];
  wantsEd25519Warmup: boolean;
  wantsEcdsaWarmup: boolean;
  ed25519SessionAuthority: LoginWarmupEd25519SessionAuthority;
  keyFactsInventoryAuthority: LoginEcdsaKeyFactsInventoryAuthority | null;
  routeAuthorization: LoginWarmupRouteAuthorization;
};

type LoginUnlockWarmupBranchPlan =
  | {
      kind: 'near_ed25519_only';
      wantsEd25519Warmup: true;
      wantsEcdsaWarmup: false;
    }
  | {
      kind: 'evm_family_ecdsa_only';
      wantsEd25519Warmup: false;
      wantsEcdsaWarmup: boolean;
    }
  | {
      kind: 'near_ed25519_and_evm_family_ecdsa';
      wantsEd25519Warmup: true;
      wantsEcdsaWarmup: boolean;
    };

export function resolveLoginUnlockWarmupBranchPlan(args: {
  subjectSet: WalletUnlockSubjectSet;
  selection: WalletUnlockSelection;
  hasConfiguredEcdsaTargets: boolean;
}): LoginUnlockWarmupBranchPlan {
  const identity = resolveLoginWalletIdentity({
    subjectSet: args.subjectSet,
    selection: args.selection,
  });
  switch (args.selection.mode) {
    case 'ed25519_only':
      return {
        kind: 'near_ed25519_only',
        wantsEd25519Warmup: true,
        wantsEcdsaWarmup: false,
      };
    case 'ecdsa_only':
      if (identity.kind !== 'evm_family_ecdsa_only_wallet') {
        throw new Error('[login] ECDSA-only warm-up requires exact ECDSA subjects');
      }
      return {
        kind: 'evm_family_ecdsa_only',
        wantsEd25519Warmup: false,
        wantsEcdsaWarmup: args.hasConfiguredEcdsaTargets,
      };
    case 'ed25519_and_ecdsa':
      return {
        kind: 'near_ed25519_and_evm_family_ecdsa',
        wantsEd25519Warmup: true,
        wantsEcdsaWarmup: args.hasConfiguredEcdsaTargets,
      };
  }
  return assertNeverLoginState(args.selection);
}

export function resolveThresholdLoginWarmupPhaseInput(
  args: ResolveThresholdLoginWarmupPhaseInputArgs,
): ThresholdLoginWarmupPhaseInput {
  const relayerUrl = String(args.context.configs?.network.relayer?.url || '').trim();
  if (!relayerUrl) {
    throw new Error('[login] threshold warm session requires relayer.url to be configured');
  }
  const configuredEcdsaTargets = listConfiguredThresholdEcdsaPublicationTargets(
    args.context.configs.network.chains,
  );
  const branchPlan = resolveLoginUnlockWarmupBranchPlan({
    subjectSet: args.subjectSet,
    selection: args.selection,
    hasConfiguredEcdsaTargets: configuredEcdsaTargets.length > 0,
  });
  const wantsEcdsaWarmup = branchPlan.wantsEcdsaWarmup;
  const wantsEd25519Warmup = branchPlan.wantsEd25519Warmup;
  const rpId = String(args.context.signingEngine.getRpId() || '').trim();
  return {
    kind: 'threshold_login_warmup_phase_input',
    signerSlot: args.signerSlot,
    selection: args.selection,
    relayerUrl,
    rpId,
    configuredEcdsaTargets,
    selectedEcdsaTargets: wantsEcdsaWarmup ? configuredEcdsaTargets : [],
    wantsEd25519Warmup,
    wantsEcdsaWarmup,
    ed25519SessionAuthority: resolveLoginEd25519SessionAuthority({
      wantsEd25519Warmup,
      authMethod: args.authMethod,
      walletId: args.subjectSet.walletId,
      rpId,
      passkeyCredentialIdB64u: loginPasskeyCredentialIdB64u({
        authenticators: args.authenticators,
        signerSlot: args.signerSlot,
      }),
      routeAuthorization: args.routeAuthorization,
    }),
    keyFactsInventoryAuthority: args.keyFactsInventoryAuthority,
    routeAuthorization: args.routeAuthorization,
  };
}

export async function assertPasskeyUnlockRuntimePostconditions(args: {
  context: LoginWebContext;
  statusReads: WalletSessionStatusReadScope;
  walletIdentity: ResolvedLoginWalletIdentity;
  signersWarmed: readonly ('ed25519' | 'ecdsa')[];
  credential: WebAuthnAuthenticationCredential;
}): Promise<void> {
  const requiredTargets = [
    ...(args.signersWarmed.includes('ed25519') ? [{ curve: 'ed25519' as const }] : []),
    ...(args.signersWarmed.includes('ecdsa')
      ? listConfiguredThresholdEcdsaPublicationTargets(args.context.configs.network.chains).map(
          (target) => ({ curve: 'ecdsa' as const, chainTarget: target.chainTarget }),
        )
      : []),
  ];
  const credentialIdB64u = passkeyCredentialIdB64uFromAuthentication(args.credential);
  if (!credentialIdB64u) {
    throw new Error('[login] runtime lane selection requires the authenticated credential');
  }
  // During login the verified credential is the owner-scope source, and
  // the signer slot comes from the one local authenticator that credential
  // resolves — never from the caller's slot hint, which is UI prioritization.
  const walletId = String(args.walletIdentity.walletId);
  const authenticator = await IndexedDBManager.getWalletPasskeyAuthenticator({
    walletId,
    credentialId: credentialIdB64u,
  });
  const derivedSignerSlot = parseSignerSlot(authenticator?.signerSlot, { min: 1 });
  if (!authenticator || derivedSignerSlot === null) {
    throw new Error(
      '[login] authenticated credential resolves no exact local authenticator for its signer slot',
    );
  }
  const ownerScope: OwnerLaneScope = {
    auth: {
      kind: 'passkey',
      rpId: toRpId(args.context.signingEngine.getRpId()),
      credentialIdB64u,
    },
    signerSlot: derivedSignerSlot,
  };
  if (requiredTargets.length === 0) return;
  await assertWalletRuntimePostconditions({
    source: 'wallet_unlock',
    walletId: String(args.walletIdentity.walletId),
    ownerScope,
    requiredTargets,
    readOwnerScopedSigningLanes: async (input) =>
      await args.context.signingEngine.readOwnerScopedSigningLanes(input, args.statusReads),
  });
}

export async function markPasskeyLoginSelectionUnlocked(args: {
  context: LoginWebContext;
  walletIdentity: ResolvedLoginWalletIdentity;
  credential: WebAuthnAuthenticationCredential;
}): Promise<void> {
  const credentialIdB64u = passkeyCredentialIdB64uFromAuthentication(args.credential);
  if (!credentialIdB64u) {
    throw new Error('[login] successful Passkey unlock omitted its credential identity');
  }
  const authority = await exactPasskeyWalletAuthAuthorityRefForCredential({
    walletId: args.walletIdentity.walletId,
    rpId: args.context.signingEngine.getRpId(),
    credentialIdB64u,
  });
  await args.context.signingEngine.markWalletSelectionUnlocked({
    walletId: args.walletIdentity.walletId,
    walletAuthMethodId: authority.walletAuthMethodId,
  });
}

function buildNearLoginUnlockAccountSubject(args: {
  userData: ClientUserData | null;
  walletId: WalletId;
}): LoginUnlockAccountSubject {
  if (args.userData && String(args.userData.walletId) !== String(args.walletId)) {
    throw new Error('[login] NEAR account projection belongs to a different wallet');
  }
  const operationalPublicKey =
    typeof args.userData?.operationalPublicKey === 'string'
      ? args.userData.operationalPublicKey.trim()
      : '';
  return {
    kind: 'near_wallet',
    walletId: args.walletId,
    operationalPublicKey: operationalPublicKey || null,
  };
}

async function readNearLoginUnlockAccountPhase(args: {
  signingEngine: UserAccountLookupSurface;
  identity: ResolvedLoginWalletBinding;
  signerSlotHint: number | null;
  onEvent?: LoginHooksOptions['onEvent'];
}): Promise<LoginUnlockAccountPhase> {
  emitUnlockEvent(args.onEvent, String(args.identity.nearAccountId), {
    phase: UnlockEventPhase.STEP_02_ACCOUNT_LOOKUP_STARTED,
    status: 'running',
    authMethod: 'passkey',
  });

  const hintUserPromise: Promise<ClientUserData | null> =
    args.signerSlotHint !== null
      ? args.signingEngine
          .getUserBySignerSlot(args.identity.nearAccountId, args.signerSlotHint)
          .catch(() => null)
      : Promise.resolve(null);

  const [hintUser, lastUser, latestByAccount, authenticators] = await Promise.all([
    hintUserPromise,
    args.signingEngine.getLastUser().catch(() => null),
    getNearAccountProjection(IndexedDBManager, args.identity.nearAccountId).catch(() => null),
    readActiveWalletPasskeyAuthenticators(args.identity.walletId),
  ]);

  if (authenticators.length === 0) {
    throw new Error(
      `No authenticators found for account ${args.identity.nearAccountId}. Please register an account.`,
    );
  }

  let userData: ClientUserData | null = null;
  if (hintUser && hintUser.nearAccountId === args.identity.nearAccountId) {
    userData = hintUser;
  } else if (latestByAccount && latestByAccount.nearAccountId === args.identity.nearAccountId) {
    userData = latestByAccount;
  } else if (lastUser && lastUser.nearAccountId === args.identity.nearAccountId) {
    userData = lastUser;
  } else {
    userData = await args.signingEngine
      .getUserBySignerSlot(args.identity.nearAccountId, Number(args.identity.signerSlot))
      .catch(() => null);
  }
  const accountSubject = buildNearLoginUnlockAccountSubject({
    userData,
    walletId: args.identity.walletId,
  });

  emitUnlockEvent(args.onEvent, String(args.identity.nearAccountId), {
    phase: UnlockEventPhase.STEP_02_ACCOUNT_LOOKUP_SUCCEEDED,
    status: 'succeeded',
    authMethod: 'passkey',
    data: {
      signerSlot: Number(args.identity.signerSlot),
      ...(accountSubject.operationalPublicKey
        ? { operationalPublicKey: accountSubject.operationalPublicKey }
        : { walletKind: accountSubject.kind }),
    },
  });

  const baseSignerSlot = args.signerSlotHint ?? Number(args.identity.signerSlot);
  return {
    kind: 'login_unlock_account_phase_ready',
    accountSubject,
    authenticators,
    baseSignerSlot,
    localUnlockAuthMethod: SIGNER_AUTH_METHODS.passkey,
    requiresLocalPasskeyUnlock: true,
  };
}

async function readEcdsaLoginUnlockAccountPhase(args: {
  identity: ResolvedLoginEcdsaOnlyWallet;
  signerSlotHint: number | null;
  onEvent?: LoginHooksOptions['onEvent'];
}): Promise<LoginUnlockAccountPhase> {
  const unlockSubjectId = String(args.identity.walletId);
  emitUnlockEvent(args.onEvent, unlockSubjectId, {
    phase: UnlockEventPhase.STEP_02_ACCOUNT_LOOKUP_STARTED,
    status: 'running',
    authMethod: 'passkey',
  });
  const [profile, eligibleAuthenticators] = await Promise.all([
    IndexedDBManager.getProfile(unlockSubjectId),
    readActiveWalletPasskeyAuthenticators(args.identity.walletId),
  ]);
  if (!profile || eligibleAuthenticators.length === 0) {
    throw new Error(`[login] ECDSA wallet ${unlockSubjectId} has no local passkey profile`);
  }
  const persistedSignerSlot = parseSignerSlot(profile.defaultSignerSlot, { min: 1 });
  const baseSignerSlot = args.signerSlotHint ?? persistedSignerSlot;
  if (baseSignerSlot === null) {
    throw new Error('[login] ECDSA wallet profile is missing its exact signerSlot');
  }
  emitUnlockEvent(args.onEvent, unlockSubjectId, {
    phase: UnlockEventPhase.STEP_02_ACCOUNT_LOOKUP_SUCCEEDED,
    status: 'succeeded',
    authMethod: 'passkey',
    data: {
      signerSlot: baseSignerSlot,
      walletKind: 'ecdsa_wallet_only',
    },
  });
  return {
    kind: 'login_unlock_account_phase_ready',
    accountSubject: {
      kind: 'ecdsa_wallet_only',
      walletId: args.identity.walletId,
      operationalPublicKey: null,
    },
    authenticators: eligibleAuthenticators,
    baseSignerSlot,
    localUnlockAuthMethod: SIGNER_AUTH_METHODS.passkey,
    requiresLocalPasskeyUnlock: true,
  };
}

export async function readLoginUnlockAccountPhase(args: {
  signingEngine: UserAccountLookupSurface;
  identity: ResolvedLoginWalletIdentity;
  signerSlotHint: number | null;
  onEvent?: LoginHooksOptions['onEvent'];
}): Promise<LoginUnlockAccountPhase> {
  switch (args.identity.kind) {
    case 'near_ed25519_capable_wallet':
      return await readNearLoginUnlockAccountPhase({
        signingEngine: args.signingEngine,
        identity: args.identity,
        signerSlotHint: args.signerSlotHint,
        onEvent: args.onEvent,
      });
    case 'evm_family_ecdsa_only_wallet':
      return await readEcdsaLoginUnlockAccountPhase({
        identity: args.identity,
        signerSlotHint: args.signerSlotHint,
        onEvent: args.onEvent,
      });
  }
  return assertNeverLoginState(args.identity);
}

export function buildSuccessfulLoginResult(args: {
  identity: ResolvedLoginWalletIdentity;
  accountSubject: LoginUnlockAccountSubject;
}): Extract<LoginResult, { success: true }> {
  switch (args.identity.kind) {
    case 'near_ed25519_capable_wallet':
      if (args.accountSubject.kind !== 'near_wallet') {
        throw new Error('[login] NEAR unlock returned an ECDSA-only account subject');
      }
      return {
        success: true,
        kind: 'near_wallet_unlocked',
        walletId: args.identity.walletId,
        loggedInNearAccountId: String(args.identity.nearAccountId),
        operationalPublicKey: args.accountSubject.operationalPublicKey,
        nearAccountId: args.identity.nearAccountId,
      };
    case 'evm_family_ecdsa_only_wallet':
      if (args.accountSubject.kind !== 'ecdsa_wallet_only') {
        throw new Error('[login] ECDSA-only unlock returned a NEAR account subject');
      }
      return {
        success: true,
        kind: 'ecdsa_wallet_unlocked',
        walletId: args.identity.walletId,
      };
  }
  return assertNeverLoginState(args.identity);
}
