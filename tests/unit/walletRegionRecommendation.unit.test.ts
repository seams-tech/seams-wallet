import { expect, test } from '@playwright/test';
import {
  evaluateWalletHomeRegionMovePolicy,
  recommendWalletHomeRegion,
  parseUnixTimestamp,
  parseWalletHomeLaneId,
  parseWalletRegionPolicyVersion,
  requireWalletRegionBoundary,
  type WalletLaneProbeSummary,
} from '../../packages/shared-ts/src/wallet-region';

function probe(input: {
  readonly laneId: 'managed-na-v1' | 'managed-eu-v1' | 'managed-apac-v1';
  readonly productRegion: WalletLaneProbeSummary['productRegion'];
  readonly latencyMs: number;
  readonly sessions?: number;
  readonly days?: number;
}): WalletLaneProbeSummary {
  return {
    laneId: requireWalletRegionBoundary(parseWalletHomeLaneId(input.laneId), 'probe lane'),
    productRegion: input.productRegion,
    laneStatus: 'available',
    medianLatencyMs: input.latencyMs,
    sampleCount: 12,
    distinctSessionCount: input.sessions ?? 3,
    distinctDayCount: input.days ?? 2,
    measuredAt: requireWalletRegionBoundary(parseUnixTimestamp(10_000), 'probe timestamp'),
  };
}

const recommendationPolicy = {
  minimumAbsoluteImprovementMs: 40,
  minimumRelativeImprovement: 0.25,
  minimumSampleCount: 10,
  minimumDistinctSessionCount: 3,
  minimumDistinctDayCount: 2,
} as const;

test.describe('Home region latency recommendations', () => {
  test('recommends the fastest policy-allowed lane after sustained evidence', () => {
    const recommendation = recommendWalletHomeRegion({
      current: probe({
        laneId: 'managed-na-v1',
        productRegion: 'north_america',
        latencyMs: 240,
      }),
      candidates: [
        probe({ laneId: 'managed-eu-v1', productRegion: 'europe', latencyMs: 140 }),
        probe({ laneId: 'managed-apac-v1', productRegion: 'asia_pacific', latencyMs: 80 }),
      ],
      allowedRegions: ['north_america', 'europe', 'asia_pacific'],
      policy: recommendationPolicy,
    });

    expect(recommendation).toMatchObject({
      sourceLaneId: 'managed-na-v1',
      targetLaneId: 'managed-apac-v1',
      targetRegion: 'asia_pacific',
      estimatedImprovementMs: 160,
    });
  });

  test('never recommends a disallowed region', () => {
    const recommendation = recommendWalletHomeRegion({
      current: probe({
        laneId: 'managed-na-v1',
        productRegion: 'north_america',
        latencyMs: 240,
      }),
      candidates: [
        probe({ laneId: 'managed-eu-v1', productRegion: 'europe', latencyMs: 140 }),
        probe({ laneId: 'managed-apac-v1', productRegion: 'asia_pacific', latencyMs: 50 }),
      ],
      allowedRegions: ['north_america', 'europe'],
      policy: recommendationPolicy,
    });

    expect(recommendation?.targetRegion).toBe('europe');
  });

  test('requires evidence across sessions and days before recommending a move', () => {
    const recommendation = recommendWalletHomeRegion({
      current: probe({
        laneId: 'managed-na-v1',
        productRegion: 'north_america',
        latencyMs: 240,
      }),
      candidates: [
        probe({
          laneId: 'managed-apac-v1',
          productRegion: 'asia_pacific',
          latencyMs: 50,
          sessions: 1,
          days: 1,
        }),
      ],
      allowedRegions: ['north_america', 'asia_pacific'],
      policy: recommendationPolicy,
    });

    expect(recommendation).toBeNull();
  });

  test('rejects invalid latency samples at the recommendation boundary', () => {
    const recommendation = recommendWalletHomeRegion({
      current: probe({
        laneId: 'managed-na-v1',
        productRegion: 'north_america',
        latencyMs: 0,
      }),
      candidates: [probe({ laneId: 'managed-eu-v1', productRegion: 'europe', latencyMs: -10 })],
      allowedRegions: ['north_america', 'europe'],
      policy: recommendationPolicy,
    });

    expect(recommendation).toBeNull();
  });
});

test.describe('Home region move policy', () => {
  test('enforces owner-move policy and cooldown without using probe or location signals', () => {
    const now = requireWalletRegionBoundary(parseUnixTimestamp(10_000), 'policy now');
    const lastCompletedMoveAt = requireWalletRegionBoundary(
      parseUnixTimestamp(8_000),
      'policy last move',
    );
    const policy = {
      kind: 'owner_moves_allowed',
      policyVersion: requireWalletRegionBoundary(
        parseWalletRegionPolicyVersion('policy-v1'),
        'policy version fixture',
      ),
      allowedRegions: ['north_america', 'europe'],
      cooldownMs: 5_000,
    } as const;

    expect(
      evaluateWalletHomeRegionMovePolicy({
        currentRegion: 'north_america',
        targetRegion: 'europe',
        policy,
        now,
        lastCompletedMoveAt,
      }),
    ).toMatchObject({ kind: 'cooldown_active', nextEligibleMoveAt: 13_000 });
  });
});
