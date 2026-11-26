import type {
  RouterAbEcdsaDerivationPresignaturePoolPolicy,
  RouterAbEcdsaDerivationPresignaturePoolPolicyInput,
} from '@/core/types/seams';
import { DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY } from '@/core/config/defaultConfigs';
import { ECDSA_CLIENT_PRESIGNATURE_CAPACITY } from '@/core/config/presignatures';

function normalizeIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function normalizePresignPoolTargetDepth(value: unknown, fallback: number): number {
  return normalizeIntInRange(value, fallback, 1, ECDSA_CLIENT_PRESIGNATURE_CAPACITY);
}

export function normalizePresignPoolLowWatermark(
  value: unknown,
  fallback: number,
  targetDepth: number,
): number {
  return normalizeIntInRange(value, fallback, 0, targetDepth);
}

export function resolveRouterAbEcdsaDerivationPresignaturePoolPolicy(
  input?:
    | RouterAbEcdsaDerivationPresignaturePoolPolicyInput
    | RouterAbEcdsaDerivationPresignaturePoolPolicy,
): RouterAbEcdsaDerivationPresignaturePoolPolicy {
  const source = input || DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY;
  const targetDepth = normalizePresignPoolTargetDepth(
    source.targetDepth,
    DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.targetDepth,
  );
  const lowWatermark = normalizePresignPoolLowWatermark(
    source.lowWatermark,
    DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.lowWatermark,
    targetDepth,
  );
  return {
    enabled:
      typeof source.enabled === 'boolean'
        ? source.enabled
        : DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.enabled,
    targetDepth,
    lowWatermark,
    maxRefillInFlight: normalizeIntInRange(
      source.maxRefillInFlight,
      DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.maxRefillInFlight,
      1,
      8,
    ),
    refillAttemptTimeoutMs: normalizeIntInRange(
      source.refillAttemptTimeoutMs,
      DEFAULT_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_POLICY.refillAttemptTimeoutMs,
      5_000,
      120_000,
    ),
  };
}
