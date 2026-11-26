import type {
  CreateUnlockFlowEventInput,
  UnlockFlowEvent,
} from '@/core/types/sdkSentEvents';
import {
  createUnlockFlowEvent,
  UnlockEventPhase,
} from '@/core/types/sdkSentEvents';
import { isUserCancellationError } from '@shared/utils/errors';
import type { EmailOtpEcdsaCapabilityArgs } from '@/SeamsWeb/signingSurface/types';
import {
  thresholdEcdsaChainTargetFromRequest,
  type ThresholdEcdsaChainTarget,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { isObject } from '@shared/utils/validation';

export type InternalEmailOtpEcdsaCapabilityArgs = EmailOtpEcdsaCapabilityArgs & {
  publicationChainTargets?: readonly ThresholdEcdsaChainTarget[];
};

export type EmailOtpUnlockTimingBucket =
  | 'emailOtpProofVerificationMs'
  | 'walletUnlockExchangeMs'
  | 'ecdsaMaterialRestoreMs'
  | 'signingSessionSealApplyMs'
  | 'warmCapabilityPersistenceMs'
  | 'activeRuntimeConstructionMs'
  | 'emailHashLookupMs'
  | 'workerUnlockAndSessionBootstrapMs'
  | 'walletStateActivationMs'
  | 'runtimePostconditionMs'
  | 'walletIframeRoundTripMs';

type EmailOtpUnlockTimingSummary = {
  kind: 'email_otp_unlock_timing_summary_v1';
  status: 'succeeded' | 'failed';
  mode: 'evm_family_ecdsa';
  walletId: string;
  chainTarget?: ThresholdEcdsaChainTarget;
  totalElapsedMs: number;
  timings: Record<EmailOtpUnlockTimingBucket, number>;
  topBuckets: { bucket: EmailOtpUnlockTimingBucket; durationMs: number }[];
  errorMessage?: string;
};

export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function createEmailOtpUnlockTimings(): Record<EmailOtpUnlockTimingBucket, number> {
  return {
    emailOtpProofVerificationMs: 0,
    walletUnlockExchangeMs: 0,
    ecdsaMaterialRestoreMs: 0,
    signingSessionSealApplyMs: 0,
    warmCapabilityPersistenceMs: 0,
    activeRuntimeConstructionMs: 0,
    emailHashLookupMs: 0,
    workerUnlockAndSessionBootstrapMs: 0,
    walletStateActivationMs: 0,
    runtimePostconditionMs: 0,
    walletIframeRoundTripMs: 0,
  };
}

export function recordEmailOtpUnlockElapsedTiming(
  timings: Record<EmailOtpUnlockTimingBucket, number>,
  bucket: EmailOtpUnlockTimingBucket,
  durationMs: number,
): void {
  addEmailOtpUnlockTiming(timings, bucket, durationMs);
}

export function addEmailOtpUnlockTiming(
  timings: Record<EmailOtpUnlockTimingBucket, number>,
  bucket: EmailOtpUnlockTimingBucket,
  durationMs: number,
): void {
  const deltaMs = Math.max(0, Math.round(durationMs));
  timings[bucket] += deltaMs;
  if (!isEmailOtpUnlockDiagnosticsEnabled()) return;
  console.info('[EmailOtpUnlock] timing', {
    bucket,
    deltaMs,
    accumulatedMs: timings[bucket],
  });
}

export function isEmailOtpUnlockDiagnosticsEnabled(): boolean {
  return Reflect.get(globalThis, '__SEAMS_EMAIL_OTP_UNLOCK_DIAGNOSTICS') === true;
}

export function logEmailOtpUnlockTimingSummary(input: {
  status: EmailOtpUnlockTimingSummary['status'];
  mode: EmailOtpUnlockTimingSummary['mode'];
  walletId: string;
  startedAtMs: number;
  timings: Record<EmailOtpUnlockTimingBucket, number>;
  chainTarget?: ThresholdEcdsaChainTarget;
  error?: unknown;
}): void {
  if (!isEmailOtpUnlockDiagnosticsEnabled()) return;
  const entries = Object.entries(input.timings) as [EmailOtpUnlockTimingBucket, number][];
  const measuredBuckets: EmailOtpUnlockTimingSummary['topBuckets'] = [];
  for (const [bucket, durationMs] of entries) {
    if (durationMs > 0) measuredBuckets.push({ bucket, durationMs });
  }
  measuredBuckets.sort(compareTimingDuration);
  const topBuckets = measuredBuckets.slice(0, 5);
  const errorMessage =
    input.error instanceof Error ? input.error.message : input.error ? String(input.error) : '';
  const summary: EmailOtpUnlockTimingSummary = {
    kind: 'email_otp_unlock_timing_summary_v1',
    status: input.status,
    mode: input.mode,
    walletId: input.walletId,
    ...(input.chainTarget ? { chainTarget: input.chainTarget } : {}),
    totalElapsedMs: Math.max(0, Math.round(nowMs() - input.startedAtMs)),
    timings: input.timings,
    topBuckets,
    ...(errorMessage ? { errorMessage } : {}),
  };
  console.info('[EmailOtpUnlock] timing summary', summary);
}

export function requireConcreteEcdsaChainTarget(
  value: unknown,
  operation: string,
): ThresholdEcdsaChainTarget {
  if (!isObject(value)) {
    throw new Error(`[SeamsWeb] ${operation} requires a concrete ECDSA chainTarget`);
  }
  return thresholdEcdsaChainTargetFromRequest(value);
}

export function emailOtpUnlockFlowId(walletId: string, challengeId?: string): string {
  const accountPart = String(walletId || 'unknown-wallet').trim() || 'unknown-wallet';
  const challengePart = String(challengeId || 'active').trim() || 'active';
  return `email-otp-unlock:${accountPart}:${challengePart}`;
}

export function emitEmailOtpUnlockEvent(
  onEvent: ((event: UnlockFlowEvent) => void) | undefined,
  input: CreateUnlockFlowEventInput,
): void {
  try {
    onEvent?.(createUnlockFlowEvent(input));
  } catch {}
}

export function emitEmailOtpUnlockFailure(
  onEvent: ((event: UnlockFlowEvent) => void) | undefined,
  input: Omit<CreateUnlockFlowEventInput, 'phase' | 'status' | 'error'> & {
    error: Error;
  },
): void {
  const cancelled = isUserCancellationError(input.error);
  emitEmailOtpUnlockEvent(onEvent, {
    ...input,
    phase: cancelled ? UnlockEventPhase.CANCELLED : UnlockEventPhase.FAILED,
    status: cancelled ? 'cancelled' : 'failed',
    interaction: input.interaction ?? {
      kind: cancelled ? 'otp_input' : 'none',
      overlay: 'hide',
    },
    error: { message: input.error.message },
  });
}

function compareTimingDuration(
  left: EmailOtpUnlockTimingSummary['topBuckets'][number],
  right: EmailOtpUnlockTimingSummary['topBuckets'][number],
): number {
  return right.durationMs - left.durationMs;
}
