import { normalizeLowercaseString, normalizeOptionalNonEmptyString } from '@shared/utils/normalize';
import {
  thresholdEcdsaChainTargetKey,
  type ThresholdEcdsaChainTarget,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';

export function normalizeLastUserScope(scope: unknown): string | null {
  const normalized = normalizeOptionalNonEmptyString(scope);
  if (!normalized || normalized === 'null') return null;
  return normalized;
}

export function normalizeIndexedDbChainIdKey(chainIdKey: unknown): string {
  return normalizeLowercaseString(chainIdKey);
}

export function normalizeIndexedDbAccountAddress(address: unknown): string {
  return normalizeLowercaseString(address);
}

export function normalizeIndexedDbAccountModel<T extends string = string>(model: unknown): T {
  return normalizeLowercaseString(model) as T;
}

export function toIndexedDbChainTargetKey(chainTarget: ThresholdEcdsaChainTarget): string {
  return thresholdEcdsaChainTargetKey(chainTarget);
}
