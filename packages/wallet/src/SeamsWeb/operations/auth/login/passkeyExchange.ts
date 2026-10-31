import { emitUnlockEvent } from '../unlockCompletion';
import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import type { LoginHooksOptions } from '@/core/types/sdkSentEvents';
import { UnlockEventPhase } from '@/core/types/sdkSentEvents';
import type { LoginWebContext } from '@/SeamsWeb/signingSurface/types';
import type { WebAuthnAuthenticationCredential } from '@/core/types';
import { joinNormalizedUrl } from '@shared/utils/normalize';
import { isObject } from '@shared/utils/validation';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import {
  exactPasskeyWalletAuthAuthorityRefForCredential,
  exactPasskeyWalletAuthMethodForCredential,
  resolveActivePasskeyWalletSessionAuthority,
  readActivePasskeyAuthorityForRecovery,
  type ValidatedPasskeyWalletSessionAuthority,
} from '@/SeamsWeb/operations/authMethods/passkey/exactPasskeyAuthority';
import { reconcileRecoveredEd25519Authority } from '@/core/indexedDB/seamsWalletDB/recoveredEd25519Authority';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import {
  verifyPasskeyWalletUnlock,
  type PasskeyWalletUnlockEcdsaSessionActivation,
  type PasskeySessionEcdsaCustodyContinuityV1,
  type PasskeySessionCustodyUnlockV1,
  type PasskeyWalletUnlockInput,
} from '@/core/rpcClients/near/rpcCalls';
import { rememberPasskeyCustodySessionEnvelope } from '@/core/signingEngine/session/passkey/passkeyCustodySessionCache';
import {
  type ExactWalletSessionAuthorization,
  type ExactWalletSessionAuthorityIdentity,
} from '@/core/signingEngine/session/persistence/walletSessionAuthorizationProjection';
import {
  isEcdsaCredentialFreeSessionActivationAuthorization,
  type EcdsaPreauthorizedSessionActivation,
} from '@/core/signingEngine/threshold/ecdsa/postRegistrationSessionActivation';
import {
  sameRouterAbEcdsaDerivationPublicCapabilityV1,
  sameRouterAbEcdsaDerivationPublicIdentityV1,
  sameRouterAbEcdsaRegistrationActivationReceiptV1,
  sameRouterAbServerIdentityV1,
  type RouterAbEcdsaPostRegistrationSessionActivationPolicyV1,
  type RouterAbEcdsaRegistrationActivationReceiptV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import { sameRouterAbMpcMaterialActivationRef } from '@shared/utils/routerAbNormalSigningIdentity';
import { listConfiguredThresholdEcdsaPublicationTargets } from '@/SeamsWeb/operations/session/thresholdEcdsaProvisioning';
import { thresholdEcdsaChainTargetKey } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { type WalletUnlockSelection } from '@/core/signingEngine/session/passkey/unlockEcdsaWarmupPlanner';
import {
  passkeyCredentialIdB64uFromAuthentication,
  passkeyPrfFirstB64uFromCredential,
} from '@/SeamsWeb/operations/authMethods/passkey/ecdsaBootstrap';
import type {
  LoginWarmupRouteAuthorization,
  LoginEcdsaKeyFactsInventoryAuthority,
  LoginPasskeyAuthenticator,
} from './unlockPlanning';
import {
  resolveLoginEcdsaKeyFactsInventoryAuthority,
  resolveLoginUnlockWarmupBranchPlan,
  resolveLoginPasskeyPromptCredentialIds,
  parseLoginChallengeCredentialIds,
} from './unlockPlanning';
import {
  sameThresholdRuntimePolicyScope,
  createThresholdEcdsaDeviceLinkRequiredError,
  requireThresholdLoginEcdsaSessionId,
  createThresholdLoginWarmSessionId,
  requireThresholdLoginWalletSessionMintId,
  exactAuthorizationFromPasskeyEcdsaActivation,
} from './signerState';
import type { ResolvedLoginWalletIdentity } from './identity';
import { resolveCanonicalThresholdEcdsaWarmSessionContext } from './ecdsaInventory';
import { assertNeverLoginState } from './identity';
import { restorePasskeyEcdsaCustodyLogin } from './custodyActivation';

export type ConfiguredThresholdEcdsaPublicationTarget = ReturnType<
  typeof listConfiguredThresholdEcdsaPublicationTargets
>[number];

type PreparedPasskeyExchangeEcdsaActivation = {
  readonly targetKey: string;
  readonly policy: RouterAbEcdsaPostRegistrationSessionActivationPolicyV1;
  readonly requiresCustodyRejoin: boolean;
};

export type CompletedPasskeyExchangeEcdsaActivation = PreparedPasskeyExchangeEcdsaActivation & {
  readonly response: PasskeyWalletUnlockEcdsaSessionActivation;
  readonly sessionActivation: EcdsaPreauthorizedSessionActivation;
  readonly authorizationIdentity: ExactWalletSessionAuthorityIdentity;
  readonly activationReceipt: RouterAbEcdsaRegistrationActivationReceiptV1;
  readonly continuity: PasskeySessionEcdsaCustodyContinuityV1;
};

export type LoginPreauthorizedEcdsaActivation = {
  readonly sessionActivation: EcdsaPreauthorizedSessionActivation;
  readonly authorizationIdentity: ExactWalletSessionAuthorityIdentity;
};

export function resolveUnlockEcdsaKeyFactsInventoryAuthority(args: {
  completedActivation: CompletedPasskeyExchangeEcdsaActivation | null;
  request: LoginHooksOptions['ecdsaKeyFactsInventory'] | null | undefined;
  routeAuthorization: LoginWarmupRouteAuthorization;
  wantsEcdsaWarmup: boolean;
}): LoginEcdsaKeyFactsInventoryAuthority | null {
  if (!args.wantsEcdsaWarmup) return null;
  if (args.completedActivation) {
    let operationCredential: WalletSessionOperationCredentialV1;
    try {
      const sessionActivation = args.completedActivation.sessionActivation;
      if (isEcdsaCredentialFreeSessionActivationAuthorization(sessionActivation)) {
        operationCredential = parseWalletSessionOperationCredentialV1(
          sessionActivation.authorization.operationCredential,
        );
      } else {
        const response = args.completedActivation.response;
        if (response.kind !== 'router_ab_ecdsa_post_registration_session_activated_v1') {
          throw new Error('completed ECDSA unlock activation branch is invalid');
        }
        operationCredential = parseWalletSessionOperationCredentialV1(
          response.session.operation_credential,
        );
      }
    } catch {
      throw new Error(
        '[login] completed ECDSA unlock omitted a valid Wallet Session operation credential',
      );
    }
    return {
      kind: 'wallet_session_operation_credential_v1',
      operationCredential,
    };
  }
  const authority = resolveLoginEcdsaKeyFactsInventoryAuthority({
    request: args.request ?? null,
    routeAuthorization: args.routeAuthorization,
  });
  if (authority?.kind === 'webauthn') {
    throw new Error(
      '[login] ECDSA warm-up requires the Wallet Session minted by the unlock assertion',
    );
  }
  return authority;
}

type CompletedPasskeyWalletUnlock = {
  readonly credential: WebAuthnAuthenticationCredential;
  readonly activation: CompletedPasskeyExchangeEcdsaActivation | null;
  readonly custody: PasskeySessionCustodyUnlockV1;
  readonly result: Extract<
    Awaited<ReturnType<typeof verifyPasskeyWalletUnlock>>,
    { readonly success: true }
  >;
};

function assertPasskeyEcdsaExchangeContinuity(args: {
  readonly walletId: string;
  readonly prepared: PreparedPasskeyExchangeEcdsaActivation;
  readonly response: PasskeyWalletUnlockEcdsaSessionActivation;
  readonly activationReceipt: RouterAbEcdsaRegistrationActivationReceiptV1;
  readonly continuity: PasskeySessionEcdsaCustodyContinuityV1;
}): void {
  const signer = args.continuity.signers.find(
    (candidate) => thresholdEcdsaChainTargetKey(candidate.chainTarget) === args.prepared.targetKey,
  );
  if (!signer) {
    throw new Error('Passkey ECDSA custody continuity omitted the requested chain target');
  }
  const capability = signer.walletKey.publicCapability;
  const receipt = signer.activationReceipt;
  const activation = receipt.ecdsa_activation;
  const normalScope = args.response.normal_signing.scope;
  if (
    signer.walletKey.walletId !== args.walletId ||
    signer.walletKey.keyHandle !== args.prepared.policy.key_handle ||
    args.response.session.threshold_session_id !==
      args.prepared.policy.session_policy.threshold_session_id ||
    !sameThresholdRuntimePolicyScope(
      signer.runtimePolicyScope,
      args.prepared.policy.session_policy.runtime_policy_scope,
    ) ||
    !sameRouterAbEcdsaDerivationPublicCapabilityV1(args.response.public_capability, capability) ||
    !sameRouterAbEcdsaRegistrationActivationReceiptV1(args.activationReceipt, receipt) ||
    capability.context.application_binding_digest_b64u !==
      activation.context.application_binding_digest_b64u ||
    !sameRouterAbEcdsaDerivationPublicIdentityV1(
      capability.public_identity,
      activation.public_identity,
    ) ||
    !sameRouterAbMpcMaterialActivationRef(
      capability.material_activation,
      activation.material_activation,
    ) ||
    !sameRouterAbServerIdentityV1(
      capability.signer_set.selected_server,
      activation.signing_worker,
    ) ||
    capability.activation_epoch !== activation.activation_epoch ||
    normalScope.context.application_binding_digest_b64u !==
      activation.context.application_binding_digest_b64u ||
    !sameRouterAbEcdsaDerivationPublicIdentityV1(
      normalScope.public_identity,
      activation.public_identity,
    ) ||
    !sameRouterAbMpcMaterialActivationRef(
      normalScope.material_activation,
      activation.material_activation,
    ) ||
    !sameRouterAbServerIdentityV1(normalScope.signing_worker, activation.signing_worker) ||
    normalScope.activation_epoch !== activation.activation_epoch ||
    normalScope.wallet_id !== args.walletId ||
    normalScope.ecdsa_threshold_key_id !== signer.walletKey.ecdsaThresholdKeyId ||
    normalScope.signing_root_id !== signer.walletKey.signingRootId ||
    normalScope.signing_root_version !== signer.walletKey.signingRootVersion
  ) {
    throw new Error('Passkey ECDSA session activation changed custody continuity');
  }
}

export async function rememberPasskeySessionCustodyForExport(args: {
  readonly walletId: string;
  readonly unlock: CompletedPasskeyWalletUnlock;
}): Promise<void> {
  const credentialIdB64u = String(
    args.unlock.credential.rawId || args.unlock.credential.id || '',
  ).trim();
  if (!credentialIdB64u) throw new Error('[login] passkey assertion credential id is missing');
  await rememberPasskeyCustodySessionEnvelope({
    walletId: args.walletId,
    credentialIdB64u,
    envelope: args.unlock.custody.envelope,
  });
}

export async function preparePasskeyExchangeEcdsaActivation(args: {
  context: LoginWebContext;
  walletIdentity: ResolvedLoginWalletIdentity;
  selection: WalletUnlockSelection;
  ttlMs: number;
  remainingUses: number;
}): Promise<PreparedPasskeyExchangeEcdsaActivation | null> {
  const configuredTargets = listConfiguredThresholdEcdsaPublicationTargets(
    args.context.configs.network.chains,
  );
  const branch = resolveLoginUnlockWarmupBranchPlan({
    subjectSet: args.walletIdentity.subjectSet,
    selection: args.selection,
    hasConfiguredEcdsaTargets: configuredTargets.length > 0,
  });
  if (!branch.wantsEcdsaWarmup) return null;
  const target = configuredTargets[0];
  if (!target) return null;
  const context = await resolveCanonicalThresholdEcdsaWarmSessionContext(
    args.context,
    args.walletIdentity.walletId,
    undefined,
    'passkey',
  );
  const targetKey = thresholdEcdsaChainTargetKey(target.chainTarget);
  const targetEcdsaKey = context.ecdsaKeys.find((candidate) => candidate.targetKey === targetKey);
  if (!targetEcdsaKey) {
    throw createThresholdEcdsaDeviceLinkRequiredError(targetKey);
  }
  const runtimePolicyScope = context.runtimePolicyScope;
  if (!runtimePolicyScope) {
    throw new Error('[login] passkey ECDSA activation requires runtime policy scope');
  }
  const thresholdSessionId = requireThresholdLoginEcdsaSessionId(
    createThresholdLoginWarmSessionId('threshold-ecdsa-login'),
  );
  const walletSessionMintId = requireThresholdLoginWalletSessionMintId(
    createThresholdLoginWarmSessionId('wallet-session-mint'),
  );
  return {
    targetKey,
    requiresCustodyRejoin: !targetEcdsaKey.existingRoleLocalMaterial,
    policy: {
      kind: 'router_ab_ecdsa_post_registration_session_activation_policy_v1',
      key_handle: targetEcdsaKey.keyHandle,
      session_policy: {
        threshold_session_id: thresholdSessionId,
        wallet_session_mint_id: walletSessionMintId,
        ttl_ms: args.ttlMs,
        remaining_uses: args.remainingUses,
        runtime_policy_scope: runtimePolicyScope,
      },
    },
  };
}

type CompletePasskeyWalletUnlockArgs = {
  context: LoginWebContext;
  walletIdentity: ResolvedLoginWalletIdentity;
  unlockSubjectId: string;
  onEvent?: LoginHooksOptions['onEvent'];
  authenticators: readonly LoginPasskeyAuthenticator[];
  signerSlot: number;
  remainingUses: number;
  relayUrl: string;
  rpId: string;
  activation: PreparedPasskeyExchangeEcdsaActivation | null;
  expectedOrigin?: string;
  collectCredentialForChallenge: (args: {
    challengeB64u: string;
    credentialIds: readonly string[];
  }) => Promise<WebAuthnAuthenticationCredential>;
};

function passkeyUnlockEd25519SessionRequest(args: {
  walletIdentity: ResolvedLoginWalletIdentity;
  remainingUses: number;
}): PasskeyWalletUnlockInput['ed25519SessionRequest'] {
  switch (args.walletIdentity.kind) {
    case 'near_ed25519_capable_wallet':
      return { kind: 'requested', remainingUses: args.remainingUses };
    case 'evm_family_ecdsa_only_wallet':
      return { kind: 'not_requested' };
    default:
      return assertNeverLoginState(args.walletIdentity);
  }
}

function passkeyWalletUnlockInput(args: {
  challengeId: string;
  credential: WebAuthnAuthenticationCredential;
  ed25519SessionRequest: PasskeyWalletUnlockInput['ed25519SessionRequest'];
  expectedOrigin: string;
  walletIdentity: ResolvedLoginWalletIdentity;
  activation: PreparedPasskeyExchangeEcdsaActivation | null;
}): PasskeyWalletUnlockInput {
  if (args.activation) {
    return {
      type: 'passkey_assertion' as const,
      challengeId: args.challengeId,
      walletId: String(args.walletIdentity.walletId),
      webauthn_authentication: args.credential,
      ed25519SessionRequest: args.ed25519SessionRequest,
      expected_origin: args.expectedOrigin,
      ecdsaSessionPolicy: args.activation.policy,
    };
  }

  return {
    type: 'passkey_assertion' as const,
    challengeId: args.challengeId,
    webauthn_authentication: args.credential,
    ed25519SessionRequest: args.ed25519SessionRequest,
    expected_origin: args.expectedOrigin,
  };
}

async function validatePasskeyWalletSessionAuthorization(args: {
  readonly walletIdentity: ResolvedLoginWalletIdentity;
  readonly rpId: string;
  readonly credential: WebAuthnAuthenticationCredential;
  readonly authorization: ExactWalletSessionAuthorization;
}): Promise<ValidatedPasskeyWalletSessionAuthority> {
  const credentialIdB64u = passkeyCredentialIdB64uFromAuthentication(args.credential);
  if (!credentialIdB64u) {
    throw new Error('Passkey Wallet Session adoption requires WebAuthn credential identity');
  }
  const authMethod = await exactPasskeyWalletAuthMethodForCredential({
    walletId: args.walletIdentity.walletId,
    rpId: args.rpId,
    credentialIdB64u,
  });
  const authority = await resolveActivePasskeyWalletSessionAuthority({
    walletId: args.walletIdentity.walletId,
    authorization: args.authorization,
  });
  if (
    args.authorization.record.walletId !== args.walletIdentity.walletId ||
    args.authorization.record.authMethodId !== authMethod.walletAuthMethodId ||
    args.authorization.record.authorityId !== authMethod.walletAuthorityId ||
    authority.reference.walletId !== args.walletIdentity.walletId
  ) {
    throw new Error('Passkey Wallet Session authorization changed auth-method identity');
  }
  return authority;
}

function bindPasskeyEcdsaSessionPolicyToUnlockChallenge(
  policy: RouterAbEcdsaPostRegistrationSessionActivationPolicyV1,
  challengeId: string,
): RouterAbEcdsaPostRegistrationSessionActivationPolicyV1 {
  return {
    ...policy,
    session_policy: {
      ...policy.session_policy,
      wallet_session_mint_id: requireThresholdLoginWalletSessionMintId(challengeId),
    },
  };
}

export async function completePasskeyWalletUnlock(
  args: CompletePasskeyWalletUnlockArgs,
  statusReads: WalletSessionStatusReadScope,
): Promise<CompletedPasskeyWalletUnlock> {
  emitUnlockEvent(args.onEvent, args.unlockSubjectId, {
    phase: UnlockEventPhase.STEP_03_PASSKEY_CHALLENGE_STARTED,
    status: 'running',
    authMethod: 'passkey',
  });
  const challengeResponse = await fetch(
    joinNormalizedUrl(args.relayUrl, '/wallet/unlock/challenge'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unlockBackend: 'passkey',
        userId: String(args.walletIdentity.walletId),
        rpId: args.rpId,
      }),
    },
  );
  const challengeBodyUnknown: unknown = await challengeResponse.json().catch(() => ({}));
  const challengeBody = isObject(challengeBodyUnknown) ? challengeBodyUnknown : {};
  const challengeMessage = typeof challengeBody.message === 'string' ? challengeBody.message : '';
  if (!challengeResponse.ok || challengeBody.ok !== true) {
    throw new Error(
      challengeMessage || `wallet/unlock/challenge failed (HTTP ${challengeResponse.status})`,
    );
  }
  const challengeId = String(challengeBody.challengeId || '').trim();
  const challengeB64u = String(challengeBody.challengeB64u || '').trim();
  if (!challengeId || !challengeB64u) {
    throw new Error('wallet/unlock/challenge returned invalid challenge');
  }
  const activation = args.activation
    ? {
        ...args.activation,
        policy: bindPasskeyEcdsaSessionPolicyToUnlockChallenge(args.activation.policy, challengeId),
      }
    : null;

  const credentialIds = resolveLoginPasskeyPromptCredentialIds({
    authenticators: args.authenticators,
    signerSlot: args.signerSlot,
    serverCredentialIds: parseLoginChallengeCredentialIds(challengeBody.credentialIds),
  });
  const credential = await args.collectCredentialForChallenge({
    challengeB64u,
    credentialIds,
  });
  const expectedOrigin = String(
    args.expectedOrigin ?? (typeof window !== 'undefined' ? window.location.origin : ''),
  ).trim();
  if (!expectedOrigin) {
    throw new Error('[login] passkey wallet unlock requires an expected origin');
  }
  const unlockInput = passkeyWalletUnlockInput({
    challengeId,
    credential,
    ed25519SessionRequest: passkeyUnlockEd25519SessionRequest({
      walletIdentity: args.walletIdentity,
      remainingUses: args.remainingUses,
    }),
    expectedOrigin,
    walletIdentity: args.walletIdentity,
    activation,
  });
  const selectedMethod = await exactPasskeyWalletAuthMethodForCredential({
    walletId: args.walletIdentity.walletId,
    rpId: args.rpId,
    credentialIdB64u: passkeyCredentialIdB64uFromAuthentication(credential),
  });
  const previousAuthority = await readActivePasskeyAuthorityForRecovery({
    walletId: args.walletIdentity.walletId,
    authMethodId: selectedMethod.walletAuthMethodId,
  });
  const result = await verifyPasskeyWalletUnlock(args.relayUrl, unlockInput, statusReads);
  if (!result.success) {
    throw new Error(result.error || 'Passkey wallet unlock failed');
  }
  if (!result.walletCustody) {
    throw new Error('Passkey wallet unlock omitted wallet custody continuity');
  }
  if (
    activation &&
    (!result.ecdsaSession || !result.ecdsaActivationReceipt || !result.ecdsaCustody)
  ) {
    throw new Error('Passkey wallet unlock omitted the requested ECDSA activation');
  }
  const walletSessionAuthorizationToPersist = result.walletSessionAuthorization ?? null;
  if (walletSessionAuthorizationToPersist) {
    await reconcileRecoveredEd25519Authority({
      session: walletSessionAuthorizationToPersist.record,
      previous: previousAuthority,
    });
  }
  const passkeySessionAuthority = walletSessionAuthorizationToPersist
    ? await validatePasskeyWalletSessionAuthorization({
        walletIdentity: args.walletIdentity,
        rpId: args.rpId,
        credential,
        authorization: walletSessionAuthorizationToPersist,
      })
    : null;
  let sessionActivation: EcdsaPreauthorizedSessionActivation | null = null;
  if (
    activation &&
    result.ecdsaSession &&
    result.ecdsaActivationReceipt &&
    result.ecdsaCustody &&
    result.ecdsaSession.kind === 'router_ab_ecdsa_credential_free_session_activated_v1'
  ) {
    const walletSessionAuthorization = result.walletSessionAuthorization;
    if (!walletSessionAuthorization) {
      throw new Error('Passkey credential-free activation omitted exact Wallet Session authority');
    }
    if (!passkeySessionAuthority) {
      throw new Error('Passkey credential-free activation omitted exact Passkey authority');
    }
    sessionActivation = {
      kind: 'credential_free_ecdsa_session_activation_authorization_v1',
      activation: result.ecdsaSession,
      authorization: walletSessionAuthorization,
    };
  }
  if (activation && result.ecdsaSession && result.ecdsaActivationReceipt && result.ecdsaCustody) {
    assertPasskeyEcdsaExchangeContinuity({
      walletId: String(args.walletIdentity.walletId),
      prepared: activation,
      response: result.ecdsaSession,
      activationReceipt: result.ecdsaActivationReceipt,
      continuity: result.ecdsaCustody,
    });
    if (result.ecdsaSession.kind === 'router_ab_ecdsa_post_registration_session_activated_v1') {
      sessionActivation = result.ecdsaSession;
    }
  }
  const ecdsaSessionAuthority = sessionActivation
    ? await validatePasskeyWalletSessionAuthorization({
        walletIdentity: args.walletIdentity,
        rpId: args.rpId,
        credential,
        authorization: exactAuthorizationFromPasskeyEcdsaActivation(sessionActivation),
      })
    : null;
  if (walletSessionAuthorizationToPersist) {
    await walletSessionAuthorizations.writeExactWithOperationCredential(
      walletSessionAuthorizationToPersist,
    );
  }
  if (activation?.requiresCustodyRejoin) {
    if (!('ecdsaCustody' in result) || !result.ecdsaCustody) {
      throw new Error('Passkey wallet unlock omitted ECDSA custody rejoin continuity');
    }
    const passkeyPrfFirstB64u = passkeyPrfFirstB64uFromCredential(credential);
    if (!passkeyPrfFirstB64u) {
      throw new Error('Passkey ECDSA custody rejoin requires WebAuthn PRF.first');
    }
    const credentialIdB64u = passkeyCredentialIdB64uFromAuthentication(credential);
    const authority =
      ecdsaSessionAuthority?.reference ??
      passkeySessionAuthority?.reference ??
      (await exactPasskeyWalletAuthAuthorityRefForCredential({
        walletId: args.walletIdentity.walletId,
        rpId: args.rpId,
        credentialIdB64u,
      }));
    await restorePasskeyEcdsaCustodyLogin({
      signingEngine: args.context.signingEngine,
      walletId: String(args.walletIdentity.walletId),
      custody: result.walletCustody,
      continuity: result.ecdsaCustody,
      authority,
      passkeyPrfFirstB64u,
    });
  }
  return {
    credential,
    activation:
      activation && result.ecdsaSession && sessionActivation && ecdsaSessionAuthority
        ? {
            ...activation,
            response: result.ecdsaSession,
            sessionActivation,
            authorizationIdentity: ecdsaSessionAuthority.identity,
            activationReceipt: result.ecdsaActivationReceipt,
            continuity: result.ecdsaCustody,
          }
        : null,
    custody: result.walletCustody,
    result,
  };
}
