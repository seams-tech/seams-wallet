import type { RegistrationFlowEvent, UnlockFlowEvent } from '@/core/types/sdkSentEvents';
import { RegistrationEventPhase, UnlockEventPhase } from '@/core/types/sdkSentEvents';
import { toError } from '@shared/utils/errors';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletEmailOtpLoginOperation } from '@shared/utils/emailOtpDomain';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import type {
  AuthCapability,
  EmailOtpChallengeResult,
  EmailOtpOperationChallengeResult,
  EmailOtpEcdsaCapabilityResult,
} from '@/SeamsWeb/signingSurface/types';
import type { EnrollEmailOtpInternalResult } from '@/core/signingEngine/flows/signEvmFamily/emailOtpPublic';
import {
  type ThresholdEcdsaChainTarget,
  type WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { EmailOtpCommandGroups } from '@/SeamsWeb/publicApi/auth';
import {
  type InternalEmailOtpEcdsaCapabilityArgs,
  nowMs,
  createEmailOtpUnlockTimings,
  recordEmailOtpUnlockElapsedTiming,
  logEmailOtpUnlockTimingSummary,
  requireConcreteEcdsaChainTarget,
  emailOtpRegistrationFlowId,
  emailOtpUnlockFlowId,
  emitEmailOtpRegistrationEvent,
  emitEmailOtpUnlockEvent,
  emitEmailOtpRegistrationFailure,
  emitEmailOtpUnlockFailure,
} from '@/SeamsWeb/walletIframe/shared/emailOtpLifecycle';

type EmailOtpIframe = Pick<WalletIframeCoordinator, 'requireRouter'>;

export function createApplicationEmailOtpCommands(
  walletIframe: EmailOtpIframe,
): EmailOtpCommandGroups {
  const commands = new ApplicationEmailOtpCommands(walletIframe);
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

class ApplicationEmailOtpCommands {
  constructor(private readonly walletIframe: EmailOtpIframe) {}
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
      const router = await this.walletIframe.requireRouter();
      const result = await router.requestEmailOtpChallenge(args);
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
      const router = await this.walletIframe.requireRouter();
      const result = await router.requestEmailOtpSigningSessionChallenge({
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
      const result = await (
        await this.walletIframe.requireRouter()
      ).refreshEmailOtpSigningSession({
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
      const router = await this.walletIframe.requireRouter();
      const iframeArgs = { ...args, chainTarget };
      delete iframeArgs.onEvent;
      const iframeStartedAtMs = nowMs();
      const result = await router.loginWithEmailOtpEcdsaCapability(iframeArgs);
      const walletIframeRoundTripMs = nowMs() - iframeStartedAtMs;
      recordEmailOtpUnlockElapsedTiming(
        unlockTiming.timings,
        'walletIframeRoundTripMs',
        walletIframeRoundTripMs,
      );
      logEmailOtpUnlockTimingSummary({
        status: 'succeeded',
        mode: 'evm_family_ecdsa',
        walletId,
        chainTarget,
        startedAtMs: unlockTiming.startedAtMs,
        timings: unlockTiming.timings,
      });
      emitEmailOtpUnlockEvent(args.onEvent, {
        flowId,
        walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_03_EMAIL_OTP_VERIFY_SUCCEEDED,
        status: 'succeeded',
        interaction: { kind: 'otp_input', overlay: 'hide' },
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
      });
      emitEmailOtpUnlockEvent(args.onEvent, {
        flowId,
        walletId,
        authMethod: 'email_otp',
        phase: UnlockEventPhase.STEP_05_ECDSA_SIGNING_SESSION_READY,
        status: 'succeeded',
        ...(args.challengeId ? { requestId: args.challengeId } : {}),
        data: { chainTarget },
      });
      emitEmailOtpUnlockEvent(args.onEvent, {
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
    const router = await this.walletIframe.requireRouter();
    await router.unlockAddedEmailOtpWallet({
      walletId: args.walletId,
      walletAuthMethodId: args.walletAuthMethodId,
      email: args.email,
      providerSubjectId: args.providerSubjectId,
      challengeId: args.challengeId,
      otpCode: args.otpCode,
      relayUrl: args.relayUrl,
    });

    return;
  }

  async startGoogleSignInDomain(
    args: Parameters<AuthCapability['startGoogleSignIn']>[0],
  ): ReturnType<AuthCapability['startGoogleSignIn']> {
    const router = await this.walletIframe.requireRouter();
    return await router.startGoogleSignIn(args);
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
      const router = await this.walletIframe.requireRouter();
      const result = await router.requestEmailOtpEnrollmentChallenge(args);
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
      if (args.clientSecret32) {
        throw new Error(
          '[SeamsWeb] Wallet iframe Email OTP enrollment owns client secret generation; clientSecret32 is not accepted from the app origin.',
        );
      }
      const router = await this.walletIframe.requireRouter();
      const iframeArgs = { ...args };
      delete iframeArgs.clientSecret32;
      delete iframeArgs.onEvent;
      const result = await router.enrollEmailOtp(iframeArgs);
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
}
