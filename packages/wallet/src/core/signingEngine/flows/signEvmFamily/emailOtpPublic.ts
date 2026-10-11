import {
  prepareEmailOtpRegistrationEnrollmentMaterial,
} from '../../session/emailOtp/workerEnrollment';
import type { EmailOtpAuthPolicy } from '@/core/types/seams';
import type { WorkerOperationContext } from '../../workerManager/executeWorkerOperation';
import type {
  WalletEmailOtpChannel,
  WalletEmailOtpLoginOperation,
} from '@shared/utils/emailOtpDomain';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  ThresholdEcdsaChainTarget,
  WalletId,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { ThresholdRuntimePolicyScope } from '../../threshold/sessionPolicy';
import type {
  EmailOtpAuthoritySelector,
  EmailOtpWorkerProgressEvent,
} from '../../workerManager/workerTypes';
import type { EmailOtpEcdsaBootstrapAuthorization } from '../../session/emailOtp/routePlan';
import type {
  EmailOtpEcdsaProviderIdentity,
  EmailOtpThresholdEcdsaLoginResult,
  LoginEmailOtpEcdsaCapabilityArgs,
} from '../../session/emailOtp/ecdsaLogin';
import { type EmailOtpRoutePlan } from '../../stepUpConfirmation/otpPrompt/authLane';
import { buildFreshEmailOtpRoutePlan } from '../../session/emailOtp/routePlan';

export type LoginWithEmailOtpEcdsaCapabilityInternalArgs = {
  walletSession: WalletSessionRef;
  authoritySelector: EmailOtpAuthoritySelector;
  subjectId?: never;
  chainTarget: ThresholdEcdsaChainTarget;
  emailOtpAuthPolicy?: EmailOtpAuthPolicy;
  emailOtpAuthReason?: 'login' | 'sign';
  relayUrl?: string;
  challengeId?: string;
  otpCode: string;
  operation?: WalletEmailOtpLoginOperation;
  groupId?: string;
  keyHandle?: string;
  participantIds?: number[];
  publicationChainTargets?: readonly ThresholdEcdsaChainTarget[];
  ttlMs?: number;
  remainingUses?: number;
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
  ecdsaBootstrapAuthorization: EmailOtpEcdsaBootstrapAuthorization;
  providerIdentity: EmailOtpEcdsaProviderIdentity;
  emailHashHex: string;
  authSubjectId?: never;
  onProgress?: (progress: EmailOtpWorkerProgressEvent) => void;
  ed25519YaoRecovery?: LoginEmailOtpEcdsaCapabilityArgs['ed25519YaoRecovery'];
};

export type LoginWithEmailOtpEcdsaCapabilityInternalResult = EmailOtpThresholdEcdsaLoginResult;

type PrepareEmailOtpRegistrationEnrollmentMaterialInternalArgsBase = {
  walletId: WalletId;
  userId: string;
  relayUrl?: string;
  groupId?: string;
  otpChannel?: WalletEmailOtpChannel;
  clientSecret32?: Uint8Array;
};

export type PrepareEmailOtpRegistrationEnrollmentMaterialInternalArgs =
  PrepareEmailOtpRegistrationEnrollmentMaterialInternalArgsBase;

export type PrepareEmailOtpRegistrationEnrollmentMaterialInternalResult = Awaited<
  ReturnType<typeof prepareEmailOtpRegistrationEnrollmentMaterial>
>;

export type EmailOtpPublicDeps = {
  relayerUrl: string;
  groupId: string;
  getSignerWorkerContext: () => WorkerOperationContext;
  emailOtpSessions: {
    loginWithEcdsaCapabilityInternal: (
      args: LoginEmailOtpEcdsaCapabilityArgs,
    ) => Promise<LoginWithEmailOtpEcdsaCapabilityInternalResult>;
  };
};

function buildEmailOtpEcdsaFreshRoutePlanFromBoundary(
  args: {
    chainTarget: ThresholdEcdsaChainTarget;
    operation?: WalletEmailOtpLoginOperation;
  },
  freshRouteFamily: 'login' | 'registration',
): EmailOtpRoutePlan {
  return buildFreshEmailOtpRoutePlan({
    freshRouteFamily,
    operation: args.operation,
  });
}

function emailOtpEcdsaLoginCoreArgsFromBoundary(
  args: LoginWithEmailOtpEcdsaCapabilityInternalArgs,
): LoginEmailOtpEcdsaCapabilityArgs {
  return {
    walletSession: args.walletSession,
    authoritySelector: args.authoritySelector,
    chainTarget: args.chainTarget,
    otpCode: args.otpCode,
    routePlan: buildEmailOtpEcdsaFreshRoutePlanFromBoundary(args, 'login'),
    ecdsaBootstrapAuthorization: args.ecdsaBootstrapAuthorization,
    emailHashHex: args.emailHashHex,
    providerIdentity: args.providerIdentity,
    ed25519YaoRecovery: args.ed25519YaoRecovery ?? { kind: 'not_requested' },
    ...(args.emailOtpAuthPolicy ? { emailOtpAuthPolicy: args.emailOtpAuthPolicy } : {}),
    ...(args.emailOtpAuthReason ? { emailOtpAuthReason: args.emailOtpAuthReason } : {}),
    ...(args.relayUrl ? { relayUrl: args.relayUrl } : {}),
    ...(args.challengeId ? { challengeId: args.challengeId } : {}),
    ...(args.operation ? { operation: args.operation } : {}),
    ...(args.groupId ? { groupId: args.groupId } : {}),
    ...(args.keyHandle ? { keyHandle: args.keyHandle } : {}),
    ...(args.participantIds ? { participantIds: args.participantIds } : {}),
    ...(args.publicationChainTargets
      ? { publicationChainTargets: args.publicationChainTargets }
      : {}),
    ...(typeof args.ttlMs === 'number' ? { ttlMs: args.ttlMs } : {}),
    ...(typeof args.remainingUses === 'number' ? { remainingUses: args.remainingUses } : {}),
    ...(args.runtimePolicyScope ? { runtimePolicyScope: args.runtimePolicyScope } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  };
}

export async function loginWithEmailOtpEcdsaCapabilityInternal(
  deps: EmailOtpPublicDeps,
  args: LoginWithEmailOtpEcdsaCapabilityInternalArgs,
): Promise<LoginWithEmailOtpEcdsaCapabilityInternalResult> {
  return await deps.emailOtpSessions.loginWithEcdsaCapabilityInternal(
    emailOtpEcdsaLoginCoreArgsFromBoundary(args),
  );
}

export async function prepareEmailOtpRegistrationEnrollmentMaterialInternal(
  deps: EmailOtpPublicDeps,
  args: PrepareEmailOtpRegistrationEnrollmentMaterialInternalArgs,
): Promise<PrepareEmailOtpRegistrationEnrollmentMaterialInternalResult> {
  const walletId = toWalletId(args.walletId);
  const relayUrl = String(args.relayUrl || deps.relayerUrl || '').trim();
  if (!relayUrl) {
    throw new Error('Missing relayer url (configs.network.relayer.url)');
  }
  const groupId = String(args.groupId || deps.groupId || '').trim();
  if (!groupId) {
    throw new Error('Missing shamir prime for Email OTP runtime');
  }
  const userId = String(args.userId).trim();
  if (!userId) {
    throw new Error('Email OTP registration enrollment material requires userId');
  }
  return await prepareEmailOtpRegistrationEnrollmentMaterial({
    relayUrl,
    walletId: String(walletId),
    userId,
    groupId,
    workerCtx: deps.getSignerWorkerContext(),
    otpChannel: args.otpChannel,
    ecdsaSessionHandle: { kind: 'not_requested' },
    ...(args.clientSecret32 ? { clientSecret32: args.clientSecret32 } : {}),
  });
}
