import type { WalletId } from '../utils/domainIds';
import type { ManagedWalletLaneStatus, ManagedWalletRegion, WalletHomeLane } from './homeLane';
import {
  parseUnixTimestamp,
  requireWalletRegionBoundary,
  type UnixTimestamp,
  type WalletHomeLaneId,
  type WalletRegionMigrationId,
  type WalletRegionPolicyVersion,
} from './ids';

export type WalletHomeRegionPolicy =
  | {
      readonly kind: 'owner_moves_allowed';
      readonly policyVersion: WalletRegionPolicyVersion;
      readonly allowedRegions: readonly [ManagedWalletRegion, ...ManagedWalletRegion[]];
      readonly cooldownMs: number;
      readonly pinnedRegion?: never;
    }
  | {
      readonly kind: 'pinned';
      readonly policyVersion: WalletRegionPolicyVersion;
      readonly allowedRegions: readonly [ManagedWalletRegion];
      readonly cooldownMs: number;
      readonly pinnedRegion: ManagedWalletRegion;
    }
  | {
      readonly kind: 'owner_moves_disabled';
      readonly policyVersion: WalletRegionPolicyVersion;
      readonly allowedRegions: readonly [ManagedWalletRegion, ...ManagedWalletRegion[]];
      readonly cooldownMs: number;
      readonly pinnedRegion?: never;
    };

export type WalletLaneProbeSummary = {
  readonly laneId: WalletHomeLaneId;
  readonly productRegion: ManagedWalletRegion;
  readonly laneStatus: ManagedWalletLaneStatus;
  readonly medianLatencyMs: number;
  readonly sampleCount: number;
  readonly distinctSessionCount: number;
  readonly distinctDayCount: number;
  readonly measuredAt: UnixTimestamp;
};

export type HomeRegionRecommendationPolicy = {
  readonly minimumAbsoluteImprovementMs: number;
  readonly minimumRelativeImprovement: number;
  readonly minimumSampleCount: number;
  readonly minimumDistinctSessionCount: number;
  readonly minimumDistinctDayCount: number;
};

export type HomeRegionRecommendation = {
  readonly sourceLaneId: WalletHomeLaneId;
  readonly targetLaneId: WalletHomeLaneId;
  readonly targetRegion: ManagedWalletRegion;
  readonly sourceMedianLatencyMs: number;
  readonly targetMedianLatencyMs: number;
  readonly estimatedImprovementMs: number;
};

export type WalletHomeRegionMovePolicyDecision =
  | {
      readonly kind: 'allowed';
      readonly nextEligibleMoveAt?: never;
    }
  | {
      readonly kind:
        | 'same_region'
        | 'owner_moves_disabled'
        | 'region_not_allowed'
        | 'region_pinned';
      readonly nextEligibleMoveAt?: never;
    }
  | {
      readonly kind: 'cooldown_active';
      readonly nextEligibleMoveAt: UnixTimestamp;
    };

export type HomeRegionCandidate = {
  readonly laneId: WalletHomeLaneId;
  readonly productRegion: ManagedWalletRegion;
  readonly label: string;
  readonly status: ManagedWalletLaneStatus;
  readonly latency: WalletLaneProbeSummary | null;
};

export type HomeRegionSnapshot = {
  readonly walletId: WalletId;
  readonly current: WalletHomeLane;
  readonly currentRegion: ManagedWalletRegion;
  readonly currentLaneStatus: ManagedWalletLaneStatus;
  readonly currentLatency: WalletLaneProbeSummary | null;
  readonly destinations: readonly HomeRegionCandidate[];
  readonly recommendation: HomeRegionRecommendation | null;
  readonly policy: WalletHomeRegionPolicy;
  readonly lastCompletedMoveAt: UnixTimestamp | null;
  readonly nextEligibleMoveAt: UnixTimestamp | null;
  readonly activeMigrationId: WalletRegionMigrationId | null;
};

export type HomeRegionMoveReview = {
  readonly snapshot: HomeRegionSnapshot;
  readonly destination: HomeRegionCandidate;
};

export type RegionMoveStepUpRequest = {
  readonly migrationId: WalletRegionMigrationId;
  readonly walletId: WalletId;
  readonly source: WalletHomeLane;
  readonly targetLaneId: WalletHomeLaneId;
  readonly expiresAt: UnixTimestamp;
};

export type RegionMoveProgress = {
  readonly migrationId: WalletRegionMigrationId;
  readonly stage:
    | 'authorized'
    | 'source_frozen'
    | 'target_verified'
    | 'cutover_committed'
    | 'completed';
};

export type RegionMoveRecovery = {
  readonly migrationId: WalletRegionMigrationId;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
};

export type RegionMoveResult = {
  readonly migrationId: WalletRegionMigrationId;
  readonly homeLane: WalletHomeLane;
};

export type HomeRegionSettingsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly snapshot: HomeRegionSnapshot }
  | { readonly kind: 'reviewing'; readonly review: HomeRegionMoveReview }
  | { readonly kind: 'step_up'; readonly request: RegionMoveStepUpRequest }
  | { readonly kind: 'moving'; readonly progress: RegionMoveProgress }
  | { readonly kind: 'recoverable_failure'; readonly recovery: RegionMoveRecovery }
  | { readonly kind: 'complete'; readonly result: RegionMoveResult };

function requireRecommendationPolicy(policy: HomeRegionRecommendationPolicy): void {
  if (
    !Number.isFinite(policy.minimumAbsoluteImprovementMs) ||
    policy.minimumAbsoluteImprovementMs <= 0 ||
    !Number.isFinite(policy.minimumRelativeImprovement) ||
    policy.minimumRelativeImprovement <= 0 ||
    policy.minimumRelativeImprovement >= 1 ||
    !Number.isSafeInteger(policy.minimumSampleCount) ||
    policy.minimumSampleCount <= 0 ||
    !Number.isSafeInteger(policy.minimumDistinctSessionCount) ||
    policy.minimumDistinctSessionCount <= 0 ||
    !Number.isSafeInteger(policy.minimumDistinctDayCount) ||
    policy.minimumDistinctDayCount <= 0
  ) {
    throw new Error('Home region recommendation policy is invalid');
  }
}

function requireCooldownMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Home region move cooldown must be a non-negative safe integer');
  }
  return value;
}

function unixTimestampFromNumber(value: number, label: string): UnixTimestamp {
  return requireWalletRegionBoundary(parseUnixTimestamp(value), label);
}

export function evaluateWalletHomeRegionMovePolicy(input: {
  readonly currentRegion: ManagedWalletRegion;
  readonly targetRegion: ManagedWalletRegion;
  readonly policy: WalletHomeRegionPolicy;
  readonly now: UnixTimestamp;
  readonly lastCompletedMoveAt: UnixTimestamp | null;
}): WalletHomeRegionMovePolicyDecision {
  if (input.targetRegion === input.currentRegion) return { kind: 'same_region' };
  if (input.policy.kind === 'owner_moves_disabled') {
    return { kind: 'owner_moves_disabled' };
  }
  if (input.policy.kind === 'pinned' && input.targetRegion !== input.policy.pinnedRegion) {
    return { kind: 'region_pinned' };
  }
  if (!input.policy.allowedRegions.includes(input.targetRegion)) {
    return { kind: 'region_not_allowed' };
  }
  const cooldownMs = requireCooldownMs(input.policy.cooldownMs);
  if (input.lastCompletedMoveAt !== null) {
    const nextEligibleMoveAt = unixTimestampFromNumber(
      input.lastCompletedMoveAt + cooldownMs,
      'next eligible Home region move timestamp',
    );
    if (input.now < nextEligibleMoveAt) {
      return { kind: 'cooldown_active', nextEligibleMoveAt };
    }
  }
  return { kind: 'allowed' };
}

function hasSustainedProbeEvidence(
  probe: WalletLaneProbeSummary,
  policy: HomeRegionRecommendationPolicy,
): boolean {
  return (
    Number.isFinite(probe.medianLatencyMs) &&
    probe.medianLatencyMs > 0 &&
    Number.isSafeInteger(probe.sampleCount) &&
    Number.isSafeInteger(probe.distinctSessionCount) &&
    Number.isSafeInteger(probe.distinctDayCount) &&
    probe.sampleCount >= policy.minimumSampleCount &&
    probe.distinctSessionCount >= policy.minimumDistinctSessionCount &&
    probe.distinctDayCount >= policy.minimumDistinctDayCount
  );
}

function canRecommendCandidate(input: {
  readonly current: WalletLaneProbeSummary;
  readonly candidate: WalletLaneProbeSummary;
  readonly allowedRegions: ReadonlySet<ManagedWalletRegion>;
  readonly policy: HomeRegionRecommendationPolicy;
}): boolean {
  if (
    input.candidate.laneId === input.current.laneId ||
    input.candidate.laneStatus !== 'available' ||
    !input.allowedRegions.has(input.candidate.productRegion) ||
    !hasSustainedProbeEvidence(input.candidate, input.policy)
  ) {
    return false;
  }
  const improvement = input.current.medianLatencyMs - input.candidate.medianLatencyMs;
  const relativeImprovement = improvement / input.current.medianLatencyMs;
  return (
    improvement >= input.policy.minimumAbsoluteImprovementMs &&
    relativeImprovement >= input.policy.minimumRelativeImprovement
  );
}

function fasterProbe(
  current: WalletLaneProbeSummary | null,
  candidate: WalletLaneProbeSummary,
): WalletLaneProbeSummary {
  if (!current || candidate.medianLatencyMs < current.medianLatencyMs) return candidate;
  return current;
}

export function recommendWalletHomeRegion(input: {
  readonly current: WalletLaneProbeSummary;
  readonly candidates: readonly WalletLaneProbeSummary[];
  readonly allowedRegions: readonly [ManagedWalletRegion, ...ManagedWalletRegion[]];
  readonly policy: HomeRegionRecommendationPolicy;
}): HomeRegionRecommendation | null {
  requireRecommendationPolicy(input.policy);
  if (!hasSustainedProbeEvidence(input.current, input.policy)) return null;
  const allowedRegions = new Set(input.allowedRegions);
  let best: WalletLaneProbeSummary | null = null;
  for (const candidate of input.candidates) {
    if (
      canRecommendCandidate({
        current: input.current,
        candidate,
        allowedRegions,
        policy: input.policy,
      })
    ) {
      best = fasterProbe(best, candidate);
    }
  }
  if (!best) return null;
  return {
    sourceLaneId: input.current.laneId,
    targetLaneId: best.laneId,
    targetRegion: best.productRegion,
    sourceMedianLatencyMs: input.current.medianLatencyMs,
    targetMedianLatencyMs: best.medianLatencyMs,
    estimatedImprovementMs: input.current.medianLatencyMs - best.medianLatencyMs,
  };
}
