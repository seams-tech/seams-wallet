import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import type { ExactWalletSessionAuthorization } from '@/core/signingEngine/session/persistence/walletSessionAuthorizationProjection';
import type {
  CreateUnlockFlowEventInput,
  RegistrationFlowEvent,
  UnlockFlowEvent,
} from '@/core/types/sdkSentEvents';
import { RegistrationEventPhase, UnlockEventPhase } from '@/core/types/sdkSentEvents';
import { IndexedDBManager } from '@/core/indexedDB';
import { toError } from '@shared/utils/errors';
import { parseWalletAuthMethodId, type WalletAuthMethodId } from '@shared/utils/domainIds';
import { sha256HexUtf8 } from '@shared/utils/digests';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletEmailOtpLoginOperation } from '@shared/utils/emailOtpDomain';
import {
  isEmailOtpWalletAuthAuthority,
  parseWalletAuthAuthorityRef,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import type {
  AuthCapability,
  EmailOtpChallengeResult,
  EmailOtpOperationChallengeResult,
  EmailOtpEcdsaCapabilityResult,
  SeamsWebContext,
  RegistrationCapability,
} from '@/SeamsWeb/signingSurface/types';
import type {
  EnrollEmailOtpInternalResult,
  LoginWithEmailOtpEcdsaCapabilityInternalResult,
} from '@/core/signingEngine/flows/signEvmFamily/emailOtpPublic';
import {
  toWalletId,
  type ThresholdEcdsaChainTarget,
  type WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  assertWalletRuntimePostconditions,
  type WalletRuntimeInventory,
} from '@/core/signingEngine/session/postconditions/runtimePostconditions';
import type { LoginWithEmailOtpWalletCustodyEd25519Args } from '@/core/signingEngine/walletCustody/ed25519Login';
import type { EmailOtpWorkerProgressEvent } from '@/core/signingEngine/workerManager/workerTypes';
import {
  requestEmailOtpChallenge,
  requestEmailOtpEnrollmentChallenge,
  resolveGoogleEmailOtpProvider,
} from '@/SeamsWeb/operations/authMethods/emailOtp/challenge';
import {
  startGoogleSignIn,
  type GoogleEmailOtpLinkedUnlockSelection,
  type GoogleEmailOtpWalletAuthDeps,
} from '@/SeamsWeb/operations/authMethods/emailOtp/googleEmailOtpWalletAuthFlow';
import {
  resolveExactLinkedEmailOtpAuthority,
  resolveLinkedDeviceEmailOtpAuthoritySelection,
  unlockLinkedDeviceEmailOtpWallet,
} from '@/SeamsWeb/operations/auth/login';
import {
  activateEmailOtpWalletAfterUnlock,
  persistVerifiedEmailOtpAuthorityAfterUnlock,
  walletAuthAuthorityRefForVerifiedEmailOtpUnlock,
  type EmailOtpWalletPostUnlockActivation,
} from '@/SeamsWeb/operations/authMethods/emailOtp/walletActivation';
import type { ActiveEmailOtpWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import { type NearEd25519SignerBinding } from '@shared/utils/walletCapabilityBindings';
import type { WalletAuthorityProvenanceV1 } from '@shared/authorization/walletAuthority';
import type { EmailOtpCommandGroups } from '@/SeamsWeb/publicApi/auth';
import {
  type InternalEmailOtpEcdsaCapabilityArgs,
  type EmailOtpUnlockTimingBucket,
  nowMs,
  createEmailOtpUnlockTimings,
  recordEmailOtpUnlockElapsedTiming,
  addEmailOtpUnlockTiming,
  isEmailOtpUnlockDiagnosticsEnabled,
  logEmailOtpUnlockTimingSummary,
  requireConcreteEcdsaChainTarget,
  emailOtpRegistrationFlowId,
  emailOtpUnlockFlowId,
  emitEmailOtpRegistrationEvent,
  emitEmailOtpUnlockEvent,
  emitEmailOtpRegistrationFailure,
  emitEmailOtpUnlockFailure,
} from '@/SeamsWeb/walletIframe/shared/emailOtpLifecycle';

type EmailOtpWalletCustodyEd25519LoginDomainArgs = Omit<
  LoginWithEmailOtpWalletCustodyEd25519Args,
  'emailHashHex'
>;

type EmailOtpUnlockActiveRuntimeState = {
  kind: 'email_otp_unlock_active_runtime_state_v1';
  inventory: WalletRuntimeInventory;
};

async function googleEmailOtpUnlockExecution(
  provenance: WalletAuthorityProvenanceV1,
  walletAuthMethodId: WalletAuthMethodId,
): Promise<'ordinary' | 'authority'> {
  if (provenance.kind === 'device_link') return 'authority';
  const pendingRows = await IndexedDBManager.listPendingWalletRegistrationCommits();
  for (const pending of pendingRows) {
    if (
      pending.operation === 'near_provisioning' &&
      pending.signerPlanKind === 'near_ed25519_and_evm_family_ecdsa' &&
      pending.walletAuthMethodId === walletAuthMethodId
    )
      return 'authority';
  }
  return 'ordinary';
}

function requireWalletAuthMethodId(value: string): WalletAuthMethodId {
  const parsed = parseWalletAuthMethodId(value);
  if (!parsed.ok) {
    throw new Error('Email OTP unlock returned an invalid wallet auth method id');
  }
  return parsed.value;
}

function exactEmailOtpAuthorityRefFromLoginResult(
  result: LoginWithEmailOtpEcdsaCapabilityInternalResult,
): WalletAuthAuthorityRef {
  const authority = result.recovery.verifiedAuthorityProjection.authority;
  const authorityRef = parseWalletAuthAuthorityRef({
    kind: 'wallet_auth_authority_ref',
    walletId: authority.walletId,
    walletAuthMethodId: result.authorization.record.authMethodId,
    authorityDigest: authority.authorityDigestB64u,
  });
  if (!authorityRef) {
    throw new Error('Email OTP unlock returned an invalid authority reference');
  }
  return authorityRef;
}

type EmailOtpUnlockActivationPlan = {
  kind: 'email_otp_unlock_activation_plan_v1';
  mode: 'evm_family_ecdsa';
  activeAuthorization: ExactWalletSessionAuthorization;
  authorizations: readonly [ExactWalletSessionAuthorization, ...ExactWalletSessionAuthorization[]];
  runtimeState: EmailOtpUnlockActiveRuntimeState;
};

function recordEmailOtpUnlockTiming(
  timings: Record<EmailOtpUnlockTimingBucket, number>,
  bucket: EmailOtpUnlockTimingBucket,
  startedAtMs: number,
): void {
  addEmailOtpUnlockTiming(timings, bucket, nowMs() - startedAtMs);
}

function emailOtpUnlockActiveRuntimeState(
  inventory: WalletRuntimeInventory,
): EmailOtpUnlockActiveRuntimeState {
  return {
    kind: 'email_otp_unlock_active_runtime_state_v1',
    inventory,
  };
}

function buildEmailOtpEcdsaUnlockActivationPlan(args: {
  walletSession: WalletSessionRef;
  result: LoginWithEmailOtpEcdsaCapabilityInternalResult;
  runtimeInventory: WalletRuntimeInventory;
}): EmailOtpUnlockActivationPlan {
  if (args.result.authorization.record.walletId !== args.walletSession.walletId) {
    throw new Error('Email OTP unlock authorization does not match the wallet session');
  }
  return {
    kind: 'email_otp_unlock_activation_plan_v1',
    mode: 'evm_family_ecdsa',
    activeAuthorization: args.result.authorization,
    authorizations: args.result.authorizations,
    runtimeState: emailOtpUnlockActiveRuntimeState(args.runtimeInventory),
  };
}

function logEmailOtpUnlockActivationPlan(plan: EmailOtpUnlockActivationPlan): void {
  if (!isEmailOtpUnlockDiagnosticsEnabled()) return;
  console.info('[EmailOtpUnlock] activation plan constructed', {
    kind: plan.kind,
    mode: plan.mode,
    walletId: plan.activeAuthorization.record.walletId,
    authorityDigest: plan.activeAuthorization.record.authorityDigestB64u,
    walletSessionIds: plan.authorizations.map(authorizationSessionId),
    runtimeTargetCount: plan.runtimeState.inventory.ecdsaByTarget.size,
  });
}

function emitEmailOtpUnlockWorkerProgress(
  onEvent: ((event: UnlockFlowEvent) => void) | undefined,
  args: {
    flowId: string;
    walletId: string;
    challengeId?: string;
    chainTarget: ThresholdEcdsaChainTarget;
    progress: EmailOtpWorkerProgressEvent;
  },
): UnlockEventPhase | null {
  const chainLabel = args.chainTarget.kind === 'tempo' ? 'Tempo' : 'EVM';
  const base = {
    flowId: args.flowId,
    walletId: args.walletId,
    authMethod: 'email_otp' as const,
    ...(args.challengeId ? { requestId: args.challengeId } : {}),
  };
  switch (args.progress.code) {
    case 'otp.verify.succeeded':
      emitEmailOtpUnlockEvent(onEvent, {
        ...base,
        phase: UnlockEventPhase.STEP_03_EMAIL_OTP_VERIFY_SUCCEEDED,
        status: 'succeeded',
        interaction: { kind: 'otp_input', overlay: 'hide' },
      });
      return UnlockEventPhase.STEP_03_EMAIL_OTP_VERIFY_SUCCEEDED;
    case 'signer.ecdsa.bootstrap.started':
      emitEmailOtpUnlockEvent(onEvent, {
        ...base,
        phase: UnlockEventPhase.STEP_05_SIGNING_SESSION_WARMUP_STARTED,
        status: 'running',
        message: `Preparing ${chainLabel} signing session`,
        data: { chainTarget: args.chainTarget },
      });
      return UnlockEventPhase.STEP_05_SIGNING_SESSION_WARMUP_STARTED;
    case 'signer.ecdsa.bootstrap.prepared':
      emitEmailOtpUnlockEvent(onEvent, {
        ...base,
        phase: UnlockEventPhase.STEP_05_SIGNING_SESSION_WARMUP_STARTED,
        status: 'running',
        message: `Coordinating ${chainLabel} signing session`,
        data: { chainTarget: args.chainTarget },
      });
      return UnlockEventPhase.STEP_05_SIGNING_SESSION_WARMUP_STARTED;
    case 'signer.ecdsa.bootstrap.responded':
      emitEmailOtpUnlockEvent(onEvent, {
        ...base,
        phase: UnlockEventPhase.STEP_05_SIGNING_SESSION_WARMUP_STARTED,
        status: 'running',
        message: `Finalizing ${chainLabel} signing session`,
        data: { chainTarget: args.chainTarget },
      });
      return UnlockEventPhase.STEP_05_SIGNING_SESSION_WARMUP_STARTED;
    case 'signer.ecdsa.bootstrap.succeeded':
      emitEmailOtpUnlockEvent(onEvent, {
        ...base,
        phase: UnlockEventPhase.STEP_05_SIGNING_SESSION_WARMUP_STARTED,
        status: 'running',
        message: `Saving ${chainLabel} signing session`,
        data: { chainTarget: args.chainTarget },
      });
      return UnlockEventPhase.STEP_05_SIGNING_SESSION_WARMUP_STARTED;
    default:
      return null;
  }
}

type HostEmailOtpDependencies = {
  getContext: () => SeamsWebContext;
  registerWallet: RegistrationCapability['registerWallet'];
  getWalletSession: AuthCapability['getSession'];
  resumePendingAcknowledgements: () => void;
};

export function createWalletHostEmailOtpCommands(
  deps: HostEmailOtpDependencies,
): EmailOtpCommandGroups {
  const commands = new HostEmailOtpCommands(deps);
  return {
    auth: {
      requestEmailOtpChallenge: commands.requestEmailOtpChallengeDomain.bind(commands),
      requestEmailOtpSigningSessionChallenge:
        commands.requestEmailOtpSigningSessionChallengeDomain.bind(commands),
      refreshEmailOtpSigningSession: commands.refreshEmailOtpSigningSessionDomain.bind(commands),
      loginWithEmailOtpEcdsaCapability:
        commands.loginWithEmailOtpEcdsaCapabilityDomain.bind(commands),
      unlockAddedEmailOtpWallet: commands.loginWithLinkedEmailOtpWalletDomain.bind(commands),
      startGoogleSignIn: commands.startGoogleSignInDomain.bind(commands),
    },
    registration: {
      requestEmailOtpEnrollmentChallenge:
        commands.requestEmailOtpEnrollmentChallengeDomain.bind(commands),
      enrollEmailOtp: commands.enrollEmailOtpDomain.bind(commands),
    },
  };
}

function ecdsaPostconditionTarget(chainTarget: ThresholdEcdsaChainTarget): {
  curve: 'ecdsa';
  chainTarget: ThresholdEcdsaChainTarget;
} {
  return { curve: 'ecdsa', chainTarget };
}

class HostEmailOtpCommands {
  constructor(private readonly deps: HostEmailOtpDependencies) {}

  private async readOwnerScopedSigningLanes(
    input: Parameters<
      Parameters<typeof assertWalletRuntimePostconditions>[0]['readOwnerScopedSigningLanes']
    >[0],
  ) {
    return await this.deps
      .getContext()
      .signingEngine.readOwnerScopedSigningLanes(input, new WalletSessionStatusReadScope());
  }

  async requestEmailOtpChallengeDomain(args: {
    walletId: string;
    walletAuthMethodId?: string;
    relayUrl?: string;
    operation?: WalletEmailOtpLoginOperation;
    operationFingerprintDigest?: DigestB64u;
    onEvent?: (event: UnlockFlowEvent) => void;
  }): Promise<EmailOtpOperationChallengeResult> {
    const flowId = emailOtpUnlockFlowId(args.walletId);
    emitEmailOtpUnlockEvent(args.onEvent, {
      flowId,
      walletId: args.walletId,
      authMethod: 'email_otp',
      phase: UnlockEventPhase.STEP_03_EMAIL_OTP_CHALLENGE_STARTED,
      status: 'running',
    });
    try {
      let walletAuthMethodId = args.walletAuthMethodId;
      if (!walletAuthMethodId) {
        const selected = await IndexedDBManager.resolveSelectedWalletAuthority(
          String(args.walletId || '').trim(),
        );
        if (
          selected.kind === 'resolved' &&
          selected.authMethod.kind === 'email_otp' &&
          selected.authMethod.status === 'active' &&
          String(selected.authMethod.walletId) === String(args.walletId || '').trim()
        ) {
          walletAuthMethodId = String(selected.authMethod.walletAuthMethodId);
        }
      }
      if (!walletAuthMethodId) {
        throw new Error('Email OTP challenge requires an exact walletAuthMethodId');
      }
      const result = await requestEmailOtpChallenge({
        relayUrl: String(
          args.relayUrl || this.deps.getContext().configs.network.relayer.url || '',
        ).trim(),
        walletId: String(args.walletId || '').trim(),
        walletAuthMethodId,
        ...(args.operation ? { operation: args.operation } : {}),
        ...(args.operationFingerprintDigest
          ? { operationFingerprintDigest: args.operationFingerprintDigest }
          : {}),
      });
      emitEmailOtpUnlockEvent(args.onEvent, {
        flowId: emailOtpUnlockFlowId(args.walletId, result.challengeId),
        walletId: args.walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_03_EMAIL_OTP_CHALLENGE_SENT,
        status: 'succeeded',
        data: { challengeId: result.challengeId, otpChannel: result.otpChannel },
      });
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      emitEmailOtpUnlockFailure(args.onEvent, {
        flowId,
        walletId: args.walletId,
        authMethod: 'email_otp',
        error: e,
      });
      throw e;
    }
  }

  async requestEmailOtpSigningSessionChallengeDomain(args: {
    walletSession: WalletSessionRef;
    chainTarget: ThresholdEcdsaChainTarget;
    onEvent?: (event: UnlockFlowEvent) => void;
  }): Promise<{
    challengeId: string;
    emailHint?: string;
  }> {
    const walletId = args.walletSession.walletId;
    const flowId = emailOtpUnlockFlowId(walletId);
    emitEmailOtpUnlockEvent(args.onEvent, {
      flowId,
      walletId,
      authMethod: 'email_otp',
      phase: UnlockEventPhase.STEP_03_EMAIL_OTP_CHALLENGE_STARTED,
      status: 'running',
    });
    try {
      const result = await this.deps
        .getContext()
        .signingEngine.requestEmailOtpSigningSessionChallenge({
          walletSession: args.walletSession,
          chainTarget: args.chainTarget,
        });
      emitEmailOtpUnlockEvent(args.onEvent, {
        flowId: emailOtpUnlockFlowId(walletId, result.challengeId),
        walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_03_EMAIL_OTP_CHALLENGE_SENT,
        status: 'succeeded',
        data: { challengeId: result.challengeId, otpChannel: 'email_otp' },
      });
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      emitEmailOtpUnlockFailure(args.onEvent, {
        flowId,
        walletId,
        authMethod: 'email_otp',
        error: e,
      });
      throw e;
    }
  }

  async refreshEmailOtpSigningSessionDomain(args: {
    walletSession: WalletSessionRef;
    chainTarget: ThresholdEcdsaChainTarget;
    challengeId: string;
    otpCode: string;
    ttlMs?: number;
    remainingUses?: number;
    onEvent?: (event: UnlockFlowEvent) => void;
  }): Promise<EmailOtpEcdsaCapabilityResult> {
    const walletId = args.walletSession.walletId;
    const flowId = emailOtpUnlockFlowId(walletId, args.challengeId);
    const chainTarget = requireConcreteEcdsaChainTarget(
      args.chainTarget,
      'Email OTP signing-session refresh',
    );
    emitEmailOtpUnlockEvent(args.onEvent, {
      flowId,
      walletId,
      authMethod: 'email_otp',
      phase: UnlockEventPhase.STEP_03_EMAIL_OTP_VERIFY_STARTED,
      status: 'running',
      interaction: { kind: 'otp_input', overlay: 'none' },
      requestId: args.challengeId,
    });
    try {
      const result = await this.deps.getContext().signingEngine.refreshEmailOtpSigningSession({
        walletSession: args.walletSession,
        chainTarget,
        challengeId: args.challengeId,
        otpCode: args.otpCode,
        ...(typeof args.ttlMs === 'number' ? { ttlMs: args.ttlMs } : {}),
        ...(typeof args.remainingUses === 'number' ? { remainingUses: args.remainingUses } : {}),
      });
      emitEmailOtpUnlockEvent(args.onEvent, {
        flowId,
        walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_03_EMAIL_OTP_VERIFY_SUCCEEDED,
        status: 'succeeded',
        interaction: { kind: 'otp_input', overlay: 'hide' },
        requestId: args.challengeId,
      });
      emitEmailOtpUnlockEvent(args.onEvent, {
        flowId,
        walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_05_ECDSA_SIGNING_SESSION_READY,
        status: 'succeeded',
        requestId: args.challengeId,
        data: { chainTarget },
      });
      emitEmailOtpUnlockEvent(args.onEvent, {
        flowId,
        walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_07_COMPLETED,
        status: 'succeeded',
        requestId: args.challengeId,
      });
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      emitEmailOtpUnlockFailure(args.onEvent, {
        flowId,
        walletId,
        authMethod: 'email_otp',
        requestId: args.challengeId,
        error: e,
      });
      throw e;
    }
  }

  async loginWithEmailOtpEcdsaCapabilityDomain(
    args: InternalEmailOtpEcdsaCapabilityArgs,
  ): Promise<EmailOtpEcdsaCapabilityResult> {
    const walletId = args.walletSession.walletId;
    const flowId = emailOtpUnlockFlowId(walletId, args.challengeId);
    const chainTarget = requireConcreteEcdsaChainTarget(args.chainTarget, 'Email OTP ECDSA unlock');
    const unlockTiming = {
      startedAtMs: nowMs(),
      timings: createEmailOtpUnlockTimings(),
    };
    emitEmailOtpUnlockEvent(args.onEvent, {
      flowId,
      walletId,
      authMethod: 'email_otp',
      phase: UnlockEventPhase.STEP_03_EMAIL_OTP_VERIFY_STARTED,
      status: 'running',
      interaction: { kind: 'otp_input', overlay: 'none' },
      ...(args.challengeId ? { requestId: args.challengeId } : {}),
    });
    try {
      const workerProgressPhases = new Set<UnlockEventPhase>();
      const markWorkerProgress = recordWorkerProgress.bind(
        null,
        workerProgressPhases,
        args.onEvent,
        {
          flowId,
          walletId,
          challengeId: args.challengeId,
          chainTarget,
        },
      );
      const emitIfWorkerProgressMissing = emitMissingWorkerProgress.bind(
        null,
        workerProgressPhases,
        args.onEvent,
      );
      let timingStartedAtMs = nowMs();
      const emailHashHex = await this.emailOtpEmailHashHex(args.emailOtpAuthorityEmail || '');
      recordEmailOtpUnlockTiming(unlockTiming.timings, 'emailHashLookupMs', timingStartedAtMs);
      timingStartedAtMs = nowMs();
      const ed25519Selection =
        args.ed25519Selection.kind === 'present' ? args.ed25519Selection : null;
      const result = await this.deps
        .getContext()
        .signingEngine.loginWithEmailOtpEcdsaCapabilityInternal({
          ...args,
          authoritySelector: {
            kind: 'wallet_auth_method',
            walletAuthMethodId: args.walletAuthMethodId,
          },
          chainTarget,
          emailHashHex,
          ...(ed25519Selection
            ? {
                ed25519YaoRecovery: {
                  kind: 'requested' as const,
                  providerSubject: args.providerIdentity.providerSubjectId,
                  signerSlot: ed25519Selection.signerSlot,
                  nearAccountId: ed25519Selection.nearAccountId,
                  expectedOperationalPublicKey: ed25519Selection.operationalPublicKey,
                  expectedThresholdSessionId: ed25519Selection.thresholdSessionId,
                },
              }
            : { ed25519YaoRecovery: { kind: 'not_requested' as const } }),
          ecdsaBootstrapAuthorization: { kind: 'route_plan_auth' },
          providerIdentity: {
            kind: 'explicit_provider_user',
            provider: args.providerIdentity.provider,
            providerUserId: args.providerIdentity.providerSubjectId,
          },
          onProgress: markWorkerProgress,
        });
      await persistVerifiedEmailOtpAuthorityAfterUnlock({
        walletId: String(walletId),
        walletAuthMethodId: String(args.walletAuthMethodId),
        projection: result.recovery.verifiedAuthorityProjection,
      });
      let walletActivation: EmailOtpWalletPostUnlockActivation;
      if (ed25519Selection) {
        let recoveredEd25519Signer: NearEd25519SignerBinding;
        switch (result.ed25519YaoRecovery.kind) {
          case 'capability':
            recoveredEd25519Signer = await this.deps
              .getContext()
              .signingEngine.activateEmailOtpEd25519CustodyCapabilityInternal({
                walletSession: args.walletSession,
                providerSubject: args.providerIdentity.providerSubjectId,
                emailHashHex,
                signerSlot: ed25519Selection.signerSlot,
                expectedOperationalPublicKey: ed25519Selection.operationalPublicKey,
                expectedThresholdSessionId: ed25519Selection.thresholdSessionId,
                bootstrap: result.ed25519YaoRecovery.bootstrap,
                activeClientHandle: result.ed25519YaoRecovery.activeClientHandle,
                metadata: result.ed25519YaoRecovery.metadata,
                authority: exactEmailOtpAuthorityRefFromLoginResult(result),
              });
            break;
          case 'cache_absent':
            throw new Error(
              'Email OTP wallet custody material is unavailable; recover with a recovery code',
            );
          case 'not_requested':
            throw new Error('Email OTP capability unlock omitted Ed25519 Yao session material');
          default:
            throw new Error('Email OTP capability unlock returned an invalid Ed25519 Yao state');
        }
        walletActivation = {
          kind: 'near_ed25519_wallet',
          signer: recoveredEd25519Signer,
          walletAuthMethodId: requireWalletAuthMethodId(args.walletAuthMethodId),
        };
      } else {
        if (result.ed25519YaoRecovery.kind !== 'not_requested') {
          throw new Error(
            'EVM-family ECDSA Email OTP unlock returned unexpected Ed25519 Yao material',
          );
        }
        walletActivation = {
          kind: 'evm_family_ecdsa_wallet',
          walletId,
          walletAuthMethodId: requireWalletAuthMethodId(args.walletAuthMethodId),
        };
      }
      const workerUnlockMs = nowMs() - timingStartedAtMs;
      recordEmailOtpUnlockElapsedTiming(
        unlockTiming.timings,
        'workerUnlockAndSessionBootstrapMs',
        workerUnlockMs,
      );
      recordEmailOtpUnlockElapsedTiming(
        unlockTiming.timings,
        'emailOtpProofVerificationMs',
        result.timings.emailOtpProofVerificationMs,
      );
      recordEmailOtpUnlockElapsedTiming(
        unlockTiming.timings,
        'ecdsaMaterialRestoreMs',
        result.timings.ecdsaMaterialRestoreMs,
      );
      recordEmailOtpUnlockElapsedTiming(
        unlockTiming.timings,
        'signingSessionSealApplyMs',
        result.timings.signingSessionSealApplyMs,
      );
      recordEmailOtpUnlockElapsedTiming(
        unlockTiming.timings,
        'warmCapabilityPersistenceMs',
        result.timings.warmCapabilityPersistenceMs,
      );
      timingStartedAtMs = nowMs();
      await activateEmailOtpWalletAfterUnlock(
        {
          signingEngine: this.deps.getContext().signingEngine,
          nearClient: this.deps.getContext().nearClient,
        },
        walletActivation,
      );
      recordEmailOtpUnlockTiming(
        unlockTiming.timings,
        'walletStateActivationMs',
        timingStartedAtMs,
      );
      timingStartedAtMs = nowMs();
      const ownerAuthority = await walletAuthAuthorityRefForVerifiedEmailOtpUnlock({
        walletId: String(walletId),
        walletAuthMethodId: String(args.walletAuthMethodId),
        providerSubject: args.providerIdentity.providerSubjectId,
        emailHashHex,
        projection: result.recovery.verifiedAuthorityProjection,
      });
      const runtimeInventory = await assertWalletRuntimePostconditions({
        source: 'wallet_unlock',
        walletId,
        ownerScope: {
          auth: {
            kind: 'email_otp',
            providerSubjectId: args.providerIdentity.providerSubjectId,
          },
          ownerAuthority: {
            walletAuthMethodId: ownerAuthority.walletAuthMethodId,
            authorityDigest: ownerAuthority.authorityDigest,
          },
        },
        requiredTargets: [
          ...(ed25519Selection ? [{ curve: 'ed25519' as const }] : []),
          ...(args.publicationChainTargets ?? [chainTarget]).map(ecdsaPostconditionTarget),
        ],
        readOwnerScopedSigningLanes: this.readOwnerScopedSigningLanes.bind(this),
      });
      logEmailOtpUnlockActivationPlan(
        buildEmailOtpEcdsaUnlockActivationPlan({
          walletSession: args.walletSession,
          result,
          runtimeInventory,
        }),
      );
      const activeRuntimeConstructionMs = nowMs() - timingStartedAtMs;
      recordEmailOtpUnlockElapsedTiming(
        unlockTiming.timings,
        'runtimePostconditionMs',
        activeRuntimeConstructionMs,
      );
      recordEmailOtpUnlockElapsedTiming(
        unlockTiming.timings,
        'activeRuntimeConstructionMs',
        activeRuntimeConstructionMs,
      );
      logEmailOtpUnlockTimingSummary({
        status: 'succeeded',
        mode: 'evm_family_ecdsa',
        walletId,
        chainTarget,
        startedAtMs: unlockTiming.startedAtMs,
        timings: unlockTiming.timings,
      });
      emitIfWorkerProgressMissing({
        flowId,
        walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_03_EMAIL_OTP_VERIFY_SUCCEEDED,
        status: 'succeeded',
        interaction: { kind: 'otp_input', overlay: 'hide' },
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
      });
      emitIfWorkerProgressMissing({
        flowId,
        walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_05_ECDSA_SIGNING_SESSION_READY,
        status: 'succeeded',
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
        data: { chainTarget },
      });
      emitIfWorkerProgressMissing({
        flowId,
        walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_07_COMPLETED,
        status: 'succeeded',
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
      });
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      logEmailOtpUnlockTimingSummary({
        status: 'failed',
        mode: 'evm_family_ecdsa',
        walletId,
        chainTarget,
        startedAtMs: unlockTiming.startedAtMs,
        timings: unlockTiming.timings,
        error: e,
      });
      emitEmailOtpUnlockFailure(args.onEvent, {
        flowId,
        walletId,
        authMethod: 'email_otp',
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
        error: e,
      });
      throw e;
    }
  }

  async loginWithLinkedEmailOtpWalletDomain(args: {
    walletId: string;
    walletAuthMethodId: string;
    email: string;
    providerSubjectId: string;
    challengeId: string;
    otpCode: string;
    relayUrl: string;
  }): Promise<void> {
    const emailHashHex = await this.emailOtpEmailHashHex(args.email);
    await unlockLinkedDeviceEmailOtpWallet({
      context: this.deps.getContext(),
      walletIdInput: args.walletId,
      emailHashHex,
      walletAuthMethodId: args.walletAuthMethodId,
      providerSubjectId: args.providerSubjectId,
      challengeId: args.challengeId,
      otpCode: args.otpCode,
      relayUrl: args.relayUrl,
    });
    this.deps.resumePendingAcknowledgements();
  }

  async startGoogleSignInDomain(
    args: Parameters<AuthCapability['startGoogleSignIn']>[0],
  ): ReturnType<AuthCapability['startGoogleSignIn']> {
    return await startGoogleSignIn(
      {
        configs: this.deps.getContext().configs,
        resolveGoogleEmailOtpProvider: this.resolveGoogleEmailOtpProviderDomain.bind(this),
        requestEmailOtpChallenge: this.requestEmailOtpChallengeDomain.bind(this),
        prewarmEmailOtpYao: this.prewarmEmailOtpYaoDomain.bind(this),
        registerWallet: this.deps.registerWallet,
        loginWithEmailOtpEcdsaCapability: this.loginWithEmailOtpEcdsaCapabilityDomain.bind(this),
        loginWithEmailOtpEd25519YaoCapability:
          this.loginWithEmailOtpEd25519YaoCapabilityDomain.bind(this),
        resolveLinkedEmailOtpWalletAuth: this.resolveLinkedEmailOtpWalletAuthDomain.bind(this),
        loginWithLinkedEmailOtpWallet: this.loginWithLinkedEmailOtpWalletDomain.bind(this),
        getWalletSession: this.getGoogleEmailOtpWalletSessionDomain.bind(this),
      },
      args,
    );
  }

  async requestEmailOtpEnrollmentChallengeDomain(args: {
    walletId: string;
    relayUrl?: string;
    onEvent?: (event: RegistrationFlowEvent) => void;
  }): Promise<EmailOtpChallengeResult> {
    const flowId = emailOtpRegistrationFlowId(args.walletId);
    emitEmailOtpRegistrationEvent(args.onEvent, {
      flowId,
      walletId: args.walletId,
      authMethod: 'email_otp',
      phase: RegistrationEventPhase.STEP_04_OTP_CHALLENGE_STARTED,
      status: 'running',
    });
    try {
      const result = await requestEmailOtpEnrollmentChallenge({
        relayUrl: String(
          args.relayUrl || this.deps.getContext().configs.network.relayer.url || '',
        ).trim(),
        walletId: String(args.walletId || '').trim(),
      });
      emitEmailOtpRegistrationEvent(args.onEvent, {
        flowId: emailOtpRegistrationFlowId(args.walletId, result.challengeId),
        walletId: args.walletId,
        authMethod: 'email_otp',
        phase: RegistrationEventPhase.STEP_04_OTP_CHALLENGE_SENT,
        status: 'succeeded',
        data: { challengeId: result.challengeId, otpChannel: result.otpChannel },
      });
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      emitEmailOtpRegistrationFailure(args.onEvent, {
        flowId,
        walletId: args.walletId,
        authMethod: 'email_otp',
        error: e,
      });
      throw e;
    }
  }

  async enrollEmailOtpDomain(args: {
    walletId: string;
    otpCode: string;
    relayUrl?: string;
    challengeId?: string;
    groupId?: string;
    clientSecret32?: Uint8Array;
    onEvent?: (event: RegistrationFlowEvent) => void;
  }): Promise<EnrollEmailOtpInternalResult> {
    const flowId = emailOtpRegistrationFlowId(args.walletId, args.challengeId);
    emitEmailOtpRegistrationEvent(args.onEvent, {
      flowId,
      walletId: args.walletId,
      authMethod: 'email_otp',
      phase: RegistrationEventPhase.STEP_04_OTP_VERIFY_STARTED,
      status: 'running',
      interaction: { kind: 'otp_input', overlay: 'none' },
      ...(args.challengeId ? { requestId: args.challengeId } : {}),
    });
    try {
      const result = await this.deps.getContext().signingEngine.enrollEmailOtpInternal({
        walletId: toWalletId(args.walletId),
        otpCode: args.otpCode,
        ...(args.relayUrl ? { relayUrl: args.relayUrl } : {}),
        challengeId: args.challengeId,
        ...(args.groupId ? { groupId: args.groupId } : {}),
        ...(args.clientSecret32 ? { clientSecret32: args.clientSecret32 } : {}),
      });
      emitEmailOtpRegistrationEvent(args.onEvent, {
        flowId,
        walletId: args.walletId,
        authMethod: 'email_otp',
        phase: RegistrationEventPhase.STEP_04_OTP_VERIFY_SUCCEEDED,
        status: 'succeeded',
        interaction: { kind: 'otp_input', overlay: 'hide' },
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
        data: {
          otpChannel: result.otpChannel,
          enrollmentSealKeyVersion: result.enrollmentSealKeyVersion,
        },
      });
      emitEmailOtpRegistrationEvent(args.onEvent, {
        flowId,
        walletId: args.walletId,
        authMethod: 'email_otp',
        phase: RegistrationEventPhase.STEP_09_EMAIL_OTP_SIGNER_ENROLL_STARTED,
        status: 'running',
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
      });
      emitEmailOtpRegistrationEvent(args.onEvent, {
        flowId,
        walletId: args.walletId,
        authMethod: 'email_otp',
        phase: RegistrationEventPhase.STEP_09_EMAIL_OTP_SIGNER_ENROLL_SUCCEEDED,
        status: 'succeeded',
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
        data: { unlockKeyVersion: result.unlockKeyVersion },
      });
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      emitEmailOtpRegistrationFailure(args.onEvent, {
        flowId,
        walletId: args.walletId,
        authMethod: 'email_otp',
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
        error: e,
      });
      throw e;
    }
  }

  private async resolveGoogleEmailOtpProviderDomain(
    args: Parameters<GoogleEmailOtpWalletAuthDeps['resolveGoogleEmailOtpProvider']>[0],
  ): ReturnType<GoogleEmailOtpWalletAuthDeps['resolveGoogleEmailOtpProvider']> {
    return await resolveGoogleEmailOtpProvider({
      relayUrl: String(
        args.relayUrl || this.deps.getContext().configs.network.relayer.url || '',
      ).trim(),
      idToken: args.idToken,
      accountMode: args.accountMode,
      ...(args.loginWalletId ? { loginWalletId: args.loginWalletId } : {}),
      projectEnvironmentId: this.deps.getContext().configs.registration.projectEnvironmentId,
      publishableKey: this.deps.getContext().configs.registration.publishableKey,
      ...(args.restartRegistrationOffer === true ? { restartRegistrationOffer: true } : {}),
    });
  }

  private async resolveLinkedEmailOtpWalletAuthDomain(args: {
    walletId: string;
    email: string;
    provider: 'google' | 'email';
    providerSubjectId: string;
  }): Promise<GoogleEmailOtpLinkedUnlockSelection> {
    const emailHashHex = await this.emailOtpEmailHashHex(args.email);
    const resolution = await resolveLinkedDeviceEmailOtpAuthoritySelection({
      walletIdInput: args.walletId,
      emailHashHex,
      provider: args.provider,
      providerSubjectId: args.providerSubjectId,
    });
    switch (resolution.kind) {
      case 'none': {
        const localMethods = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(args.walletId);
        const foundingMethods: ActiveEmailOtpWalletAuthMethodRecordV2[] = [];
        for (const method of localMethods) {
          if (
            method.kind === 'email_otp' &&
            method.status === 'active' &&
            method.emailHashHex.toLowerCase() === emailHashHex
          ) {
            foundingMethods.push(method);
          }
        }
        const foundingMethod = foundingMethods[0];
        if (foundingMethods.length === 0 || !foundingMethod) {
          const localFactors = await IndexedDBManager.listWalletAuthMethodsForWallet(args.walletId);
          const exactLocalFactors: typeof localFactors = [];
          for (const method of localFactors) {
            if (
              method.kind === 'email_otp' &&
              method.status === 'active' &&
              method.emailHashHex.toLowerCase() === emailHashHex &&
              isEmailOtpWalletAuthAuthority(method.authority) &&
              method.authority.factor.provider === 'google' &&
              method.authority.factor.providerUserId === args.providerSubjectId
            ) {
              exactLocalFactors.push(method);
            }
          }
          const exactLocalFactor = exactLocalFactors[0];
          if (exactLocalFactors.length === 0 || !exactLocalFactor) return { kind: 'none' };
          if (exactLocalFactors.length !== 1) {
            return {
              kind: 'rejected',
              message: 'Multiple active local Email OTP factors match the verified email',
            };
          }
          const exactAuthority = exactLocalFactor.authority;
          if (!exactAuthority || !isEmailOtpWalletAuthAuthority(exactAuthority)) {
            return { kind: 'none' };
          }
          return {
            kind: 'selected',
            walletAuthMethodId: String(exactAuthority.bindingId),
            execution: 'ordinary',
          };
        }
        if (foundingMethods.length !== 1) {
          return {
            kind: 'rejected',
            message: 'Multiple active local Email OTP authorities match the verified email',
          };
        }
        const authority = await IndexedDBManager.getWalletAuthority(
          String(foundingMethod.walletAuthorityId),
        );
        if (
          !authority ||
          authority.state !== 'active' ||
          authority.walletId !== foundingMethod.walletId ||
          authority.authorityId !== foundingMethod.walletAuthorityId ||
          /* Recovery installs an additive full-owner authority, so an Email
                   OTP sibling added to it unlocks exactly like one on the founding
                   authority. Linked-device authorities resolve through the linked
                   selection above instead. */
          (authority.provenance.kind !== 'wallet_registration' &&
            authority.provenance.kind !== 'wallet_recovery')
        ) {
          return { kind: 'none' };
        }
        await resolveExactLinkedEmailOtpAuthority({
          authMethod: foundingMethod,
          provider: 'google',
          providerSubjectId: args.providerSubjectId,
        });
        return {
          kind: 'selected',
          walletAuthMethodId: String(foundingMethod.walletAuthMethodId),
          execution: await googleEmailOtpUnlockExecution(
            authority.provenance,
            foundingMethod.walletAuthMethodId,
          ),
          keyFamilies: authority.signerActivations.keyFamilies,
        };
      }
      case 'selected':
        return {
          kind: 'selected',
          walletAuthMethodId: String(resolution.selection.authMethod.walletAuthMethodId),
          execution: await googleEmailOtpUnlockExecution(
            resolution.selection.authority.provenance,
            resolution.selection.authMethod.walletAuthMethodId,
          ),
          keyFamilies: resolution.selection.authority.signerActivations.keyFamilies,
        };
      case 'rejected':
        return { kind: 'rejected', message: resolution.message };
      default:
        resolution satisfies never;
        throw new Error('Linked Email OTP authority resolution is invalid');
    }
  }

  private async prewarmEmailOtpYaoDomain(): Promise<void> {
    await this.deps.getContext().signingEngine.prewarmEmailOtpYao();
  }

  private async getGoogleEmailOtpWalletSessionDomain(
    walletId: string,
  ): ReturnType<GoogleEmailOtpWalletAuthDeps['getWalletSession']> {
    return await this.deps.getWalletSession(walletId);
  }

  private async loginWithEmailOtpEd25519YaoCapabilityDomain(
    args: EmailOtpWalletCustodyEd25519LoginDomainArgs,
  ): Promise<void> {
    if (args.authoritySelector.kind !== 'wallet_auth_method') {
      throw new Error('Email OTP Ed25519 unlock requires an exact wallet auth method');
    }
    const emailHashHex = await this.emailOtpEmailHashHex(args.emailOtpAuthorityEmail);
    const signer = await this.deps
      .getContext()
      .signingEngine.loginWithEmailOtpWalletCustodyEd25519Internal({
        ...args,
        emailHashHex,
      });
    await activateEmailOtpWalletAfterUnlock(
      {
        signingEngine: this.deps.getContext().signingEngine,
        nearClient: this.deps.getContext().nearClient,
      },
      {
        kind: 'near_ed25519_wallet',
        signer,
        walletAuthMethodId: requireWalletAuthMethodId(args.authoritySelector.walletAuthMethodId),
      },
    );
  }

  private async emailOtpEmailHashHex(email: string): Promise<string> {
    const normalizedEmail = String(email || '')
      .trim()
      .toLowerCase();
    if (!normalizedEmail) {
      throw new Error('[SeamsWeb][email-otp] verified email is required for auth-method hash');
    }
    return sha256HexUtf8(normalizedEmail);
  }
}

function authorizationSessionId(authorization: ExactWalletSessionAuthorization) {
  return authorization.operationCredential.walletSessionId;
}

function recordWorkerProgress(
  phases: Set<UnlockEventPhase>,
  onEvent: ((event: UnlockFlowEvent) => void) | undefined,
  metadata: Omit<Parameters<typeof emitEmailOtpUnlockWorkerProgress>[1], 'progress'>,
  progress: EmailOtpWorkerProgressEvent,
): void {
  const phase = emitEmailOtpUnlockWorkerProgress(onEvent, {
    flowId: metadata.flowId,
    walletId: metadata.walletId,
    challengeId: metadata.challengeId,
    chainTarget: metadata.chainTarget,
    progress,
  });
  if (phase) phases.add(phase);
}

function emitMissingWorkerProgress(
  phases: Set<UnlockEventPhase>,
  onEvent: ((event: UnlockFlowEvent) => void) | undefined,
  input: CreateUnlockFlowEventInput,
): void {
  if (!phases.has(input.phase)) emitEmailOtpUnlockEvent(onEvent, input);
}
