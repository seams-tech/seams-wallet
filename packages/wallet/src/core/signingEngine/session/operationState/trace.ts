import type { SelectedSigningSessionPlanningLane, SigningLaneSummary } from './types';
import { parseEcdsaServerTiming } from '@shared/utils/ecdsaServerTiming';
import { summarizeSigningLane } from './types';
import type { SigningPlannerDecisionTraceEvent } from '../planning/planner';

export type SigningSessionTraceScope = 'evm-family' | 'near';

export function emitEcdsaServerTiming(
  operationId: string,
  phase: 'prepare' | 'finalize',
  header: string | null,
): void {
  if (!header || !isSigningSessionTraceEnabled()) return;
  for (const [stage, durationMs] of parseEcdsaServerTiming(header)) {
    emitSigningSessionFlowTrace('evm-family', {
      event: 'ecdsa_server_timing',
      operationId,
      phase,
      stage,
      durationMs,
    });
  }
}

export function emitEcdsaPresignServerTiming(
  presignSessionId: string,
  phase: 'init' | 'step',
  header: string | null,
): void {
  if (!header || !isSigningSessionTraceEnabled()) return;
  for (const [stage, durationMs] of parseEcdsaServerTiming(header)) {
    emitSigningSessionFlowTrace('evm-family', {
      event: 'ecdsa_presign_server_timing',
      presignSessionId,
      phase,
      stage,
      durationMs,
    });
  }
}

export type EcdsaSigningTimingStage =
  | 'material_queue'
  | 'material_authorization'
  | 'material_load'
  | 'public_key_validation'
  | 'pool_lookup'
  | 'pool_restore'
  | 'refill_wait'
  | 'foreground_refill'
  | 'presignature_reserve'
  | 'prepare'
  | 'presignature_commit'
  | 'client_share'
  | 'finalize'
  | 'signature_verify'
  | 'sign_total'
  | 'transaction_assembly'
  | 'commit_total';

export function emitEcdsaSigningTiming(
  operationId: string,
  stage: EcdsaSigningTimingStage,
  startedAt: number,
  outcome: 'succeeded' | 'failed' = 'succeeded',
): void {
  emitSigningSessionFlowTrace('evm-family', {
    event: 'ecdsa_signing_timing',
    operationId,
    stage,
    durationMs: Math.max(0, performance.now() - startedAt),
    outcome,
  });
}

export type Ed25519SigningTimingStage =
  | 'confirmed_to_signed'
  | 'prepare'
  | 'client_share'
  | 'finalize'
  | 'signature_total';

export function emitEd25519SigningTiming(
  operationId: string,
  stage: Ed25519SigningTimingStage,
  startedAt: number,
  outcome: 'succeeded' | 'failed' = 'succeeded',
): void {
  emitSigningSessionFlowTrace('near', {
    event: 'ed25519_signing_timing',
    operationId,
    stage,
    durationMs: Math.max(0, performance.now() - startedAt),
    outcome,
  });
}

export type SigningLaneResolutionTraceEvent = {
  event: 'signing_lane_resolved';
  lane: SigningLaneSummary;
  reason?: string;
};

export type SigningBoundaryTraceEvent = {
  event: 'pre_confirm_readiness_checked' | 'auth_side_effect_started';
  lane?: SigningLaneSummary;
  readinessStatus?: string;
  sideEffect?:
    | 'auth_prompt_shown'
    | 'email_otp_challenge'
    | 'passkey_reauth'
    | 'auth_confirmed'
    | 'threshold_reconnect';
  phase: 'pre_confirm' | 'confirmed';
};

export function emitSigningLaneResolutionTrace(
  scope: SigningSessionTraceScope,
  lane: SelectedSigningSessionPlanningLane | null | undefined,
  args: { reason?: string } = {},
): void {
  if (!lane || !isSigningSessionTraceEnabled()) return;

  try {
    console.debug(`[SigningLane][${scope}]`, {
      event: 'signing_lane_resolved',
      lane: summarizeSigningLane(lane),
      ...(args.reason ? { reason: args.reason } : {}),
    } satisfies SigningLaneResolutionTraceEvent);
  } catch {}
}

export function emitSigningBoundaryTrace(
  scope: SigningSessionTraceScope,
  event: SigningBoundaryTraceEvent,
): void {
  if (!isSigningSessionTraceEnabled()) return;

  try {
    console.debug(`[SigningBoundary][${scope}]`, event);
  } catch {}
}

export function createSigningBoundaryTraceEvent(args: {
  event: SigningBoundaryTraceEvent['event'];
  lane?: SelectedSigningSessionPlanningLane | null;
  readinessStatus?: string;
  sideEffect?: SigningBoundaryTraceEvent['sideEffect'];
  phase: SigningBoundaryTraceEvent['phase'];
}): SigningBoundaryTraceEvent {
  return {
    event: args.event,
    ...(args.lane ? { lane: summarizeSigningLane(args.lane) } : {}),
    ...(args.readinessStatus ? { readinessStatus: args.readinessStatus } : {}),
    ...(args.sideEffect ? { sideEffect: args.sideEffect } : {}),
    phase: args.phase,
  };
}

export function emitSigningPlannerDecisionTrace(
  scope: SigningSessionTraceScope,
  event: SigningPlannerDecisionTraceEvent,
): void {
  if (!isSigningSessionTraceEnabled()) return;

  try {
    console.debug(`[SigningSessionPlanner][${scope}]`, event);
  } catch {}
}

export function emitSigningSessionFlowTrace(
  scope: SigningSessionTraceScope,
  event: Record<string, unknown>,
): void {
  if (!isSigningSessionTraceEnabled()) return;

  try {
    console.info(`[SigningFlow][${scope}]`, JSON.stringify(event));
  } catch {}
}

export function emitSigningSessionFlowFailure(
  scope: SigningSessionTraceScope,
  event: Record<string, unknown>,
): void {
  try {
    console.warn(`[SigningFlow][${scope}][failure]`, event);
  } catch {}
}

export function isSigningSessionTraceEnabled(): boolean {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    return storage?.getItem('seams:debug:signing-session') === '1';
  } catch {
    return false;
  }
}
