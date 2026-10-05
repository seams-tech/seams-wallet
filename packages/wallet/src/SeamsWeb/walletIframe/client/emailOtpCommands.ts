import type { UnlockFlowEvent } from '@/core/types/sdkSentEvents';
import { UnlockEventPhase } from '@/core/types/sdkSentEvents';
import { toError } from '@shared/utils/errors';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletEmailOtpLoginOperation } from '@shared/utils/emailOtpDomain';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import type {
  AuthCapability,
  EmailOtpOperationChallengeResult,
  EmailOtpEcdsaCapabilityResult,
} from '@/SeamsWeb/signingSurface/types';
import type { EmailOtpAuthCommands } from '@/SeamsWeb/publicApi/auth';
import {
  type InternalEmailOtpEcdsaCapabilityArgs,
  nowMs,
  createEmailOtpUnlockTimings,
  recordEmailOtpUnlockElapsedTiming,
  logEmailOtpUnlockTimingSummary,
  requireConcreteEcdsaChainTarget,
  emailOtpUnlockFlowId,
  emitEmailOtpUnlockEvent,
  emitEmailOtpUnlockFailure,
} from '@/SeamsWeb/walletIframe/shared/emailOtpLifecycle';

type EmailOtpIframe = Pick<WalletIframeCoordinator, 'requireRouter'>;

export function createApplicationEmailOtpCommands(
  walletIframe: EmailOtpIframe,
): EmailOtpAuthCommands {
  const commands = new ApplicationEmailOtpCommands(walletIframe);
  return {
    requestEmailCode: commands.requestEmailCodeDomain.bind(commands),
    loginWithEmailOtpEcdsaCapability:
      commands.loginWithEmailOtpEcdsaCapabilityDomain.bind(commands),
    unlockAddedEmailOtpWallet: commands.loginWithLinkedEmailOtpWalletDomain.bind(commands),
    startGoogleSignIn: commands.startGoogleSignInDomain.bind(commands),
  };
}

class ApplicationEmailOtpCommands {
  constructor(private readonly walletIframe: EmailOtpIframe) {}
  async requestEmailCodeDomain(args: {
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
}
