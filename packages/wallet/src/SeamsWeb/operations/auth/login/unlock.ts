import { emitUnlockEvent, finalizeLoginSuccess, finalizeLoginError } from '../unlockCompletion';
import { resolveUnlockSessionPolicy } from '../unlockSessionPolicy';
import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import type { LoginHooksOptions } from '@/core/types/sdkSentEvents';
import { UnlockEventPhase } from '@/core/types/sdkSentEvents';
import type {
  LoginAndCreateSessionResult,
  SigningSessionStatus,
  ThresholdWarmLoginAndCreateSessionResult,
} from '@/core/types/seams';
import type { LoginWebContext } from '@/SeamsWeb/signingSurface/types';
import { toAccountId, type AccountId } from '@/core/types/accountIds';
import type { WebAuthnAuthenticationCredential } from '@/core/types';
import { resolveManagedRuntimeScopeBootstrap } from '@/core/config/managedRuntimeScope';
import { getUserFriendlyErrorMessage, isUserCancellationError } from '@shared/utils/errors';
import { IndexedDBManager } from '@/core/indexedDB';
import { getNearThresholdKeyMaterial } from '@/core/accountData/near/keyMaterial';
import {
  type PasskeySessionCustodyUnlockV1,
  type PasskeyWalletUnlockEd25519Session,
} from '@/core/rpcClients/near/rpcCalls';
import { type ExactWalletSessionAuthorization } from '@/core/signingEngine/session/persistence/walletSessionAuthorizationProjection';
import { parseSignerSlot } from '@/core/signingEngine/webauthnAuth/device/signerSlot';
import { listConfiguredThresholdEcdsaPublicationTargets } from '@/SeamsWeb/operations/session/thresholdEcdsaProvisioning';
import { SIGNER_AUTH_METHODS } from '@shared/utils/signerDomain';
import { collectPasskeyLoginAssertion } from '@/SeamsWeb/operations/authMethods/passkey/loginAssertion';
import { collectFreshLocalPasskeyUnlockCredential } from '@/SeamsWeb/operations/authMethods/passkey/localUnlock';
import {
  passkeyCredentialIdB64uFromAuthentication,
  passkeyPrfFirstB64uFromCredential,
} from '@/SeamsWeb/operations/authMethods/passkey/ecdsaBootstrap';
import { base64UrlDecode } from '@shared/utils/base64';
import { resolveWalletUnlockSubjectSet, type WalletUnlockSubjectSet } from '../walletUnlockSubject';
import {
  resolveLoginWalletUnlockSelection,
  resolveLoginWalletUnlockSelectionForSubjectSet,
  resolveLoginWalletIdentity,
  requireNearLoginWalletBinding,
  reconcileCanonicalEcdsaActivationSelectors,
  ecdsaActivationSelectorsFromSubjectSet,
  reportNonSettledEcdsaActivationReconciliation,
  assertEcdsaWarmupMatchesUnlockSubjects,
  assertNeverLoginState,
} from './identity';
import {
  readLoginUnlockAccountPhase,
  authenticatorsForCredentialIds,
  resolveLoginPasskeyPromptCredentialIds,
  resolveLoginWarmupRouteAuthorization,
  isActiveThresholdLoginSigningSession,
  resolveLoginWarmupPasskeyCredentialPlan,
  resolveLoginNoServerSessionPasskeyCredentialPlan,
  markPasskeyLoginSelectionUnlocked,
  resolveLoginUnlockWarmupBranchPlan,
  resolveThresholdLoginWarmupPhaseInput,
  assertPasskeyUnlockRuntimePostconditions,
  buildSuccessfulLoginResult,
} from './unlockPlanning';
import type { CompletedPasskeyExchangeEcdsaActivation } from './passkeyExchange';
import type { ThresholdLoginWarmupPhaseResult } from './signerWarmup';
import type {
  ThresholdLoginWarmupPhaseInput,
  LoginWarmupEd25519MintPlan,
  LoginWarmupCredentialState,
  LoginWarmupRuntimeScopeBootstrapState,
} from './unlockPlanning';
import { resolveCanonicalThresholdEcdsaWarmSessionContext } from './ecdsaInventory';
import {
  resolveThresholdLoginWarmupPlan,
  primeThresholdLoginWarmSigners,
  createActiveLoginSigningSessionStatus,
} from './signerWarmup';
import {
  createThresholdLoginWarmSessionId,
  createThresholdEd25519DeviceLinkRequiredError,
  requireLoginUnlockSessionUses,
  exactAuthorizationFromPasskeyEcdsaActivation,
} from './signerState';
import {
  preparePasskeyExchangeEcdsaActivation,
  completePasskeyWalletUnlock,
  rememberPasskeySessionCustodyForExport,
  resolveUnlockEcdsaKeyFactsInventoryAuthority,
} from './passkeyExchange';
import { readThresholdWarmupAuthMethodBinding } from './authority';
import { resumeNearAfterSuccessfulUnlock, clearFailedUnlockSessionState } from './unlockLifecycle';

/**
 * Core login function (passkey identity + Router API-issued sessions).
 *
 * Responsibilities:
 * - Select the active account + signer slot (last-user pointer).
 * - Optionally warm owner signing sessions from the verified unlock proof.
 *
 * Note: signing flows still perform their own UserConfirm/WebAuthn prompting as needed.
 */
export async function unlock(
  context: LoginWebContext,
  nearAccountId: AccountId,
  options?: LoginHooksOptions,
): Promise<LoginAndCreateSessionResult> {
  const lastUser = await context.signingEngine.getLastUser();
  if (!lastUser || String(lastUser.nearAccountId) !== String(nearAccountId)) {
    throw new Error('[login] NEAR unlock requires the active wallet binding');
  }
  const selection = resolveLoginWalletUnlockSelection(options?.unlockSelection);
  const subjectSet = await resolveWalletUnlockSubjectSet({
    walletId: String(lastUser.walletId),
    requestedCapabilityFamilies:
      selection.mode === 'ed25519_only'
        ? { kind: 'near_ed25519_only' }
        : selection.mode === 'ecdsa_only'
          ? { kind: 'evm_family_ecdsa_only' }
          : { kind: 'all_registered_mpc' },
  });
  if (subjectSet.kind !== 'resolved') {
    throw new Error(`[login] wallet unlock subject resolution failed: ${subjectSet.kind}`);
  }
  return await unlockInternal(context, subjectSet.subjectSet, options, { kind: 'wallet_only' });
}

export async function unlockResolvedWalletSubjectSet(
  context: LoginWebContext,
  subjectSet: WalletUnlockSubjectSet,
  options?: LoginHooksOptions,
): Promise<LoginAndCreateSessionResult> {
  return await unlockInternal(context, subjectSet, options, { kind: 'wallet_only' });
}

type LoginUnlockCompletion = { readonly kind: 'wallet_only' };

async function unlockInternal(
  context: LoginWebContext,
  subjectSet: WalletUnlockSubjectSet,
  options: LoginHooksOptions | undefined,
  _completion: LoginUnlockCompletion,
): Promise<LoginAndCreateSessionResult> {
  const { onEvent, onError, afterCall } = options || {};
  const { signingEngine } = context;
  const walletUnlockSelection = resolveLoginWalletUnlockSelectionForSubjectSet({
    selection: options?.unlockSelection,
    subjectSet,
  });
  const walletIdentity = resolveLoginWalletIdentity({
    subjectSet,
    selection: walletUnlockSelection,
  });
  const unlockSubjectId =
    walletIdentity.kind === 'near_ed25519_capable_wallet'
      ? String(walletIdentity.nearAccountId)
      : String(walletIdentity.walletId);
  let loginCredential: WebAuthnAuthenticationCredential | undefined;

  // All unlock branches emit the same ordered event stream for caller progress UIs.
  emitUnlockEvent(onEvent, unlockSubjectId, {
    phase: UnlockEventPhase.STEP_01_STARTED,
    status: 'started',
    authMethod: 'passkey',
  });

  // Keep error normalization in one place so hooks and events behave consistently.
  try {
    // Best-effort parity check: stale sealed refresh state should not block the passkey prompt.
    void signingEngine.assertSealedRefreshStartupParity().catch((error: unknown) => {
      console.warn(
        '[login] sealed refresh startup parity check failed during unlock; continuing to local passkey prompt',
        error instanceof Error ? error.message : String(error || 'unknown error'),
      );
    });

    // WebAuthn fails outside secure contexts, so fail before any account mutation.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      const errorMessage = 'Passkey operations require a secure context (HTTPS or localhost).';
      return await finalizeLoginError({
        unlockSubjectId,
        message: errorMessage,
        error: new Error(errorMessage),
        onEvent,
        onError,
        afterCall,
        callAfterCall: false,
      });
    }

    // Resolve the account subject and authenticator allow-list once for every later prompt.
    const signerSlotHint = parseSignerSlot(options?.signerSlot, { min: 1 });
    const accountPhase = await readLoginUnlockAccountPhase({
      signingEngine,
      identity: walletIdentity,
      signerSlotHint,
      onEvent,
    });
    const {
      accountSubject,
      authenticators,
      baseSignerSlot,
      localUnlockAuthMethod,
      requiresLocalPasskeyUnlock,
    } = accountPhase;

    // Shared prompt wrapper used by local unlock, owner-proof verification, and inventory repair.
    const collectLocalPasskeyCredentialForChallenge = async (args: {
      challengeB64u: string;
      saveAsLoginCredential: boolean;
      credentialIds: readonly string[] | null;
    }): Promise<WebAuthnAuthenticationCredential> => {
      const eligibleAuthenticators = authenticatorsForCredentialIds({
        authenticators,
        credentialIds: args.credentialIds,
      });
      const credential = await collectPasskeyLoginAssertion({
        signingEngine,
        subjectId: unlockSubjectId,
        challengeB64u: args.challengeB64u,
        authenticators: eligibleAuthenticators,
        onPromptStarted: () => {
          emitUnlockEvent(onEvent, unlockSubjectId, {
            phase: UnlockEventPhase.STEP_03_PASSKEY_PROMPT_STARTED,
            status: 'waiting_for_user',
            authMethod: 'passkey',
            interaction: {
              kind: 'passkey_assert',
              overlay: 'show',
            },
          });
        },
        onPromptSucceeded: () => {
          emitUnlockEvent(onEvent, unlockSubjectId, {
            phase: UnlockEventPhase.STEP_03_PASSKEY_PROMPT_SUCCEEDED,
            status: 'succeeded',
            authMethod: 'passkey',
            interaction: {
              kind: 'passkey_assert',
              overlay: 'hide',
            },
          });
        },
      });
      if (args.saveAsLoginCredential) {
        loginCredential = credential;
      }
      return credential;
    };

    // Local unlock asks for a fresh assertion only when no earlier branch produced one.
    const collectFreshLocalPasskeyUnlockCredentialForLogin = async (): Promise<void> => {
      const credential = await collectFreshLocalPasskeyUnlockCredential({
        currentCredential: loginCredential,
        collectCredentialForChallenge: async (challengeB64u) =>
          await collectLocalPasskeyCredentialForChallenge({
            challengeB64u,
            saveAsLoginCredential: true,
            credentialIds: resolveLoginPasskeyPromptCredentialIds({
              authenticators,
              signerSlot: baseSignerSlot,
              serverCredentialIds: [],
            }),
          }),
      });
      if (credential) loginCredential = credential;
    };

    // Warm-session policy controls whether unlock also primes threshold signing lanes.
    const signingSessionPolicy = resolveUnlockSessionPolicy({
      defaults: context.configs.signing.sessionDefaults,
      override: options?.signingSession,
    });

    const shouldWarmThresholdSigningSession = signingSessionPolicy.kind === 'enabled';
    const requireThresholdWarmup = shouldWarmThresholdSigningSession;
    const thresholdKeyMaterialPrefetch =
      requireThresholdWarmup && walletIdentity.kind === 'near_ed25519_capable_wallet'
        ? getNearThresholdKeyMaterial(
            {
              clientDB: IndexedDBManager,
              keyMaterialStore: IndexedDBManager,
            },
            walletIdentity.nearAccountId,
            baseSignerSlot,
          ).catch(() => null)
        : Promise.resolve(null);
    let completedPasskeyExchangeEcdsaActivation: CompletedPasskeyExchangeEcdsaActivation | null =
      null;
    let completedPasskeyEd25519Session: PasskeyWalletUnlockEd25519Session | null = null;
    let completedPasskeyWalletSessionAuthorization: ExactWalletSessionAuthorization | null = null;
    let completedPasskeySessionCustody: PasskeySessionCustodyUnlockV1 | null = null;
    let localWarmupRouteAuthorization = resolveLoginWarmupRouteAuthorization();
    let warmupPhase: ThresholdLoginWarmupPhaseResult | null = null;

    // Warmup callers use this after side effects to turn a missing session into a clear error.
    const requireActiveWarmSession = (
      source: string,
      sessionStatus: SigningSessionStatus | null | undefined,
    ): ThresholdWarmLoginAndCreateSessionResult['signingSession'] => {
      if (isActiveThresholdLoginSigningSession(sessionStatus)) {
        return sessionStatus;
      }
      const status = String(sessionStatus?.status || 'not_found');
      throw new Error(
        `[login] ${source} did not produce an active warm signing session (status=${status})`,
      );
    };

    // Threshold warmup depends on any passkey assertion collected earlier in this unlock.
    const warmThresholdSigningSessions = async (
      warmupInput: ThresholdLoginWarmupPhaseInput,
    ): Promise<ThresholdLoginWarmupPhaseResult> => {
      emitUnlockEvent(onEvent, unlockSubjectId, {
        phase: UnlockEventPhase.STEP_05_SIGNING_SESSION_WARMUP_STARTED,
        status: 'running',
        authMethod: loginCredential ? 'passkey' : 'warm_session',
      });

      // Ed25519 warmup needs stored NEAR threshold key material; ECDSA-only unlock can skip it.
      const nearWalletBinding = warmupInput.wantsEd25519Warmup
        ? requireNearLoginWalletBinding(walletIdentity)
        : null;
      const managedRuntimeScopeBootstrap = resolveManagedRuntimeScopeBootstrap(context.configs);
      let volatileWarmMaterialCleared = false;
      const clearVolatileWarmMaterialForUnlock = async (): Promise<void> => {
        if (volatileWarmMaterialCleared) return;
        volatileWarmMaterialCleared = true;
        await signingEngine.clearVolatileWarmSigningMaterial(walletIdentity.walletId);
      };

      if (warmupInput.wantsEcdsaWarmup) {
        const reconciliation = await reconcileCanonicalEcdsaActivationSelectors({
          workerCtx: signingEngine.getSignerWorkerContext(),
          selectors: ecdsaActivationSelectorsFromSubjectSet(walletIdentity.subjectSet),
        });
        reportNonSettledEcdsaActivationReconciliation(reconciliation);
      }

      // Resolve local ECDSA key facts before planning; authenticated inventory can repair gaps.
      const storedCanonicalEcdsaContext = warmupInput.wantsEcdsaWarmup
        ? await resolveCanonicalThresholdEcdsaWarmSessionContext(
            context,
            walletIdentity.walletId,
            {
              keyFactsInventoryAuthority: warmupInput.keyFactsInventoryAuthority,
              keyFactsInventoryRequested: Boolean(options?.ecdsaKeyFactsInventory),
              relayerUrl: warmupInput.relayerUrl,
              rpId: warmupInput.rpId,
            },
            localUnlockAuthMethod,
          )
        : { ecdsaKeys: [] };
      const thresholdKeyMaterial = await thresholdKeyMaterialPrefetch;
      const participantIds =
        thresholdKeyMaterial?.participants.map((participant) => participant.id) || [];
      if (warmupInput.wantsEcdsaWarmup) {
        assertEcdsaWarmupMatchesUnlockSubjects({
          identity: walletIdentity,
          context: storedCanonicalEcdsaContext,
        });
      }

      // The plan decides which signers warm, and whether Ed25519/ECDSA depends on the other.
      const warmupPlan = resolveThresholdLoginWarmupPlan({
        selection: warmupInput.selection,
        selectedEcdsaTargets: warmupInput.selectedEcdsaTargets,
        storedCanonicalEcdsaContext,
        wantsEd25519Warmup: warmupInput.wantsEd25519Warmup,
      });
      const passkeyExchangeEcdsaActivationForWarmup = completedPasskeyExchangeEcdsaActivation;
      const passkeyExchangeOwnsFirstEcdsaActivation = Boolean(
        passkeyExchangeEcdsaActivationForWarmup && warmupPlan.signersToWarm.includes('ecdsa'),
      );
      const ed25519DependsOnEcdsa = passkeyExchangeOwnsFirstEcdsaActivation
        ? warmupPlan.signersToWarm.includes('ed25519')
        : warmupPlan.ed25519DependsOnEcdsa;
      const ecdsaDependsOnEd25519 = passkeyExchangeOwnsFirstEcdsaActivation
        ? false
        : warmupPlan.ecdsaDependsOnEd25519;

      // Decide which branch owns the WebAuthn assertion used by warmup.
      const warmupPasskeyCredentialPlan = resolveLoginWarmupPasskeyCredentialPlan({
        requiresLocalPasskeyUnlock,
        hasLoginCredential: Boolean(loginCredential),
        routeAuthorization: warmupInput.routeAuthorization,
        warmupPlan,
      });

      // Clear old volatile material after reading durable facts, before minting new sessions.
      await clearVolatileWarmMaterialForUnlock();

      // Describe how Ed25519 should be minted so the runner receives one precise state.
      const plannedEd25519SessionId = createThresholdLoginWarmSessionId('threshold-login');
      let ed25519MintPlan: LoginWarmupEd25519MintPlan = !warmupPlan.signersToWarm.includes(
        'ed25519',
      )
        ? { kind: 'not_requested' }
        : ed25519DependsOnEcdsa
          ? {
              kind: 'ecdsa_authorized',
              thresholdSessionId: plannedEd25519SessionId,
            }
          : {
              kind: 'fresh',
            };
      switch (warmupPasskeyCredentialPlan.kind) {
        case 'existing_passkey_credential':
        case 'no_passkey_credential_required':
          break;
        case 'wallet_custody': {
          if (warmupInput.ed25519SessionAuthority.kind !== 'passkey') {
            throw new Error('[login] wallet custody requires passkey wallet authority');
          }
          if (
            !completedPasskeySessionCustody ||
            completedPasskeySessionCustody.ed25519.kind !== 'active'
          ) {
            throw createThresholdEd25519DeviceLinkRequiredError();
          }
          ed25519MintPlan = {
            kind: 'wallet_custody',
            thresholdSessionId: plannedEd25519SessionId,
            custody: {
              ...completedPasskeySessionCustody,
              ed25519: completedPasskeySessionCustody.ed25519,
            },
          };
          break;
        }
        default:
          return assertNeverLoginState(warmupPasskeyCredentialPlan);
      }
      if (nearWalletBinding && !thresholdKeyMaterial && ed25519MintPlan.kind !== 'wallet_custody') {
        throw new Error(
          `[login] threshold warm-up requires threshold key material for ${nearWalletBinding.nearAccountId} signer slot ${warmupInput.signerSlot}`,
        );
      }

      // Passkey ID can come from the fresh assertion or stored account authenticators.
      const authenticatedPasskeyCredentialIdB64u = loginCredential
        ? passkeyCredentialIdB64uFromAuthentication(loginCredential)
        : '';
      const localPasskeyCredentialIdB64u = String(
        authenticatedPasskeyCredentialIdB64u ||
          authenticators.find((authenticator) => authenticator.signerSlot === baseSignerSlot)
            ?.credentialId ||
          authenticators[0]?.credentialId ||
          '',
      ).trim();
      const credentialState: LoginWarmupCredentialState = loginCredential
        ? {
            kind: 'available',
            credential: loginCredential,
            localPasskeyCredentialIdB64u,
          }
        : localPasskeyCredentialIdB64u
          ? {
              kind: 'credential_id_only',
              localPasskeyCredentialIdB64u,
            }
          : {
              kind: 'unavailable',
              localPasskeyCredentialIdB64u: '',
            };

      const runtimeScopeBootstrapState: LoginWarmupRuntimeScopeBootstrapState =
        managedRuntimeScopeBootstrap
          ? {
              kind: 'available',
              runtimeScopeBootstrap: managedRuntimeScopeBootstrap,
            }
          : {
              kind: 'unavailable',
            };

      // Run Ed25519/ECDSA warmup and then derive the public signing-session status.
      const warmupResult = await primeThresholdLoginWarmSigners({
        statusReads,
        context,
        signingEngine,
        walletIdentity,
        signerSlot: warmupInput.signerSlot,
        thresholdKeyMaterial,
        relayerUrl: warmupInput.relayerUrl,
        relayerKeyId: thresholdKeyMaterial?.relayerKeyId || '',
        participantIds,
        ttlMs: signingSessionPolicy.ttlMs,
        unlockRemainingUses: requireLoginUnlockSessionUses(
          signingSessionPolicy.unlockRemainingUses,
        ),
        ecdsaContext: warmupPlan.ecdsaContext,
        credentialState,
        runtimeScopeBootstrapState,
        signersToWarm: warmupPlan.signersToWarm,
        ed25519DependsOnEcdsa,
        ecdsaDependency: ecdsaDependsOnEd25519
          ? { kind: 'ed25519_wallet_session_authority' }
          : { kind: 'none' },
        ed25519MintPlan,
        ed25519SessionAuthority: warmupInput.ed25519SessionAuthority,
        routeAuthorization: warmupInput.routeAuthorization,
        passkeyExchangeEcdsaActivation: passkeyExchangeEcdsaActivationForWarmup,
        passkeyUnlockEd25519Session: completedPasskeyEd25519Session,
        passkeyUnlockWalletSessionAuthorization: completedPasskeyWalletSessionAuthorization,
      });

      // Successful provisioning has already sealed and activated the exact Ed25519 session.
      if (warmupPlan.signersToWarm.includes('ed25519')) {
        const ed25519Session = warmupResult.ed25519Session;
        if (!ed25519Session) {
          throw new Error('[login] threshold warm-up omitted the Ed25519 session result');
        }
        const activeSigningSession = requireActiveWarmSession(
          'threshold warm-up',
          createActiveLoginSigningSessionStatus({
            session: ed25519Session,
            authMethod: localUnlockAuthMethod,
          }),
        );

        // Emit lane-specific events after active-session validation succeeds.
        emitUnlockEvent(onEvent, unlockSubjectId, {
          phase: UnlockEventPhase.STEP_05_ED25519_SIGNING_SESSION_READY,
          status: 'succeeded',
          authMethod: 'warm_session',
        });
        if (warmupPlan.signersToWarm.includes('ecdsa')) {
          emitUnlockEvent(onEvent, unlockSubjectId, {
            phase: UnlockEventPhase.STEP_05_ECDSA_SIGNING_SESSION_READY,
            status: 'succeeded',
            authMethod: 'warm_session',
          });
        }
        return {
          kind: 'threshold_login_warmup_ready',
          signingSession: activeSigningSession,
          signersWarmed: warmupPlan.signersToWarm,
        };
      }

      if (warmupPlan.signersToWarm.length !== 1 || warmupPlan.signersToWarm[0] !== 'ecdsa') {
        throw new Error('[login] threshold warm-up signer selection is invalid');
      }

      // ECDSA-only wallets warm their ECDSA lanes without an Ed25519 session.
      emitUnlockEvent(onEvent, unlockSubjectId, {
        phase: UnlockEventPhase.STEP_05_ECDSA_SIGNING_SESSION_READY,
        status: 'succeeded',
        authMethod: 'warm_session',
      });
      return {
        kind: 'threshold_login_ecdsa_only_warmup_ready',
        signersWarmed: ['ecdsa'],
      };
    };

    // Login persistence is intentionally after auth and warmup side effects succeed.
    //
    // A NEAR-capable wallet has TWO profile records: the wallet profile and the
    // NEAR account projection. setLastUser writes the last-user pointer against
    // the WALLET profile, but getLastLoggedInSignerSlot — which NEAR signing
    // resolves its signer slot through — reads it against the projection, and
    // throws "No last user session for account <id>" when they disagree.
    // Registration never hit this because it activates through
    // activateAuthenticatedWalletState, which writes the projection. Unlock has
    // to do the same, or signing works only in the session where the wallet was
    // registered. Warmup cannot repair it either: it derives its signerSlot from
    // the very read that is failing, so it skips activation exactly when the
    // pointer is missing.
    const persistSuccessfulLoginState = async (signerSlot: number): Promise<void> => {
      await signingEngine.setLastUser(walletIdentity.walletId, signerSlot);
      if (walletIdentity.kind === 'near_ed25519_capable_wallet') {
        if (
          !(accountSubject.kind === 'near_wallet' && accountSubject.operationalPublicKey === null)
        ) {
          await signingEngine.activateAuthenticatedWalletState({
            walletId: walletIdentity.walletId,
            nearAccountId: toAccountId(walletIdentity.nearAccountId),
            signerSlot,
            nearClient: context.nearClient,
          });
        }
      }
    };

    // Nonce recovery is best-effort; stale lane leases should not fail login.
    const recoverNonceLanesAfterUnlock = async (): Promise<void> => {
      await signingEngine
        .getNonceCoordinator()
        .recoverDurableLeases({ walletId: walletIdentity.walletId })
        .catch((error: unknown) => {
          console.warn('[login] nonce lane durable recovery after unlock failed', error);
        });
    };

    // Avoid a duplicate prompt when threshold warmup will collect the assertion itself.
    const noServerSessionPasskeyCredentialPlan = resolveLoginNoServerSessionPasskeyCredentialPlan({
      requiresLocalPasskeyUnlock,
      requireThresholdWarmup,
      hasLoginCredential: Boolean(loginCredential),
    });
    switch (noServerSessionPasskeyCredentialPlan.kind) {
      case 'wallet_unlock_owns_passkey_credential':
      case 'passkey_credential_already_collected':
      case 'no_local_passkey_required':
        break;
      case 'local_unlock_passkey_assertion':
        await collectFreshLocalPasskeyUnlockCredentialForLogin();
        break;
      default:
        return assertNeverLoginState(noServerSessionPasskeyCredentialPlan);
    }

    const statusReads = new WalletSessionStatusReadScope();
    // One verified wallet-unlock assertion mints every passkey warm session requested below.
    if (requireThresholdWarmup && localUnlockAuthMethod === SIGNER_AUTH_METHODS.passkey) {
      const preparedActivation = await preparePasskeyExchangeEcdsaActivation({
        context,
        walletIdentity,
        selection: walletUnlockSelection,
        ttlMs: signingSessionPolicy.ttlMs,
        remainingUses: requireLoginUnlockSessionUses(signingSessionPolicy.unlockRemainingUses),
      });
      const relayUrl = String(context.configs.network.relayer.url || '').trim();
      const rpId = String(signingEngine.getRpId() || '').trim();
      if (!relayUrl || !rpId) {
        throw new Error('[login] passkey wallet unlock requires relayer URL and rpId');
      }
      const completedUnlock = await completePasskeyWalletUnlock(
        {
          context,
          walletIdentity,
          unlockSubjectId,
          onEvent,
          authenticators,
          signerSlot: baseSignerSlot,
          remainingUses: requireLoginUnlockSessionUses(signingSessionPolicy.unlockRemainingUses),
          relayUrl,
          rpId,
          expectedOrigin: undefined,
          activation: preparedActivation,
          collectCredentialForChallenge: async (challenge) =>
            await collectLocalPasskeyCredentialForChallenge({
              challengeB64u: challenge.challengeB64u,
              saveAsLoginCredential: true,
              credentialIds: challenge.credentialIds,
            }),
        },
        statusReads,
      );
      loginCredential = completedUnlock.credential;
      completedPasskeyExchangeEcdsaActivation = completedUnlock.activation;
      completedPasskeyEd25519Session = completedUnlock.result.ed25519Session;
      completedPasskeyWalletSessionAuthorization =
        completedUnlock.result.walletSessionAuthorization ??
        (completedUnlock.activation
          ? exactAuthorizationFromPasskeyEcdsaActivation(
              completedUnlock.activation.sessionActivation,
            )
          : null);
      completedPasskeySessionCustody = completedUnlock.custody;
      await rememberPasskeySessionCustodyForExport({
        walletId: String(walletIdentity.walletId),
        unlock: completedUnlock,
      });
      localWarmupRouteAuthorization = resolveLoginWarmupRouteAuthorization();
    }

    if (!loginCredential) {
      throw new Error('[login] successful Passkey unlock omitted its credential');
    }
    await markPasskeyLoginSelectionUnlocked({
      context,
      walletIdentity,
      credential: loginCredential,
    });

    // Warm threshold sessions with the authorization established above.
    if (requireThresholdWarmup) {
      const authMethodBinding = await readThresholdWarmupAuthMethodBinding({
        walletId: walletIdentity.walletId,
        authMethod: localUnlockAuthMethod,
      });
      const keyFactsInventoryAuthority = resolveUnlockEcdsaKeyFactsInventoryAuthority({
        completedActivation: completedPasskeyExchangeEcdsaActivation,
        request: options?.ecdsaKeyFactsInventory,
        routeAuthorization: localWarmupRouteAuthorization,
        wantsEcdsaWarmup: resolveLoginUnlockWarmupBranchPlan({
          subjectSet: walletIdentity.subjectSet,
          selection: walletUnlockSelection,
          hasConfiguredEcdsaTargets:
            listConfiguredThresholdEcdsaPublicationTargets(context.configs.network.chains).length >
            0,
        }).wantsEcdsaWarmup,
      });
      warmupPhase = await warmThresholdSigningSessions(
        resolveThresholdLoginWarmupPhaseInput({
          context,
          signerSlot: baseSignerSlot,
          authenticators,
          selection: walletUnlockSelection,
          subjectSet: walletIdentity.subjectSet,
          authMethod: localUnlockAuthMethod,
          authMethodBinding,
          keyFactsInventoryAuthority,
          routeAuthorization: localWarmupRouteAuthorization,
        }),
      );
      if (localUnlockAuthMethod === SIGNER_AUTH_METHODS.passkey) {
        const authenticatedCredential = loginCredential;
        if (!authenticatedCredential) {
          throw new Error('[login] passkey threshold warm-up completed without a credential');
        }
        await assertPasskeyUnlockRuntimePostconditions({
          context,
          statusReads,
          walletIdentity,
          signersWarmed: warmupPhase.signersWarmed,
          credential: authenticatedCredential,
        });
      }
    }
    await persistSuccessfulLoginState(baseSignerSlot);
    void recoverNonceLanesAfterUnlock();
    if (
      completedPasskeyWalletSessionAuthorization &&
      loginCredential &&
      completedPasskeySessionCustody
    ) {
      const prfFirstB64u = passkeyPrfFirstB64uFromCredential(loginCredential);
      if (prfFirstB64u) {
        void resumeNearAfterSuccessfulUnlock({
          context,
          sessionAuthority: completedPasskeyWalletSessionAuthorization,
          factor: {
            kind: 'passkey',
            rpId: signingEngine.getRpId(),
            credentialIdB64u: passkeyCredentialIdB64uFromAuthentication(loginCredential),
            prfFirstB64u,
          },
          ownedFactorSecret: base64UrlDecode(prfFirstB64u).slice().buffer,
          custodyEnvelope: completedPasskeySessionCustody.envelope,
        });
      }
    }

    // Return the same public result shape as the server-session branch.
    const baseLoginResult = buildSuccessfulLoginResult({
      identity: walletIdentity,
      accountSubject,
    });
    const loginResult: LoginAndCreateSessionResult = warmupPhase
      ? {
          ...baseLoginResult,
          ...(warmupPhase.kind === 'threshold_login_warmup_ready'
            ? { signingSession: warmupPhase.signingSession }
            : {}),
        }
      : baseLoginResult;

    emitUnlockEvent(onEvent, unlockSubjectId, {
      phase: UnlockEventPhase.STEP_06_SESSION_READY,
      status: 'succeeded',
      authMethod: loginCredential ? 'passkey' : undefined,
    });

    return await finalizeLoginSuccess({
      context,
      authMethod: localUnlockAuthMethod,
      unlockSubjectId,
      loginResult,
      onEvent,
      afterCall,
    });
  } catch (err: unknown) {
    console.warn('[login] unlock failed before active session commit', {
      unlockSubjectId,
      message:
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message || '')
          : String(err || ''),
    });
    await clearFailedUnlockSessionState({
      context,
      walletId: walletIdentity.walletId,
    });
    // Normalize every thrown value through the public login error hooks/events.
    const errorMessage = getUserFriendlyErrorMessage(err, 'login') || 'Login failed';
    return await finalizeLoginError({
      unlockSubjectId,
      message: errorMessage,
      error: err,
      cancelled: isUserCancellationError(err),
      onEvent,
      onError,
      afterCall,
    });
  }
}
